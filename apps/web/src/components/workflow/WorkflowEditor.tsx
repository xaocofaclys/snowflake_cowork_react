'use client';

import '@xyflow/react/dist/style.css';
import { useQueryClient } from '@tanstack/react-query';
import {
  addEdge,
  Background,
  Controls,
  MarkerType,
  ReactFlow,
  ReactFlowProvider,
  useEdgesState,
  useNodesState,
  useReactFlow,
  type Connection,
  type Edge,
} from '@xyflow/react';
import clsx from 'clsx';
import { ArrowLeft, Bot, Flag, GitBranch, GitMerge, Play, Save, Square, Trash2 } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useMemo, useRef, useState } from 'react';
import {
  BlockBuilder,
  blocksToText,
  validateGraph,
  type AgentInfo,
  type BlockOf,
  type Workflow,
  type WorkflowGraph,
  type WorkflowNode,
} from '@cowork/shared';
import { api } from '@/lib/api';
import { useAgents, useMe } from '@/lib/hooks';
import { streamPost } from '@/lib/sse';
import { useTheme } from '@/lib/theme';
import { Markdown } from '../Markdown';
import { Button, inputCls, Spinner } from '../ui';
import { StepRow } from '../WorkflowTrace';
import { Inspector } from './Inspector';
import { EditorContext, nodeTypes, type FlowNode } from './nodes';

const edgeDefaults = { markerEnd: { type: MarkerType.ArrowClosed, width: 16, height: 16 }, style: { strokeWidth: 1.5 } };

function toFlow(g: WorkflowGraph): { nodes: FlowNode[]; edges: Edge[] } {
  return {
    nodes: g.nodes.map((n) => ({ id: n.id, type: n.type, position: n.position, data: { node: n }, deletable: n.type !== 'start' })),
    edges: g.edges.map((e) => ({ id: e.id, source: e.source, target: e.target, sourceHandle: e.branch ?? null, label: e.branch, ...edgeDefaults })),
  };
}

function fromFlow(nodes: FlowNode[], edges: Edge[]): WorkflowGraph {
  return {
    nodes: nodes.map((n) => ({ ...n.data.node, position: { x: Math.round(n.position.x), y: Math.round(n.position.y) } }) as WorkflowNode),
    edges: edges.map((e) => ({ id: e.id, source: e.source, target: e.target, ...(e.sourceHandle ? { branch: e.sourceHandle } : {}) })),
  };
}

function slug(s: string) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 24) || 'step';
}

export function WorkflowEditor({ workflow }: { workflow: Workflow }) {
  return (
    <ReactFlowProvider>
      <Editor workflow={workflow} />
    </ReactFlowProvider>
  );
}

