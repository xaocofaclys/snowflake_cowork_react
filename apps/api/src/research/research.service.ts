import { Injectable, Logger } from '@nestjs/common';
import {
  AUTO_AGENT_ID,
  BlockBuilder,
  blocksToText,
  isWorkflowAgentId,
  tableToValues,
  type AgentInfo,
  type Artifact,
  type BlockOf,
  type ResearchFinding,
  type StreamEvent,
} from '@cowork/shared';
import { ArtifactsService } from '../artifacts/artifacts.service';
import { ChartService } from '../charts/chart.service';
import { env } from '../config/env';
import { CortexService } from '../cortex/cortex.service';
import { LlmService } from '../llm/llm.service';
import type { SfCredential } from '../snowflake/snowflake.client';

export interface ResearchOptions {
  userId: string;
  cred?: SfCredential;
  question: string;
  /** A specific agent (research uses only it) or AUTO_AGENT_ID / a workflow id (planner picks agents). */
  agentId?: string;
  emit: (ev: StreamEvent) => void;
  signal?: AbortSignal;
  autoChart?: boolean;
  threadId?: string;
}

interface PlanStep {
  question: string;
  agentId: string;
}

const MAX_STEPS = 6;
const CONCURRENCY = 3;

/**
 * Deep research: plan sub-questions (RESEARCH_MODEL), answer them in parallel with Cortex agents,
 * then write a cited report and save it as a Report artifact. Progress streams as research
 * "nodes" so the UI reuses the workflow trace.
 */
@Injectable()
export class ResearchService {
  private readonly log = new Logger(ResearchService.name);

  constructor(
    private readonly cortex: CortexService,
    private readonly llm: LlmService,
    private readonly charts: ChartService,
    private readonly artifacts: ArtifactsService,
  ) {}

  async run(o: ResearchOptions): Promise<{ report: string; artifact: Artifact }> {
    const { emit } = o;
    emit({ type: 'status', status: 'planning', message: 'Planning the research' });
    const visible = (await this.cortex.listAgents(o.cred, `${o.userId}:research`)).filter((a) => a.kind === 'agent');
    const pinned = o.agentId && o.agentId !== AUTO_AGENT_ID && !isWorkflowAgentId(o.agentId);
    const allowed: AgentInfo[] = pinned
      ? [visible.find((a) => a.id === o.agentId) ?? this.stub(o.agentId!)]
      : visible;
    if (!allowed.length) throw new Error('No agents are available for research');

    const plan = await this.plan(o.question, allowed, o.cred);
    emit({ type: 'status', status: 'researching', message: `Researching ${plan.steps.length} questions with ${new Set(plan.steps.map((s) => s.agentId)).size} agent(s)` });

    const findings = await this.pool(plan.steps, CONCURRENCY, (step, i) => this.investigate(i + 1, step, allowed, o));
    if (o.signal?.aborted) throw new Error('aborted');

    emit({ type: 'status', status: 'writing', message: 'Writing the report' });
    const report = await this.write(o.question, plan.title, findings, o.cred);
    emit({ type: 'text', index: 0, text: report });

    const artifact = await this.artifacts.createFor(o.userId, {
      type: 'report',
      title: plan.title,
      text: report,
      findings,
      question: o.question,
      agentId: pinned ? o.agentId : undefined,
      threadId: o.threadId,
    });
    emit({ type: 'artifact', artifactId: artifact.id, title: artifact.title, kind: 'report' });
    return { report, artifact };
  }

  private stub(id: string): AgentInfo {
    const [database, schema, name] = id.split('.');
    return { id, database, schema, name, displayName: name ?? id, sampleQuestions: [], kind: 'agent' };
  }

  // ---- 1. plan ----

  private async plan(question: string, agents: AgentInfo[], cred?: SfCredential): Promise<{ title: string; steps: PlanStep[] }> {
    const catalog = agents.map((a) => ({
      agentId: a.id,
      name: a.displayName,
      description: a.description ?? '',
      exampleQuestions: a.sampleQuestions.slice(0, 4),
    }));
    const plan = await this.llm.completeJson<{ title?: string; steps?: PlanStep[] }>(
      `You are planning a deep-research report that will be answered by data agents.
Research question: """${question}"""

Available agents (use only these agentId values):
${JSON.stringify(catalog, null, 2)}

Break the question into 3 to ${MAX_STEPS} focused, non-overlapping sub-questions that together answer it fully.
Each sub-question must be self-contained (an agent sees only that sub-question) and answerable by the agent you assign,
judged from its description and example questions. ${agents.length === 1 ? 'There is one agent: assign every sub-question to it.' : 'Use different agents where their strengths differ.'}
Prefer sub-questions that produce numbers, trends, comparisons or concrete evidence.

Return ONLY JSON: {"title": "<short report title>", "steps": [{"question": "...", "agentId": "..."}]}`,
      cred,
      env.RESEARCH_MODEL,
    );
    const ids = new Set(agents.map((a) => a.id));
    const steps = (plan?.steps ?? [])
      .filter((s) => s?.question?.trim())
      .map((s) => ({ question: s.question.trim(), agentId: ids.has(s.agentId) ? s.agentId : agents[0].id }))
      .slice(0, MAX_STEPS);
    if (steps.length) return { title: plan?.title?.trim() || this.titleFrom(question), steps };

    // No planner available (offline or model error): broad coverage with simple variations.
    this.log.warn('Research planner unavailable; using fallback plan');
    const fallback: PlanStep[] =
      agents.length > 1
        ? agents.slice(0, 3).map((a) => ({ question, agentId: a.id }))
        : [question, `${question}: break it down by region`, `${question}: show the monthly trend`].map((q) => ({ question: q, agentId: agents[0].id }));
    return { title: this.titleFrom(question), steps: fallback };
  }

