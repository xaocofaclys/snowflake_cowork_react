import { Injectable, Logger } from '@nestjs/common';
import { marked } from 'marked';
import {
  APP_NAME,
  AUTO_AGENT_ID,
  BlockBuilder,
  blocksToText,
  type Artifact,
  type Automation,
  type AutomationRun,
  type StreamEvent,
} from '@cowork/shared';
import { ArtifactsService } from '../artifacts/artifacts.service';
import type { AuthContext } from '../auth/auth.types';
import { ChartService } from '../charts/chart.service';
import { ActivityService } from '../common/activity.service';
import { newId, nowIso } from '../common/ids';
import { env } from '../config/env';
import { AgentRouter } from '../cortex/agent-router';
import { CortexService } from '../cortex/cortex.service';
import { ResearchService } from '../research/research.service';
import { SnowflakeClient } from '../snowflake/snowflake.client';
import { DocStore } from '../store/doc-store';
import { WorkflowsService } from '../workflows/workflows.service';
import { EmailService } from './email.service';
import { DEFAULT_TZ, nextRun } from './schedule';

/** Executes one automation headlessly: run the target, save an artifact, email it, record the run. */
@Injectable()
export class AutomationRunner {
  private readonly log = new Logger(AutomationRunner.name);

  constructor(
    private readonly store: DocStore,
    private readonly cortex: CortexService,
    private readonly router: AgentRouter,
    private readonly charts: ChartService,
    private readonly research: ResearchService,
    private readonly workflows: WorkflowsService,
    private readonly artifacts: ArtifactsService,
    private readonly email: EmailService,
    private readonly sf: SnowflakeClient,
    private readonly activity: ActivityService,
  ) {}

  async execute(a: Automation, trigger: AutomationRun['trigger']): Promise<AutomationRun> {
    const now = nowIso();
    const run: AutomationRun = {
      id: newId('run'),
      userId: a.userId,
      automationId: a.id,
      status: 'running',
      trigger,
      startedAt: now,
      createdAt: now,
      updatedAt: now,
    };
    await this.store.insert('AUTOMATION_RUNS', run, a.id);
    await this.store.patch<Automation>('AUTOMATIONS', a.id, { lastRunAt: now, lastStatus: 'running' });
    this.activity.touch();

    try {
      const artifact = await this.produce(a);
      run.artifactId = artifact.id;
      if (a.email?.enabled && a.email.to.length) {
        try {
          await this.email.send(a.email.to, `[${APP_NAME}] ${a.name}`, this.emailHtml(a, artifact));
          run.emailed = true;
        } catch (e) {
          run.error = `Saved, but the email failed: ${(e as Error).message}`;
        }
      }
      run.status = 'success';
    } catch (e) {
      run.status = 'error';
      run.error = (e as Error).message;
      this.log.warn(`automation ${a.id} failed: ${run.error}`);
    }
    run.finishedAt = nowIso();
    await this.store.put('AUTOMATION_RUNS', { ...run, updatedAt: run.finishedAt });
    await this.store.patch<Automation>('AUTOMATIONS', a.id, { lastStatus: run.status });
    return run;
  }

  /** Records a run that was skipped because the app was down too long. */
  async markMissed(a: Automation, dueAt: string) {
    const now = nowIso();
    await this.store.insert(
      'AUTOMATION_RUNS',
      { id: newId('run'), userId: a.userId, automationId: a.id, status: 'missed', trigger: 'schedule', startedAt: dueAt, finishedAt: now, error: 'The app was not running at the scheduled time', createdAt: now, updatedAt: now } satisfies AutomationRun,
      a.id,
    );
    await this.store.patch<Automation>('AUTOMATIONS', a.id, { lastStatus: 'missed', nextRunAt: nextRun(a.schedule.cron, a.schedule.timezone || DEFAULT_TZ) });
  }

  private async produce(a: Automation): Promise<Artifact> {
    const cred = this.sf.hasServiceCredential() ? this.sf.serviceCredential() : undefined;
    const when = new Date().toLocaleString('en-IN', { timeZone: a.schedule.timezone || DEFAULT_TZ, dateStyle: 'medium', timeStyle: 'short' });
    const builder = new BlockBuilder();
    const emit = (ev: StreamEvent) => builder.add(ev);

    if (a.target.kind === 'research') {
      const { artifact } = await this.research.run({ userId: a.userId, cred, question: a.prompt, agentId: a.target.agentId, emit });
      return (await this.store.patch<Artifact>('ARTIFACTS', artifact.id, { title: `${a.name} · ${when}` })) ?? artifact;
    }

    if (a.target.kind === 'workflow') {
      const ctx: AuthContext = { user: { id: a.userId, name: a.ownerName ?? a.userId }, cred, sessionId: 'automation' };
      await this.workflows.runForChat(ctx, a.target.agentId, a.prompt, emit, new AbortController().signal, true);
    } else {
      let agentId = a.target.agentId;
      if (agentId === AUTO_AGENT_ID) {
        const picked = await this.router.pick(a.prompt, await this.cortex.listAgents(cred, `${a.userId}:automation`), cred);
        if (!picked) throw new Error('No agents are available');
        agentId = picked.id;
      }
      for await (const ev of this.cortex.run(cred, { agentId, text: a.prompt })) emit(ev);
      for (const t of builder.tablesWithoutCharts()) {
        const spec = await this.charts.fallback(t.table, a.prompt, cred);
        if (spec) emit({ type: 'chart', index: 10_000 + builder.blocks.length, toolUseId: t.toolUseId, spec, generated: true });
      }
    }
    const blocks = builder.finalize();
    const err = blocks.find((b) => b.type === 'error');
    if (err && err.type === 'error' && !blocksToText(blocks)) throw new Error(err.message);
    return this.artifacts.createFor(a.userId, {
      type: 'answer',
      title: `${a.name} · ${when}`,
      text: blocksToText(blocks),
      blocks,
      question: a.prompt,
      agentId: a.target.agentId,
    });
  }

  private emailHtml(a: Automation, artifact: Artifact): string {
    const base = env.APP_PUBLIC_URL ?? env.WEB_ORIGIN;
    const link = `${base.replace(/\/$/, '')}/artifacts/${artifact.id}`;
    const body = marked.parse(artifact.text || '_No text output. Open the artifact for tables and charts._', { async: false }) as string;
    return `<div style="font-family:-apple-system,Segoe UI,Arial,sans-serif;max-width:720px;color:#0b0b0b;line-height:1.55">
<p style="color:#52514e;font-size:13px;margin:0 0 4px">${APP_NAME} automation · ${escapeHtml(a.name)}</p>
<h2 style="margin:0 0 16px">${escapeHtml(artifact.title)}</h2>
${body}
<p style="margin-top:24px"><a href="${link}" style="background:#1f6fd1;color:#fff;padding:8px 14px;border-radius:8px;text-decoration:none">Open in ${APP_NAME}</a></p>
<p style="color:#8a8984;font-size:12px">Charts and live tables are in the app. You receive this because the automation lists your address.</p>
</div>`;
  }
}

function escapeHtml(s: string) {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
}
