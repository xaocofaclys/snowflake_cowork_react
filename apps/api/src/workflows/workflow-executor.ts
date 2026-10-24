import { Injectable, Logger } from '@nestjs/common';
import {
  BlockBuilder,
  blocksToText,
  renderTemplate,
  type ConditionNode,
  type StreamEvent,
  type WorkflowGraph,
  type WorkflowNode,
} from '@cowork/shared';
import { ChartService } from '../charts/chart.service';
import { CortexService } from '../cortex/cortex.service';
import { LlmService } from '../llm/llm.service';
import type { SfCredential } from '../snowflake/snowflake.client';

export interface RunOptions {
  cred?: SfCredential;
  input: string;
  maxSteps: number;
  emit: (ev: StreamEvent) => void;
  signal?: AbortSignal;
  autoChart?: boolean;
}

type Next = { target: string; output: string };

/**
 * Runs a workflow graph of existing Cortex agents.
 *  - an agent node's input is its template rendered with {{input}}, {{previous.output}}, {{nodes.<id>.output}}
 *  - several edges out of a node run their targets in parallel
 *  - a join waits for all incoming branches (or for the run to go quiet if some never arrive)
 *  - a condition picks one branch via AI_CLASSIFY or keyword rules; edges may loop back
 *  - maxSteps bounds total node executions so loops always end
 */
@Injectable()
export class WorkflowExecutor {
  private readonly log = new Logger(WorkflowExecutor.name);

  constructor(
    private readonly cortex: CortexService,
    private readonly llm: LlmService,
    private readonly charts: ChartService,
  ) {}

  async run(graph: WorkflowGraph, opts: RunOptions): Promise<string> {
    const byId = new Map(graph.nodes.map((n) => [n.id, n]));
    const outEdges = (id: string) => graph.edges.filter((e) => e.source === id);
    const inCount = (id: string) => graph.edges.filter((e) => e.target === id).length;
    const outputs: Record<string, string> = {};
    const runs = new Map<string, number>();
    const joins = new Map<string, { from: string; text: string }[]>();
    const finals: string[] = [];
    const inflight = new Set<Promise<void>>();
    let steps = 0;
    let stoppedForSteps = false;

    const label = (n: WorkflowNode) => n.label || (n.type === 'agent' ? n.agentId.split('.').pop()! : n.type);

    const schedule = (nodeId: string, previous: string, from?: string) => {
      if (opts.signal?.aborted) return;
      const node = byId.get(nodeId);
      if (!node) return;
      if (node.type === 'join') {
        const arrivals = [...(joins.get(nodeId) ?? []), { from: from ?? '', text: previous }];
        if (arrivals.length < inCount(nodeId)) {
          joins.set(nodeId, arrivals);
          return;
        }
        joins.delete(nodeId);
        previous = this.combine(arrivals, byId, label);
      }
      if (steps >= opts.maxSteps) {
        stoppedForSteps = true;
        return;
      }
      steps++;
      const run = (runs.get(nodeId) ?? 0) + 1;
      runs.set(nodeId, run);
      const p = this.execute(node, run, previous, outputs, outEdges(nodeId), finals, label(node), opts)
        .then((next) => next.forEach((n) => schedule(n.target, n.output, nodeId)))
        .finally(() => inflight.delete(p));
      inflight.add(p);
    };

    const start = graph.nodes.find((n) => n.type === 'start');
    if (!start) throw new Error('Workflow has no Start node');
    schedule(start.id, opts.input);

    for (;;) {
      while (inflight.size) await Promise.race(inflight);
      // Quiet: release joins whose remaining branches were never taken (e.g. skipped by a condition).
      const waiting = [...joins.entries()];
      if (!waiting.length || opts.signal?.aborted) break;
      for (const [id, arrivals] of waiting) {
        joins.delete(id);
        const node = byId.get(id)!;
        steps++;
        const run = (runs.get(id) ?? 0) + 1;
        runs.set(id, run);
        const combined = this.combine(arrivals, byId, label);
        const p = this.execute(node, run, combined, outputs, outEdges(id), finals, label(node), opts)
          .then((next) => next.forEach((n) => schedule(n.target, n.output, id)))
          .finally(() => inflight.delete(p));
        inflight.add(p);
      }
    }

    if (stoppedForSteps) {
      opts.emit({ type: 'warning', message: `Stopped after ${opts.maxSteps} steps (raise "max steps" if this workflow loops on purpose).` });
    }
    if (finals.length) return finals.join('\n\n---\n\n');
    return 'The workflow finished without reaching an End node.';
  }

