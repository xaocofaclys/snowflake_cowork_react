import { describe, expect, it } from 'vitest';
import { BlockBuilder, validateGraph, type StreamEvent, type WorkflowGraph } from '@cowork/shared';
import { WorkflowExecutor } from '../src/workflows/workflow-executor';

/** Stub agents: GEN drafts (revises when given FAIL feedback), MLR passes only content with ISI. */
const cortex = {
  async *run(_cred: unknown, input: { agentId: string; text: string }): AsyncGenerator<StreamEvent> {
    const name = input.agentId.split('.').pop();
    let text = `${name} saw: ${input.text}`;
    if (name === 'GEN') text = /FAIL/.test(input.text) ? 'Draft v2 with Important Safety Information' : 'Draft v1: best drug ever';
    if (name === 'MLR') text = /Important Safety Information/.test(input.text) ? 'Verdict: PASS' : 'Verdict: FAIL, add ISI';
    if (name === 'BROKEN') throw new Error('agent unavailable');
    yield { type: 'text_delta', index: 0, text };
  },
};
const llm = { classify: async () => null }; // offline → keyword fallback
const charts = { fallback: async () => null };
const executor = new WorkflowExecutor(cortex as never, llm as never, charts as never);

async function run(graph: WorkflowGraph, input = 'brief', maxSteps = 12) {
  const events: StreamEvent[] = [];
  const output = await executor.run(graph, { input, maxSteps, emit: (e) => events.push(e) });
  const ran = events.filter((e) => e.type === 'node_start').map((e) => (e as { nodeId: string }).nodeId);
  return { output, events, ran };
}

const p = { x: 0, y: 0 };
const agent = (id: string, agentId: string, inputTemplate = '{{previous.output}}') =>
  ({ id, type: 'agent', agentId: `DB.S.${agentId}`, inputTemplate, position: p }) as const;

describe('WorkflowExecutor', () => {
  it('runs agents sequentially, passing each output to the next', async () => {
    const g: WorkflowGraph = {
      nodes: [{ id: 's', type: 'start', position: p }, agent('a', 'A'), agent('b', 'B'), { id: 'e', type: 'end', position: p }],
      edges: [
        { id: '1', source: 's', target: 'a' },
        { id: '2', source: 'a', target: 'b' },
        { id: '3', source: 'b', target: 'e' },
      ],
    };
    expect(validateGraph(g)).toEqual([]);
    const r = await run(g, 'hello');
    expect(r.ran).toEqual(['s', 'a', 'b', 'e']);
    expect(r.output).toBe('B saw: A saw: hello');
  });

  it('fans out in parallel and joins both outputs', async () => {
    const g: WorkflowGraph = {
      nodes: [
        { id: 's', type: 'start', position: p },
        { ...agent('a', 'A'), label: 'Analyst' },
        { ...agent('b', 'B'), label: 'Reviewer' },
        { id: 'j', type: 'join', position: p },
        { id: 'e', type: 'end', position: p },
      ],
      edges: [
        { id: '1', source: 's', target: 'a' },
        { id: '2', source: 's', target: 'b' },
        { id: '3', source: 'a', target: 'j' },
        { id: '4', source: 'b', target: 'j' },
        { id: '5', source: 'j', target: 'e' },
      ],
    };
    const r = await run(g, 'q');
    expect(r.ran.filter((n) => n === 'j')).toHaveLength(1);
    expect(r.output).toContain('### Analyst');
    expect(r.output).toContain('A saw: q');
    expect(r.output).toContain('### Reviewer');
    expect(r.output).toContain('B saw: q');
  });

  it('loops on a failed condition until it passes', async () => {
    const g: WorkflowGraph = {
      nodes: [
        { id: 's', type: 'start', position: p },
        agent('gen', 'GEN', '{{input}}\n{{nodes.mlr.output}}'),
        agent('mlr', 'MLR'),
        { id: 'c', type: 'condition', method: 'classify', branches: ['pass', 'fail'], inputTemplate: '{{previous.output}}', position: p },
        { id: 'e', type: 'end', outputTemplate: '{{nodes.gen.output}}', position: p },
      ],
      edges: [
        { id: '1', source: 's', target: 'gen' },
        { id: '2', source: 'gen', target: 'mlr' },
        { id: '3', source: 'mlr', target: 'c' },
        { id: '4', source: 'c', target: 'e', branch: 'pass' },
        { id: '5', source: 'c', target: 'gen', branch: 'fail' },
      ],
    };
    expect(validateGraph(g)).toEqual([]);
    const r = await run(g);
    const decisions = r.events.filter((e) => e.type === 'node_end' && e.decision).map((e) => (e as { decision: string }).decision);
    expect(decisions).toEqual(['fail', 'pass']);
    expect(r.output).toBe('Draft v2 with Important Safety Information');
  });

  it('stops runaway loops at maxSteps with a warning', async () => {
    const g: WorkflowGraph = {
      nodes: [
        { id: 's', type: 'start', position: p },
        agent('a', 'A'),
        { id: 'c', type: 'condition', method: 'rule', branches: ['again', 'done'], rules: [{ branch: 'again', keywords: ['saw'] }], inputTemplate: '{{previous.output}}', position: p },
        { id: 'e', type: 'end', position: p },
      ],
      edges: [
        { id: '1', source: 's', target: 'a' },
        { id: '2', source: 'a', target: 'c' },
        { id: '3', source: 'c', target: 'a', branch: 'again' },
        { id: '4', source: 'c', target: 'e', branch: 'done' },
      ],
    };
    const r = await run(g, 'x', 6);
    expect(r.events.filter((e) => e.type === 'node_start')).toHaveLength(6);
    expect(r.events.some((e) => e.type === 'warning')).toBe(true);
    expect(r.output).toMatch(/without reaching an End node/);
  });

  it('marks a failing agent as an error without crashing the run', async () => {
    const g: WorkflowGraph = {
      nodes: [{ id: 's', type: 'start', position: p }, agent('x', 'BROKEN'), { id: 'e', type: 'end', position: p }],
      edges: [
        { id: '1', source: 's', target: 'x' },
        { id: '2', source: 'x', target: 'e' },
      ],
    };
    const r = await run(g);
    expect(r.events.find((e) => e.type === 'node_end' && e.nodeId === 'x')).toMatchObject({ status: 'error', error: 'agent unavailable' });
  });

  it('folds node events into a workflow block with per-step agent output', async () => {
    const g: WorkflowGraph = {
      nodes: [{ id: 's', type: 'start', position: p }, agent('a', 'A'), { id: 'e', type: 'end', position: p }],
      edges: [
        { id: '1', source: 's', target: 'a' },
        { id: '2', source: 'a', target: 'e' },
      ],
    };
    const r = await run(g, 'hi');
    const b = new BlockBuilder();
    r.events.forEach((e) => b.add(e));
    const wf = b.blocks.find((x) => x.type === 'workflow') as { steps: { nodeId: string; status: string; blocks: { type: string }[] }[] };
    expect(wf.steps.map((s) => s.nodeId)).toEqual(['s', 'a', 'e']);
    expect(wf.steps[1].blocks.map((x) => x.type)).toEqual(['text']);
    expect(wf.steps.every((s) => s.status === 'success')).toBe(true);
  });
});
