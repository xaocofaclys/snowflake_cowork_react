import type { AgentInfo, WorkflowGraph } from '@cowork/shared';

export type TemplateKind = 'sequential' | 'parallel' | 'conditional';

export const TEMPLATES: { kind: TemplateKind; name: string; description: string }[] = [
  { kind: 'sequential', name: 'Sequential', description: 'Generator → reviewer. Each agent gets the previous one\'s output.' },
  { kind: 'parallel', name: 'Parallel', description: 'Both agents work on the same brief at once; results are joined.' },
  { kind: 'conditional', name: 'Conditional (review loop)', description: 'Generate → review → AI_CLASSIFY pass/fail. Fail loops back with feedback.' },
];

/** Picks a "generator" and a "reviewer" from the available agents by name; falls back to the first two (or one twice). */
export function pickRoles(agents: AgentInfo[]) {
  const list = agents.filter((a) => a.kind === 'agent');
  const reviewer = list.find((a) => /mlr|guard|review|compliance/i.test(a.name)) ?? list[1] ?? list[0];
  const generator = list.find((a) => a !== reviewer && /content|generat|writ|draft/i.test(a.name)) ?? list.find((a) => a !== reviewer) ?? reviewer;
  return { generator, reviewer };
}

export function buildTemplate(kind: TemplateKind, agents: AgentInfo[]): { name: string; graph: WorkflowGraph } {
  const { generator, reviewer } = pickRoles(agents);
  const gen = generator?.id ?? '';
  const rev = reviewer?.id ?? '';
  const genLabel = generator?.displayName ?? 'Generator';
  const revLabel = reviewer?.displayName ?? 'Reviewer';

  if (kind === 'sequential') {
    return {
      name: `${genLabel} → ${revLabel}`,
      graph: {
        nodes: [
          { id: 'start', type: 'start', position: { x: 0, y: 120 } },
          { id: 'generator', type: 'agent', label: genLabel, agentId: gen, inputTemplate: '{{input}}', position: { x: 220, y: 100 } },
          {
            id: 'reviewer',
            type: 'agent',
            label: revLabel,
            agentId: rev,
            inputTemplate: 'Review the following content for MLR compliance and give a clear verdict (PASS or FAIL) with reasons:\n\n{{previous.output}}',
            position: { x: 480, y: 100 },
          },
          { id: 'end', type: 'end', outputTemplate: '## Content\n\n{{nodes.generator.output}}\n\n## Review\n\n{{nodes.reviewer.output}}', position: { x: 740, y: 120 } },
        ],
        edges: [
          { id: 'e1', source: 'start', target: 'generator' },
          { id: 'e2', source: 'generator', target: 'reviewer' },
          { id: 'e3', source: 'reviewer', target: 'end' },
        ],
      },
    };
  }

  if (kind === 'parallel') {
    return {
      name: `${genLabel} ‖ ${revLabel}`,
      graph: {
        nodes: [
          { id: 'start', type: 'start', position: { x: 0, y: 160 } },
          { id: 'a', type: 'agent', label: genLabel, agentId: gen, inputTemplate: '{{input}}', position: { x: 240, y: 40 } },
          { id: 'b', type: 'agent', label: revLabel, agentId: rev, inputTemplate: '{{input}}', position: { x: 240, y: 260 } },
          { id: 'join', type: 'join', position: { x: 540, y: 160 } },
          { id: 'end', type: 'end', position: { x: 760, y: 160 } },
        ],
        edges: [
          { id: 'e1', source: 'start', target: 'a' },
          { id: 'e2', source: 'start', target: 'b' },
          { id: 'e3', source: 'a', target: 'join' },
          { id: 'e4', source: 'b', target: 'join' },
          { id: 'e5', source: 'join', target: 'end' },
        ],
      },
    };
  }

  return {
    name: `${genLabel} with ${revLabel} loop`,
    graph: {
      nodes: [
        { id: 'start', type: 'start', position: { x: 0, y: 140 } },
        {
          id: 'generator',
          type: 'agent',
          label: genLabel,
          agentId: gen,
          inputTemplate: '{{input}}\n\nIf reviewer feedback follows, revise the content to address every point:\n{{nodes.reviewer.output}}',
          position: { x: 220, y: 120 },
        },
        {
          id: 'reviewer',
          type: 'agent',
          label: revLabel,
          agentId: rev,
          inputTemplate: 'Review the following content for MLR compliance. Start your answer with "Verdict: PASS" or "Verdict: FAIL", then list the issues:\n\n{{previous.output}}',
          position: { x: 480, y: 120 },
        },
        {
          id: 'check',
          type: 'condition',
          label: 'Approved?',
          method: 'classify',
          branches: ['pass', 'fail'],
          instructions: 'Did the compliance review approve the content (pass) or require changes (fail)?',
          inputTemplate: '{{previous.output}}',
          position: { x: 740, y: 120 },
        },
        { id: 'end', type: 'end', outputTemplate: '## Approved content\n\n{{nodes.generator.output}}\n\n## Review\n\n{{nodes.reviewer.output}}', position: { x: 1000, y: 40 } },
      ],
      edges: [
        { id: 'e1', source: 'start', target: 'generator' },
        { id: 'e2', source: 'generator', target: 'reviewer' },
        { id: 'e3', source: 'reviewer', target: 'check' },
        { id: 'e4', source: 'check', target: 'end', branch: 'pass' },
        { id: 'e5', source: 'check', target: 'generator', branch: 'fail' },
      ],
    },
  };
}
