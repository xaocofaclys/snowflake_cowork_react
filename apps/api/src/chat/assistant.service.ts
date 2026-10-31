import { Injectable } from '@nestjs/common';
import { APP_NAME, type AgentInfo, type Memory, type MemoryCategory, type StreamEvent } from '@cowork/shared';
import { env } from '../config/env';
import { CortexService } from '../cortex/cortex.service';
import { LlmService } from '../llm/llm.service';
import { MemoryService } from '../memory/memory.service';
import { extractWithRules } from '../memory/rules';
import type { SfCredential } from '../snowflake/snowflake.client';

/** Cheap pre-checks: only these messages pay for the classifier; everything else goes to the agent. */
const MEMORY = /\b(remember|memori[sz]e|memory|memories|preferences?|prefer|from now on|forget|what do you (know|remember))\b/i;
const HELP = /\b(what can you do|what (else )?can (you|i) (do|ask)|how (do|can|should) i\b|help me|what is flurry|who are you|what are you|how does (this|flurry|it|the app) work|which agents|what agents|what features)\b/i;
const SMALLTALK = /^\s*(hi|hello|hey|hiya|thanks|thank you|thx|good (morning|afternoon|evening)|ok(ay)?|cool|great|nice|awesome|bye)\b[\s!.,]*$/i;
const REFERS_BACK = /\b(this|that|it|above)\b/i;

/** What the app itself can do; used to answer "how do I…" questions without an agent. */
const CAPABILITIES = `${APP_NAME} is a work agent on Snowflake Cortex Agents. Features:
- Chat with your Snowflake agents (agent picker next to the message box). "Auto" picks the right agent per question. Answers show reasoning, SQL, tables and charts (switch chart type, download PNG, save as artifact with the bookmark icon).
- Deep research: + button in the message box → Deep research. Plans sub-questions, researches them in parallel, writes a cited report saved under Artifacts.
- Dashboards: ask "build a dashboard for …" in chat (or Artifacts → Dashboards → Build with ${APP_NAME}). KPI cards, filter bar, click charts to cross-filter, table icon for drill-down. Edit by asking in the same chat ("add a chart of …", "make the trend a bar chart").
- Workflows (sidebar): chain agents sequentially, in parallel, or with conditions (AI_CLASSIFY); test and publish; published workflows appear in the agent picker.
- Automations (sidebar): schedule an agent, workflow or deep research (IST) and optionally email results. Or in chat: "send me this every Monday at 8am"; or the calendar icon under an answer ("Automate this").
- Artifacts (sidebar): saved charts, tables, reports and dashboards; Refresh re-runs the SQL with live data; Share; export to PDF or PowerPoint.
- Memory: say "remember …" or "add this as a preference"; manage in Settings → Memory.
- Skills (sidebar): saved prompts you run by typing /name.
- Settings: default agent, theme, auto-chart, memory on/off. Voice input: microphone button.`;

type Intent = 'memory_add' | 'memory_forget' | 'memory_list' | 'help' | 'smalltalk' | 'data';

interface Classified {
  intent?: Intent;
  memories?: { text: string; category?: MemoryCategory }[];
  forget?: string;
  reply?: string;
}

export interface AssistantContext {
  userId: string;
  cred?: SfCredential;
  threadId: string;
  memoryEnabled: boolean;
  previousQuestion?: string;
  previousAnswer?: string;
}

const words = (s: string) => new Set(s.toLowerCase().match(/[a-z0-9]{3,}/g) ?? []);

/**
 * Handles messages about the app or the user (memory, help, small talk) directly with Cortex
 * COMPLETE, so data agents only receive data questions. Returns false to fall through to the agent.
 */
@Injectable()
export class AssistantService {
  constructor(
    private readonly llm: LlmService,
    private readonly memory: MemoryService,
    private readonly cortex: CortexService,
  ) {}

  static looksLikeAssistant(text: string): boolean {
    return MEMORY.test(text) || HELP.test(text) || SMALLTALK.test(text);
  }

  async handle(text: string, ctx: AssistantContext, emit: (ev: StreamEvent) => void): Promise<boolean> {
    if (!AssistantService.looksLikeAssistant(text)) return false;
    const [memories, agents] = await Promise.all([
      this.memory.listPublic(ctx.userId),
      this.cortex.listAgents(ctx.cred, `${ctx.userId}:assistant`).catch(() => [] as AgentInfo[]),
    ]);
    const c = (await this.classify(text, ctx, memories, agents)) ?? this.rules(text, ctx, agents);
    switch (c.intent) {
      case 'memory_add':
        return this.remember(c, ctx, memories, emit);
      case 'memory_forget':
        return this.forget(c.forget ?? text, ctx, memories, emit);
      case 'memory_list':
        emit({
          type: 'text',
          index: 0,
          text: memories.length
            ? `Here's what I remember about you:\n\n${memories.map((m) => `- ${m.text}`).join('\n')}\n\nYou can edit these in **Settings → Memory**.`
            : "I don't have anything saved about you yet. Tell me things like \"remember I cover the South zone\" or \"I prefer bar charts\".",
        });
        return true;
      case 'help':
      case 'smalltalk':
        emit({ type: 'text', index: 0, text: c.reply?.trim() || this.defaultReply(c.intent, agents) });
        return true;
      default:
        return false;
    }
  }