  private titleFrom(question: string) {
    const t = question.replace(/\s+/g, ' ').trim().replace(/[?.!]+$/, '');
    return t.length > 70 ? `${t.slice(0, 67)}…` : t;
  }

  // ---- 2. research ----

  private async investigate(n: number, step: PlanStep, agents: AgentInfo[], o: ResearchOptions): Promise<ResearchFinding> {
    const nodeId = `q${n}`;
    const agent = agents.find((a) => a.id === step.agentId);
    o.emit({ type: 'node_start', nodeId, run: 1, label: `[${n}] ${step.question}`, kind: 'research', input: `${agent?.displayName ?? step.agentId}: ${step.question}` });
    const builder = new BlockBuilder();
    const wrap = (event: StreamEvent) => {
      builder.add(event);
      o.emit({ type: 'node_event', nodeId, run: 1, event });
    };
    try {
      for await (const ev of this.cortex.run(o.cred, { agentId: step.agentId, text: step.question, signal: o.signal })) wrap(ev);
      if (o.autoChart !== false) {
        for (const t of builder.tablesWithoutCharts()) {
          const spec = await this.charts.fallback(t.table, step.question, o.cred);
          if (spec) wrap({ type: 'chart', index: 10_000 + builder.blocks.length, toolUseId: t.toolUseId, spec, generated: true });
        }
      }
      const blocks = builder.finalize();
      const table = blocks.find((b): b is BlockOf<'table'> => b.type === 'table');
      const chart = blocks.find((b): b is BlockOf<'chart'> => b.type === 'chart');
      const tool = blocks.find((b): b is BlockOf<'tool'> => b.type === 'tool' && !!b.sql);
      const err = blocks.find((b): b is BlockOf<'error'> => b.type === 'error');
      const text = blocksToText(blocks) || (table ? '(see table)' : '(no answer)');
      o.emit({ type: 'node_end', nodeId, run: 1, status: err ? 'error' : 'success', output: text, error: err?.message });
      return { n, question: step.question, agentId: step.agentId, text, sql: tool?.sql ?? table?.sql, table: table?.table, spec: chart?.spec, error: err?.message };
    } catch (e) {
      const message = (e as Error).message;
      o.emit({ type: 'node_end', nodeId, run: 1, status: 'error', error: message });
      return { n, question: step.question, agentId: step.agentId, text: '', error: message };
    }
  }

  private async pool<T, R>(items: T[], size: number, fn: (item: T, i: number) => Promise<R>): Promise<R[]> {
    const out: R[] = new Array(items.length);
    let next = 0;
    await Promise.all(
      Array.from({ length: Math.min(size, items.length) }, async () => {
        while (next < items.length) {
          const i = next++;
          out[i] = await fn(items[i], i);
        }
      }),
    );
    return out;
  }

  // ---- 3. write ----

  private async write(question: string, title: string, findings: ResearchFinding[], cred?: SfCredential): Promise<string> {
    const evidence = findings
      .map((f) => {
        const preview = f.table
          ? JSON.stringify(tableToValues({ ...f.table, rows: f.table.rows.slice(0, 15) }))
          : '';
        return `[${f.n}] Sub-question: ${f.question}
Answer: ${f.error ? `FAILED (${f.error})` : f.text.slice(0, 3000)}
${preview ? `Data (first rows): ${preview.slice(0, 2500)}` : ''}`;
      })
      .join('\n\n');
    const report = await this.llm.complete(
      `Write a concise, well-structured research report in Markdown answering: """${question}"""

Use ONLY the findings below. Cite every claim taken from a finding with its number in square brackets, e.g. [2] or [1][3].
Do not invent numbers. If findings conflict or a sub-question failed, say so.

Structure:
# ${title}
## Executive summary   (3-5 bullet points with the key numbers)
## <2-4 sections with descriptive headings, organized by theme, not by finding>
## Caveats and next steps

Do not reproduce full tables (they are attached to the report separately). Keep it under 700 words.

Findings:
${evidence}`,
      cred,
      env.RESEARCH_MODEL,
    );
    if (report?.trim()) return report.trim();
    this.log.warn('Research writer unavailable; assembling findings');
    return [
      `# ${title}`,
      '## Findings',
      ...findings.map((f) => `### [${f.n}] ${f.question}\n\n${f.error ? `_This step failed: ${f.error}_` : f.text}`),
    ].join('\n\n');
  }
}
