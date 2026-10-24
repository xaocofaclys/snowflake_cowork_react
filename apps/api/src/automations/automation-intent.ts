import { Injectable } from '@nestjs/common';
import {
  AUTO_AGENT_ID,
  describeCron,
  isWorkflowAgentId,
  parseScheduleText,
  toCron,
  type AutomationProposal,
  type AutomationTargetKind,
} from '@cowork/shared';
import { env } from '../config/env';
import { LlmService } from '../llm/llm.service';
import type { SfCredential } from '../snowflake/snowflake.client';
import { DEFAULT_TZ, validateCron } from './schedule';

/** Cheap pre-check so ordinary questions never pay for an LLM call. */
const RECURRENCE = /\b(every|each|daily|weekly|weekdays?|(mon|tues|wednes|thurs|fri|satur|sun)days|schedule|automate|automation|recurring|remind me)\b/i;
const ACTION = /\b(send|email|mail|run|schedule|automate|remind|deliver|share|give me|get me|refresh|report)\b/i;
const REFERS_BACK = /\b(this|that|it|same|above)\b/i;
const EMAIL = /[^\s@,<>()]+@[^\s@,<>()]+\.[a-z]{2,}/gi;

export interface TurnContext {
  /** The previous question in the thread, used when the message says "this"/"that". */
  previousQuestion?: string;
  previousWasResearch?: boolean;
  /** The thread's agent: a specific agent, AUTO_AGENT_ID or a workflow id. */
  agentId: string;
  /** Deep research toggled on for this message. */
  research?: boolean;
}

interface Extracted {
  isAutomation?: boolean;
  name?: string;
  prompt?: string;
  kind?: AutomationTargetKind;
  cron?: string;
  emails?: string[];
}

/** Turns "send me this every Monday at 8am" into an automation proposal (never creates it). */
@Injectable()
export class AutomationIntentService {
  constructor(private readonly llm: LlmService) {}

  looksLikeScheduling(text: string): boolean {
    return RECURRENCE.test(text) && ACTION.test(text);
  }

  async detect(text: string, ctx: TurnContext, cred?: SfCredential): Promise<AutomationProposal | null> {
    if (!this.looksLikeScheduling(text)) return null;
    const ex = (await this.extractWithLlm(text, ctx, cred)) ?? this.extractWithRules(text, ctx);
    if (!ex?.isAutomation || !ex.cron) return null;
    try {
      validateCron(ex.cron, DEFAULT_TZ);
    } catch {
      const fallback = parseScheduleText(text);
      if (!fallback) return null;
      ex.cron = toCron(fallback);
    }

    const workflow = isWorkflowAgentId(ctx.agentId);
    const kind: AutomationTargetKind = workflow ? 'workflow' : ex.kind === 'research' || ctx.research ? 'research' : 'agent';
    const prompt = (ex.prompt?.trim() || ctx.previousQuestion || text).slice(0, 4000);
    const emails = [...new Set([...(ex.emails ?? []), ...(text.match(EMAIL) ?? [])].map((e) => e.toLowerCase()))];
    const name = (ex.name?.trim() || this.nameFrom(prompt)).slice(0, 80);
    const what = kind === 'research' ? 'Deep research report' : kind === 'workflow' ? 'Workflow run' : 'Agent answer';
    return {
      name,
      prompt,
      target: { kind, agentId: ctx.agentId || AUTO_AGENT_ID },
      schedule: { cron: ex.cron, timezone: DEFAULT_TZ },
      email: { enabled: emails.length > 0, to: emails },
      summary: `${what} · ${describeCron(ex.cron)}${emails.length ? ` · emailed to ${emails.join(', ')}` : ''}`,
    };
  }

  private async extractWithLlm(text: string, ctx: TurnContext, cred?: SfCredential): Promise<Extracted | null> {
    const now = new Date().toLocaleString('en-IN', { timeZone: DEFAULT_TZ, dateStyle: 'full', timeStyle: 'short' });
    return this.llm.completeJson<Extracted>(
      `Decide whether the user's message asks to set up a RECURRING scheduled task (an automation), and if so extract it.
Current time (India Standard Time): ${now}
Previous question in this conversation: ${ctx.previousQuestion ? `"""${ctx.previousQuestion.slice(0, 1000)}"""` : '(none)'}
${ctx.previousWasResearch ? 'The previous answer was a deep-research report.' : ''}
User message: """${text}"""

Rules:
- isAutomation is true only for recurring requests ("every Monday", "daily", "each morning", "weekly"). One-off questions that merely mention time periods ("revenue every month last year") are NOT automations.
- prompt: the self-contained question to run each time. If the message refers to "this/that/it", use the previous question.
- kind: "research" if they ask for research/a report or the previous answer was a deep-research report and they refer to it; otherwise "agent".
- cron: 5-field cron in IST (minute hour day-of-month month day-of-week, 0=Sunday). Default time 09:00 if none given. At most every 15 minutes.
- emails: any email addresses in the message.
- name: a short title (max 6 words).

Return ONLY JSON: {"isAutomation": true|false, "name": "...", "prompt": "...", "kind": "agent"|"research", "cron": "...", "emails": []}`,
      cred,
      env.RESEARCH_MODEL,
    );
  }

  /** Offline fallback: explicit schedule words plus a parseable recurrence. */
  private extractWithRules(text: string, ctx: TurnContext): Extracted | null {
    const pick = parseScheduleText(text);
    if (!pick) return null;
    const refers = REFERS_BACK.test(text) && !!ctx.previousQuestion;
    return {
      isAutomation: true,
      prompt: refers ? ctx.previousQuestion : text,
      kind: /\b(research|report)\b/i.test(text) || (refers && ctx.previousWasResearch) ? 'research' : 'agent',
      cron: toCron(pick),
      emails: text.match(EMAIL) ?? [],
    };
  }

  private nameFrom(prompt: string): string {
    const words = prompt.replace(/[^\w\s-]/g, ' ').split(/\s+/).filter(Boolean).slice(0, 6).join(' ');
    return words ? words[0].toUpperCase() + words.slice(1) : 'Scheduled brief';
  }
}
