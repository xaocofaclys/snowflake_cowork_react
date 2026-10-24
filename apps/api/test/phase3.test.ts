import { describe, expect, it } from 'vitest';
import type { AgentInfo, StreamEvent } from '@cowork/shared';
import { nextRun, validateCron } from '../src/automations/schedule';
import { ResearchService } from '../src/research/research.service';

describe('automation schedules (IST)', () => {
  it('computes the next 07:00 IST weekday run in UTC', () => {
    // Friday 2026-10-23 10:00 IST (04:30 UTC) → next weekday 07:00 IST is Monday 2026-10-26 01:30 UTC
    expect(nextRun('0 7 * * 1-5', 'Asia/Kolkata', new Date('2026-10-23T04:30:00Z'))).toBe('2026-10-26T01:30:00.000Z');
  });

  it('rejects invalid crons and schedules more frequent than 15 minutes', () => {
    expect(() => validateCron('every day')).toThrow(/5-field/);
    expect(() => validateCron('*/5 * * * *')).toThrow(/15 minutes/);
    expect(() => validateCron('0 9 * * 1')).not.toThrow();
  });
});

const agent = (name: string, description: string): AgentInfo => ({
  id: `DB.S.${name}`,
  database: 'DB',
  schema: 'S',
  name,
  displayName: name,
  description,
  sampleQuestions: [],
  kind: 'agent',
});

function researchWith(plan: unknown, report: string | null) {
  const calls: { agentId: string; text: string }[] = [];
  const cortex = {
    listAgents: async () => [agent('SALES', 'revenue and orders'), agent('MLR', 'compliance review')],
    async *run(_c: unknown, i: { agentId: string; text: string }): AsyncGenerator<StreamEvent> {
      calls.push(i);
      yield { type: 'text_delta', index: 0, text: `${i.agentId.split('.').pop()} answer to: ${i.text}` };
    },
  };
  const llm = {
    completeJson: async () => plan,
    complete: async () => report,
  };
  const saved: unknown[] = [];
  const artifacts = { createFor: async (_u: string, a: object) => (saved.push(a), { id: 'art_1', ...a }) };
  const svc = new ResearchService(cortex as never, llm as never, { fallback: async () => null } as never, artifacts as never);
  return { svc, calls, saved };
}

describe('ResearchService', () => {
  it('uses only the selected agent even if the planner suggests another', async () => {
    const { svc, calls } = researchWith(
      { title: 'Q4 review', steps: [{ question: 'a', agentId: 'DB.S.SALES' }, { question: 'b', agentId: 'DB.S.MLR' }] },
      '# Q4 review\n\nDone [1][2]',
    );
    const events: StreamEvent[] = [];
    await svc.run({ userId: 'u', question: 'How did Q4 go?', agentId: 'DB.S.SALES', emit: (e) => events.push(e) });
    expect(calls.map((c) => c.agentId)).toEqual(['DB.S.SALES', 'DB.S.SALES']);
    expect(events.filter((e) => e.type === 'node_start')).toHaveLength(2);
    expect(events.find((e) => e.type === 'artifact')).toMatchObject({ artifactId: 'art_1', kind: 'report' });
  });

  it('lets the planner spread work across agents in auto mode and saves a cited report', async () => {
    const { svc, calls, saved } = researchWith(
      { title: 'Launch readiness', steps: [{ question: 'sales?', agentId: 'DB.S.SALES' }, { question: 'compliant?', agentId: 'DB.S.MLR' }] },
      '# Launch readiness\n\nSales look good [1]; content is compliant [2].',
    );
    await svc.run({ userId: 'u', question: 'Are we ready to launch?', agentId: 'auto', emit: () => undefined });
    expect(new Set(calls.map((c) => c.agentId))).toEqual(new Set(['DB.S.SALES', 'DB.S.MLR']));
    expect(saved[0]).toMatchObject({ type: 'report', title: 'Launch readiness' });
    expect((saved[0] as { findings: unknown[] }).findings).toHaveLength(2);
  });

  it('falls back to a simple plan and an assembled report when the model is unavailable', async () => {
    const { svc, saved } = researchWith(null, null);
    const events: StreamEvent[] = [];
    const { report } = await svc.run({ userId: 'u', question: 'Revenue health', agentId: 'DB.S.SALES', emit: (e) => events.push(e) });
    expect(events.filter((e) => e.type === 'node_start')).toHaveLength(3);
    expect(report).toContain('### [1] Revenue health');
    expect(saved).toHaveLength(1);
  });
});

import { parseScheduleText, toCron } from '@cowork/shared';
import { AutomationIntentService } from '../src/automations/automation-intent';

describe('parseScheduleText', () => {
  const cron = (t: string) => {
    const p = parseScheduleText(t);
    return p ? toCron(p) : null;
  };
  it('reads common phrasings into IST crons', () => {
    expect(cron('send me this every Monday at 8am')).toBe('0 8 * * 1');
    expect(cron('email it on weekdays at 18:30')).toBe('30 18 * * 1-5');
    expect(cron('run this daily at 9')).toBe('0 9 * * *');
    expect(cron('every friday evening')).toBe('0 18 * * 5');
    expect(cron('give me this every morning')).toBe('0 9 * * *');
  });
  it('returns null without a recurrence', () => {
    expect(cron('what was revenue last month at 5pm')).toBeNull();
  });
});

describe('AutomationIntentService (offline rules)', () => {
  const svc = new AutomationIntentService({ completeJson: async () => null } as never);

  it('turns "send me this every Monday" into a proposal for the previous question', async () => {
    const p = await svc.detect(
      'Send me this every Monday at 8am to rep@acme.com',
      { previousQuestion: 'Top HCPs by NBA follow-through', previousWasResearch: true, agentId: 'auto' },
    );
    expect(p).toMatchObject({
      prompt: 'Top HCPs by NBA follow-through',
      target: { kind: 'research', agentId: 'auto' },
      schedule: { cron: '0 8 * * 1', timezone: 'Asia/Kolkata' },
      email: { enabled: true, to: ['rep@acme.com'] },
    });
    expect(p!.summary).toContain('Every Monday at 08:00 IST');
  });

  it('ignores ordinary questions', async () => {
    expect(await svc.detect('What was revenue every month in 1997?', { agentId: 'auto' })).toBeNull();
    expect(await svc.detect('Show monthly revenue for 1997', { agentId: 'auto' })).toBeNull();
  });

  it('keeps workflows as workflow automations', async () => {
    const p = await svc.detect('Run this every day at 7:30', { previousQuestion: 'Draft the weekly email', agentId: 'workflow:wf_1' });
    expect(p?.target).toEqual({ kind: 'workflow', agentId: 'workflow:wf_1' });
  });
});