  private async classify(text: string, ctx: AssistantContext, memories: Memory[], agents: AgentInfo[]): Promise<Classified | null> {
    return this.llm.completeJson<Classified>(
      `You are the assistant layer of ${APP_NAME}. Decide if the user's message is about the app or about themselves rather than a question for the data agents, and handle it.

${CAPABILITIES}
Agents available to this user: ${agents.map((a) => `${a.displayName}${a.description ? ` (${a.description})` : ''}`).join('; ') || 'none'}
What is remembered about the user: ${JSON.stringify(memories.map((m) => m.text))}
Previous question in this conversation: ${ctx.previousQuestion ? `"""${ctx.previousQuestion.slice(0, 800)}"""` : '(none)'}
Previous answer (truncated): ${ctx.previousAnswer ? `"""${ctx.previousAnswer.slice(0, 1200)}"""` : '(none)'}
User message: """${text}"""

Intents:
- "memory_add": they want something remembered as a fact or preference ("remember…", "add this as a preference", "from now on…", "I prefer…"). Resolve "this/that" from the previous turn. Write each memory as a short third-person statement ("Prefers bar charts", "Covers the South zone").
- "memory_forget": they want a memory removed; put what to forget in "forget".
- "memory_list": they ask what you remember about them.
- "help": a question about how to use ${APP_NAME}, its features, or which agents exist. Answer in "reply" (concise Markdown, concrete steps, only features listed above).
- "smalltalk": greetings, thanks. Short friendly "reply" that suggests something they could ask.
- "data": anything that needs their business data (metrics, HCPs, sales, analysis), even if phrased with "how do I". Do not answer it.

Return ONLY JSON: {"intent": "...", "memories": [{"text": "...", "category": "preference|fact|role|goal|other"}], "forget": "...", "reply": "..."}`,
      ctx.cred,
      env.RESEARCH_MODEL,
    );
  }

  /** Offline fallback. */
  private rules(text: string, ctx: AssistantContext, agents: AgentInfo[]): Classified {
    const t = text.toLowerCase();
    if (/\b(forget|don'?t remember|remove .*memor|delete .*memor)\b/.test(t)) return { intent: 'memory_forget', forget: text };
    if (/\bwhat do you (know|remember)|list .*memor|my memories\b/.test(t)) return { intent: 'memory_list' };
    if (MEMORY.test(text)) {
      const extracted = extractWithRules(text);
      if (extracted.length) return { intent: 'memory_add', memories: extracted };
      const after = text.match(/\bremember(?: that)?\s+(.+)/i)?.[1];
      if (after && !REFERS_BACK.test(after.split(/\s+/)[0])) return { intent: 'memory_add', memories: [{ text: after.replace(/[.!]+$/, ''), category: 'fact' }] };
      if (REFERS_BACK.test(text) && ctx.previousQuestion) return { intent: 'memory_add', memories: [{ text: ctx.previousQuestion, category: 'preference' }] };
    }
    if (SMALLTALK.test(text)) return { intent: 'smalltalk', reply: this.defaultReply('smalltalk', agents) };
    if (HELP.test(text) && !/\b(revenue|sales|hcp|rep|orders?|customers?|region|trend|kpi)\b/.test(t)) return { intent: 'help', reply: this.defaultReply('help', agents) };
    return { intent: 'data' };
  }

  private defaultReply(intent: Intent, agents: AgentInfo[]): string {
    if (intent === 'smalltalk') return `Hi! Ask me anything about your data${agents[0] ? `, for example "${agents[0].sampleQuestions[0] ?? 'show this month’s key metrics'}"` : ''}.`;
    return `Here's what I can do:\n\n${CAPABILITIES.split('\n').slice(1).join('\n')}\n\nAgents available to you: ${agents.map((a) => a.displayName).join(', ') || 'none yet'}.`;
  }

  private async remember(c: Classified, ctx: AssistantContext, existing: Memory[], emit: (ev: StreamEvent) => void) {
    if (!ctx.memoryEnabled) {
      emit({ type: 'text', index: 0, text: 'Memory is turned off. Turn it on in **Settings → Memory** and ask again.' });
      return true;
    }
    const saved: string[] = [];
    for (const m of (c.memories ?? []).filter((x) => x?.text?.trim()).slice(0, 5)) {
      const text = m.text.trim().slice(0, 300);
      const dup = existing.some((e) => e.text.toLowerCase() === text.toLowerCase());
      if (dup) continue;
      await this.memory.create(ctx.userId, text, m.category ?? 'preference', 'manual', ctx.cred, ctx.threadId);
      saved.push(text);
    }
    if (!saved.length) {
      emit({ type: 'text', index: 0, text: (c.memories ?? []).length ? 'I already have that saved.' : "I couldn't tell what to remember. Try: \"remember that I prefer bar charts\"." });
      return true;
    }
    emit({ type: 'text', index: 0, text: `Saved to your memory:\n\n${saved.map((s) => `- ${s}`).join('\n')}\n\nI'll apply this in future answers. Review or edit it in **Settings → Memory**.` });
    emit({ type: 'memory', saved });
    return true;
  }

  private async forget(what: string, ctx: AssistantContext, memories: Memory[], emit: (ev: StreamEvent) => void) {
    const q = words(what);
    const best = memories
      .map((m) => ({ m, s: [...words(m.text)].filter((w) => q.has(w)).length }))
      .filter((x) => x.s > 0)
      .sort((a, b) => b.s - a.s)[0]?.m;
    if (!best) {
      emit({ type: 'text', index: 0, text: "I couldn't find a matching memory. See everything I remember in **Settings → Memory**." });
      return true;
    }
    await this.memory.remove(ctx.userId, best.id);
    emit({ type: 'text', index: 0, text: `Forgotten: "${best.text}".` });
    return true;
  }
}