function Editor({ workflow }: { workflow: Workflow }) {
  const { data: me } = useMe();
  const { data: all = [] } = useAgents();
  const agents = useMemo(() => all.filter((a) => a.kind === 'agent'), [all]);
  const agentMap = useMemo(() => Object.fromEntries(agents.map((a) => [a.id, a])) as Record<string, AgentInfo>, [agents]);
  const readOnly = !me?.permissions.buildWorkflows || workflow.userId !== me.user.id;
  const { dark } = useTheme();
  const rf = useReactFlow();
  const qc = useQueryClient();
  const router = useRouter();

  const initial = useMemo(() => toFlow(workflow.graph), [workflow.graph]);
  const [nodes, setNodes, onNodesChange] = useNodesState<FlowNode>(initial.nodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>(initial.edges);
  const [name, setName] = useState(workflow.name);
  const [description, setDescription] = useState(workflow.description ?? '');
  const [maxSteps, setMaxSteps] = useState(workflow.maxSteps);
  const [published, setPublished] = useState(workflow.published);
  const [selected, setSelected] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string }>();

  const graph = useMemo(() => fromFlow(nodes, edges), [nodes, edges]);
  const problems = useMemo(() => validateGraph(graph), [graph]);
  const selectedNode = nodes.find((n) => n.id === selected)?.data.node;

  const markDirty = () => {
    setDirty(true);
    setMessage(undefined);
  };

  const patchNode = (id: string, patch: Partial<WorkflowNode>) => {
    setNodes((ns) => ns.map((n) => (n.id === id ? { ...n, data: { node: { ...n.data.node, ...patch } as WorkflowNode } } : n)));
    markDirty();
  };

  const renameBranch = (id: string, from: string, to: string) => {
    setNodes((ns) =>
      ns.map((n) => {
        if (n.id !== id || n.data.node.type !== 'condition') return n;
        const c = n.data.node;
        return {
          ...n,
          data: {
            node: {
              ...c,
              branches: c.branches.map((b) => (b === from ? to : b)),
              rules: c.rules?.map((r) => (r.branch === from ? { ...r, branch: to } : r)),
              defaultBranch: c.defaultBranch === from ? to : c.defaultBranch,
            },
          },
        };
      }),
    );
    setEdges((es) => es.map((e) => (e.source === id && e.sourceHandle === from ? { ...e, sourceHandle: to, label: to } : e)));
    markDirty();
  };

  const addNode = (type: WorkflowNode['type']) => {
    const center = rf.screenToFlowPosition({ x: window.innerWidth / 2 - 120, y: window.innerHeight / 2 - 40 });
    const position = { x: center.x + Math.random() * 40, y: center.y + Math.random() * 40 };
    const agent = agents[0];
    const base = type === 'agent' ? slug(agent?.name ?? 'agent') : type;
    let id = base;
    for (let i = 2; nodes.some((n) => n.id === id); i++) id = `${base}_${i}`;
    const node: WorkflowNode =
      type === 'agent'
        ? { id, type, agentId: agent?.id ?? '', label: agent?.displayName, inputTemplate: '{{previous.output}}', position }
        : type === 'condition'
          ? { id, type, label: 'Condition', method: 'classify', branches: ['pass', 'fail'], inputTemplate: '{{previous.output}}', position }
          : type === 'join'
            ? { id, type, position }
            : { id, type: 'end', outputTemplate: '{{previous.output}}', position };
    setNodes((ns) => [...ns, { id, type, position, data: { node }, deletable: true }]);
    setSelected(id);
    markDirty();
  };

  const onConnect = useCallback(
    (c: Connection) => {
      setEdges((es) =>
        addEdge(
          { ...c, id: `e_${Date.now().toString(36)}`, label: c.sourceHandle ?? undefined, ...edgeDefaults },
          // A condition branch connects to one step; replace an existing edge from the same branch.
          c.sourceHandle ? es.filter((e) => !(e.source === c.source && e.sourceHandle === c.sourceHandle)) : es,
        ),
      );
      markDirty();
    },
    [setEdges],
  );

  const save = async (extra: Partial<Workflow> = {}) => {
    setSaving(true);
    try {
      const w = await api<Workflow>(`/workflows/${workflow.id}`, {
        method: 'PATCH',
        json: { name, description, maxSteps, graph, ...extra },
      });
      qc.setQueryData(['workflow', workflow.id], w);
      qc.invalidateQueries({ queryKey: ['workflows'] });
      qc.invalidateQueries({ queryKey: ['agents'] });
      setPublished(w.published);
      setDirty(false);
      setMessage({ kind: 'ok', text: extra.published === true ? 'Published: it now appears in the chat agent picker.' : extra.published === false ? 'Unpublished.' : 'Saved.' });
    } catch (e) {
      setMessage({ kind: 'error', text: (e as Error).message });
    } finally {
      setSaving(false);
    }
  };

  // ---- test run ----
  const [input, setInput] = useState('');
  const [running, setRunning] = useState(false);
  const [steps, setSteps] = useState<BlockOf<'workflow'>['steps']>([]);
  const [output, setOutput] = useState<string>();
  const [runError, setRunError] = useState<string>();
  const abort = useRef<AbortController | null>(null);

  const status = useMemo(() => {
    const s: Record<string, { status: BlockOf<'workflow'>['steps'][number]['status']; decision?: string; runs: number }> = {};
    for (const st of steps) s[st.nodeId] = { status: st.status, decision: st.decision ?? s[st.nodeId]?.decision, runs: (s[st.nodeId]?.runs ?? 0) + 1 };
    return s;
  }, [steps]);

  const run = async () => {
    const b = new BlockBuilder();
    abort.current = new AbortController();
    setRunning(true);
    setSteps([]);
    setOutput(undefined);
    setRunError(undefined);
    let raf = 0;
    const flush = () => {
      raf = 0;
      const wf = b.blocks.find((x) => x.type === 'workflow') as BlockOf<'workflow'> | undefined;
      setSteps(wf ? wf.steps.map((s) => ({ ...s, blocks: s.blocks.map((x) => ({ ...x })) })) : []);
      const text = blocksToText(b.blocks.filter((x) => x.type === 'text'));
      if (text) setOutput(text);
    };
    try {
      await streamPost(
        '/workflows/run',
        { graph, input, maxSteps },
        (ev) => {
          if (ev.type === 'error' || ev.type === 'warning') setRunError(ev.message);
          b.add(ev);
          if (!raf) raf = requestAnimationFrame(flush);
        },
        abort.current.signal,
      );
    } catch (e) {
      if (!abort.current.signal.aborted) setRunError((e as Error).message);
    } finally {
      cancelAnimationFrame(raf);
      b.finalize();
      flush();
      setRunning(false);
    }
  };

  const others = graph.nodes.filter((n) => n.id !== selected);

  return (
    <EditorContext.Provider value={{ status, agents: agentMap }}>
      <div className="flex h-full flex-col">
        {/* toolbar */}
        <div className="flex items-center gap-2 border-b border-line px-3 py-2">
          <Link href="/workflows" className="rounded-md p-1.5 text-ink-3 hover:bg-raised hover:text-ink" aria-label="Back">
            <ArrowLeft className="h-4 w-4" />
          </Link>
          <input
            value={name}
            disabled={readOnly}
            onChange={(e) => (setName(e.target.value), markDirty())}
            className="min-w-0 flex-1 bg-transparent text-sm font-semibold outline-none"
          />
          <span className={clsx('rounded-full px-2 py-0.5 text-[11px]', published ? 'bg-accent-soft text-accent' : 'bg-raised text-ink-3')}>
            {published ? 'Published' : 'Draft'}
          </span>
          {!readOnly && (
            <>
              <div className="mx-2 flex items-center gap-1 border-l border-line pl-3">
                <Button size="sm" variant="ghost" onClick={() => addNode('agent')}>
                  <Bot className="h-3.5 w-3.5" /> Agent
                </Button>
                <Button size="sm" variant="ghost" onClick={() => addNode('condition')}>
                  <GitBranch className="h-3.5 w-3.5" /> Condition
                </Button>
                <Button size="sm" variant="ghost" onClick={() => addNode('join')}>
                  <GitMerge className="h-3.5 w-3.5" /> Join
                </Button>
                <Button size="sm" variant="ghost" onClick={() => addNode('end')}>
                  <Flag className="h-3.5 w-3.5" /> End
                </Button>
              </div>
              <Button size="sm" onClick={() => save()} disabled={saving || !dirty}>
                <Save className="h-3.5 w-3.5" /> {dirty ? 'Save' : 'Saved'}
              </Button>
              <Button size="sm" variant={published ? 'default' : 'primary'} disabled={saving || (!published && problems.length > 0)} onClick={() => save({ published: !published })}>
                {published ? 'Unpublish' : 'Publish'}
              </Button>
            </>
          )}
        </div>
        {message && (
          <div className={clsx('px-4 py-1.5 text-xs', message.kind === 'ok' ? 'bg-accent-soft text-accent' : 'bg-danger/10 text-danger')}>{message.text}</div>
        )}

        <div className="flex min-h-0 flex-1">
          {/* canvas */}
          <div className="relative min-w-0 flex-1">
            <ReactFlow
              nodes={nodes}
              edges={edges}
              nodeTypes={nodeTypes}
              colorMode={dark ? 'dark' : 'light'}
              onNodesChange={(c) => {
                onNodesChange(c);
                if (c.some((x) => x.type === 'position' || x.type === 'remove')) markDirty();
              }}
              onEdgesChange={(c) => {
                onEdgesChange(c);
                if (c.some((x) => x.type === 'remove')) markDirty();
              }}
              onConnect={onConnect}
              onSelectionChange={({ nodes: sel }) => setSelected(sel[0]?.id ?? null)}
              nodesDraggable={!readOnly}
              nodesConnectable={!readOnly}
              deleteKeyCode={readOnly ? null : ['Backspace', 'Delete']}
              fitView
              fitViewOptions={{ padding: 0.15, maxZoom: 1 }}
              proOptions={{ hideAttribution: true }}
            >
              <Background gap={20} size={1} />
              <Controls showInteractive={false} />
            </ReactFlow>
            {problems.length > 0 && !readOnly && (
              <div className="absolute bottom-3 left-14 max-w-md rounded-lg border border-line bg-bg/95 px-3 py-2 text-[11px] text-ink-2 shadow-sm">
                <div className="mb-0.5 font-medium text-ink">To publish:</div>
                {problems.slice(0, 4).map((p, i) => (
                  <div key={i}>• {p}</div>
                ))}
                {problems.length > 4 && <div className="text-ink-3">…and {problems.length - 4} more</div>}
              </div>
            )}
          </div>

          {/* side panel */}
          <aside className="flex w-96 shrink-0 flex-col border-l border-line bg-panel">
            <div className="max-h-[50%] overflow-y-auto border-b border-line p-4">
              {selectedNode ? (
                <Inspector
                  node={selectedNode}
                  others={others}
                  agents={agents}
                  readOnly={readOnly}
                  onChange={(p) => patchNode(selectedNode.id, p)}
                  onRenameBranch={(from, to) => renameBranch(selectedNode.id, from, to)}
                  onDelete={() => {
                    setNodes((ns) => ns.filter((n) => n.id !== selectedNode.id));
                    setEdges((es) => es.filter((e) => e.source !== selectedNode.id && e.target !== selectedNode.id));
                    setSelected(null);
                    markDirty();
                  }}
                />
              ) : (
                <fieldset disabled={readOnly} className="space-y-3">
                  <h3 className="text-sm font-semibold">Workflow</h3>
                  <label className="block text-[11px] font-medium text-ink-2">
                    Description (shown in the agent picker)
                    <textarea rows={2} className={`${inputCls} mt-1`} value={description} onChange={(e) => (setDescription(e.target.value), markDirty())} />
                  </label>
                  <label className="block text-[11px] font-medium text-ink-2">
                    Max steps per run (stops loops)
                    <input type="number" min={1} max={50} className={`${inputCls} mt-1 w-24`} value={maxSteps} onChange={(e) => (setMaxSteps(Number(e.target.value)), markDirty())} />
                  </label>
                  <p className="text-xs text-ink-3">
                    Select a step to configure it. Drag between dots to connect steps; several connections out of one step run in parallel. Owner: {workflow.ownerName}
                  </p>
                  {!readOnly && (
                    <Button
                      size="sm"
                      variant="ghost"
                      className="text-danger"
                      onClick={async () => {
                        if (!confirm('Delete this workflow?')) return;
                        await api(`/workflows/${workflow.id}`, { method: 'DELETE' });
                        qc.invalidateQueries({ queryKey: ['workflows'] });
                        qc.invalidateQueries({ queryKey: ['agents'] });
                        router.push('/workflows');
                      }}
                    >
                      <Trash2 className="h-3.5 w-3.5" /> Delete workflow
                    </Button>
                  )}
                </fieldset>
              )}
            </div>

            {/* test run */}
            <div className="flex min-h-0 flex-1 flex-col p-4">
              <h3 className="mb-2 text-sm font-semibold">Test run</h3>
              {readOnly ? (
                <p className="text-xs text-ink-3">Use this workflow from chat: pick “{workflow.name}” in the agent picker.</p>
              ) : (
                <>
                  <textarea
                    rows={3}
                    className={inputCls}
                    placeholder="Message to run through the workflow, e.g. Write an HCP email introducing CARDIVEXA"
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                  />
                  <div className="mt-2 flex gap-2">
                    {running ? (
                      <Button size="sm" onClick={() => abort.current?.abort()}>
                        <Square className="h-3 w-3" /> Stop
                      </Button>
                    ) : (
                      <Button size="sm" variant="primary" disabled={!input.trim() || problems.length > 0} onClick={run}>
                        <Play className="h-3 w-3" /> Run
                      </Button>
                    )}
                    {running && <Spinner className="mt-1.5 text-ink-3" />}
                  </div>
                  <div className="mt-3 min-h-0 flex-1 space-y-1 overflow-y-auto">
                    {steps
                      .filter((s) => s.kind !== 'start' && s.kind !== 'end')
                      .map((s, i) => (
                        <StepRow key={`${s.nodeId}-${s.run}-${i}`} step={s} streaming={running} ctx={{ agentId: undefined, question: input }} />
                      ))}
                    {runError && <p className="text-xs text-danger">{runError}</p>}
                    {output && (
                      <div className="mt-2 rounded-lg border border-line bg-bg p-3">
                        <div className="mb-1 text-[11px] font-medium uppercase tracking-wide text-ink-3">Final answer</div>
                        <Markdown text={output} />
                      </div>
                    )}
                  </div>
                </>
              )}
            </div>
          </aside>
        </div>
      </div>
    </EditorContext.Provider>
  );
}