  private combine(arrivals: { from: string; text: string }[], byId: Map<string, WorkflowNode>, label: (n: WorkflowNode) => string) {
    return arrivals
      .map((a) => {
        const n = byId.get(a.from);
        return `### ${n ? label(n) : 'Branch'}\n\n${a.text}`;
      })
      .join('\n\n');
  }

  private async execute(
    node: WorkflowNode,
    run: number,
    previous: string,
    outputs: Record<string, string>,
    out: { target: string; branch?: string }[],
    finals: string[],
    label: string,
    opts: RunOptions,
  ): Promise<Next[]> {
    const vars = { input: opts.input, previous, nodes: outputs };
    const emit = opts.emit;
    const all = (output: string) => out.map((e) => ({ target: e.target, output }));

    switch (node.type) {
      case 'start':
        emit({ type: 'node_start', nodeId: node.id, run, label, kind: node.type });
        outputs[node.id] = opts.input;
        emit({ type: 'node_end', nodeId: node.id, run, status: 'success', output: opts.input });
        return all(opts.input);

      case 'join':
        emit({ type: 'node_start', nodeId: node.id, run, label, kind: node.type });
        outputs[node.id] = previous;
        emit({ type: 'node_end', nodeId: node.id, run, status: 'success', output: previous });
        return all(previous);

      case 'end': {
        const output = renderTemplate(node.outputTemplate || '{{previous.output}}', vars);
        emit({ type: 'node_start', nodeId: node.id, run, label, kind: node.type });
        outputs[node.id] = output;
        finals.push(output);
        emit({ type: 'node_end', nodeId: node.id, run, status: 'success', output });
        return [];
      }

      case 'agent': {
        const text = renderTemplate(node.inputTemplate || '{{previous.output}}', vars);
        emit({ type: 'node_start', nodeId: node.id, run, label, kind: node.type, input: text });
        const builder = new BlockBuilder();
        const wrap = (event: StreamEvent) => {
          builder.add(event);
          emit({ type: 'node_event', nodeId: node.id, run, event });
        };
        try {
          for await (const ev of this.cortex.run(opts.cred, { agentId: node.agentId, text, signal: opts.signal })) wrap(ev);
          if (opts.autoChart !== false) {
            for (const t of builder.tablesWithoutCharts()) {
              const spec = await this.charts.fallback(t.table, text, opts.cred);
              if (spec) wrap({ type: 'chart', index: 10_000 + builder.blocks.length, toolUseId: t.toolUseId, spec, generated: true });
            }
          }
          const err = builder.blocks.find((b) => b.type === 'error');
          const output = blocksToText(builder.blocks) || '(the agent returned no text)';
          outputs[node.id] = output;
          if (err && err.type === 'error') {
            emit({ type: 'node_end', nodeId: node.id, run, status: 'error', error: err.message, output });
            return [];
          }
          emit({ type: 'node_end', nodeId: node.id, run, status: 'success', output });
          return all(output);
        } catch (e) {
          const message = (e as Error).message;
          this.log.warn(`agent node ${node.id} failed: ${message}`);
          emit({ type: 'node_end', nodeId: node.id, run, status: 'error', error: message });
          return [];
        }
      }

      case 'condition': {
        const text = renderTemplate(node.inputTemplate || '{{previous.output}}', vars);
        emit({ type: 'node_start', nodeId: node.id, run, label, kind: node.type, input: text });
        const decision = await this.decide(node, text, opts.cred);
        outputs[node.id] = previous;
        const taken = out.filter((e) => e.branch === decision);
        emit({
          type: 'node_end',
          nodeId: node.id,
          run,
          status: taken.length ? 'success' : 'error',
          decision,
          output: previous,
          ...(taken.length ? {} : { error: `No connection for branch "${decision}"` }),
        });
        // The condition passes its input through unchanged to the chosen branch.
        return taken.map((e) => ({ target: e.target, output: previous }));
      }
    }
  }

  /** AI_CLASSIFY (or rules) → one of the node's branch labels. */
  private async decide(node: ConditionNode, text: string, cred?: SfCredential): Promise<string> {
    if (node.method === 'classify') {
      const label = await this.llm.classify(text, node.branches, node.instructions, cred);
      if (label) return label;
    }
    const lower = text.toLowerCase();
    for (const r of node.rules ?? []) {
      if (r.keywords.some((k) => k && lower.includes(k.toLowerCase()))) return r.branch;
    }
    // Fallback when classify is unavailable (offline): the branch label mentioned first in the text.
    const named = node.branches
      .map((b) => ({ b, at: lower.indexOf(b.toLowerCase()) }))
      .filter((x) => x.at >= 0)
      .sort((a, b) => a.at - b.at)[0];
    return named?.b ?? node.defaultBranch ?? node.branches[node.branches.length - 1];
  }
}
