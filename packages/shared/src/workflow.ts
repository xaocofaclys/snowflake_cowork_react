/**
 * Workflows compose existing Cortex agents. Nothing in a graph calls an LLM
 * except condition nodes using the `classify` method (AI_CLASSIFY).
 *
 *   sequential   start → agent A → agent B → end
 *   parallel     start → A, B (fan-out) → join → end
 *   conditional  … → condition → branch edges (labelled) → …   (loops allowed, bounded by maxSteps)
 */

export interface XY {
  x: number;
  y: number;
}

interface NodeBase {
  id: string;
  label?: string;
  position: XY;
}

export interface StartNode extends NodeBase {
  type: 'start';
}

export interface AgentNode extends NodeBase {
  type: 'agent';
  agentId: string;
  /** What the agent receives. Variables: {{input}}, {{previous.output}}, {{nodes.<id>.output}} */
  inputTemplate: string;
}

export type ConditionMethod = 'classify' | 'rule';

export interface ConditionNode extends NodeBase {
  type: 'condition';
  /** Text that gets classified. Defaults to {{previous.output}}. */
  inputTemplate: string;
  method: ConditionMethod;
  /** Branch labels; outgoing edges carry one of these in `branch`. */
  branches: string[];
  /** classify: optional task description passed to AI_CLASSIFY. */
  instructions?: string;
  /** rule: first branch whose keywords appear (case-insensitive) wins; else `defaultBranch`. */
  rules?: { branch: string; keywords: string[] }[];
  defaultBranch?: string;
}

export interface JoinNode extends NodeBase {
  type: 'join';
}

export interface EndNode extends NodeBase {
  type: 'end';
  /** Final answer. Defaults to {{previous.output}}. */
  outputTemplate?: string;
}

export type WorkflowNode = StartNode | AgentNode | ConditionNode | JoinNode | EndNode;
export type WorkflowNodeType = WorkflowNode['type'];

export interface WorkflowEdge {
  id: string;
  source: string;
  target: string;
  /** Set on edges leaving a condition node: the branch label that activates it. */
  branch?: string;
}

export interface WorkflowGraph {
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
}

export interface Workflow {
  id: string;
  userId: string;
  ownerName?: string;
  name: string;
  description?: string;
  graph: WorkflowGraph;
  published: boolean;
  /** Upper bound on node executions per run (protects loops). */
  maxSteps: number;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export const WORKFLOW_ID_PREFIX = 'workflow:';
export const DEFAULT_MAX_STEPS = 12;

export function isWorkflowAgentId(id: string): boolean {
  return id.startsWith(WORKFLOW_ID_PREFIX);
}

/** Basic structural validation shared by the builder UI and the API. Returns problems, empty when valid. */
export function validateGraph(g: WorkflowGraph): string[] {
  const problems: string[] = [];
  const ids = new Set(g.nodes.map((n) => n.id));
  const starts = g.nodes.filter((n) => n.type === 'start');
  if (starts.length !== 1) problems.push('A workflow needs exactly one Start node.');
  if (!g.nodes.some((n) => n.type === 'end')) problems.push('Add an End node.');
  for (const e of g.edges) {
    if (!ids.has(e.source) || !ids.has(e.target)) problems.push(`Edge ${e.id} points to a missing node.`);
  }
  const baseName = (n: WorkflowNode) => n.label || n.type;
  // Steps can share a label (e.g. the same agent used twice); add the id so messages stay distinct.
  const name = (n: WorkflowNode) =>
    g.nodes.filter((o) => baseName(o) === baseName(n)).length > 1 ? `${baseName(n)} (${n.id})` : baseName(n);
  for (const n of g.nodes) {
    const out = g.edges.filter((e) => e.source === n.id);
    const label = name(n);
    if (n.type === 'agent' && !n.agentId) problems.push(`"${label}" has no agent selected.`);
    if (n.type !== 'end' && out.length === 0) problems.push(`"${label}" has no outgoing connection.`);
    if (n.type === 'condition') {
      if (n.branches.length < 2) problems.push(`"${label}" needs at least two branches.`);
      for (const e of out) {
        if (!e.branch || !n.branches.includes(e.branch)) problems.push(`A connection from "${label}" isn't assigned to a branch.`);
      }
    }
    if (n.type !== 'start' && !g.edges.some((e) => e.target === n.id)) problems.push(`"${label}" is not connected to anything.`);
  }
  return [...new Set(problems)];
}

/** Template rendering for node inputs: plain substitution, no logic. */
export function renderTemplate(
  template: string,
  vars: { input: string; previous: string; nodes: Record<string, string> },
): string {
  return template
    .replace(/\{\{\s*input\s*\}\}/g, vars.input)
    .replace(/\{\{\s*previous\.output\s*\}\}/g, vars.previous)
    .replace(/\{\{\s*nodes\.([\w-]+)\.output\s*\}\}/g, (_, id: string) => vars.nodes[id] ?? '')
    .trim();
}
