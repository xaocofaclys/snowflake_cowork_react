'use client';

import { Handle, Position, type Node, type NodeProps } from '@xyflow/react';
import clsx from 'clsx';
import { AlertTriangle } from 'lucide-react';
import { createContext, useContext, type ReactNode } from 'react';
import type { AgentInfo, WorkflowNode, WorkflowStep } from '@cowork/shared';
import { KIND_ICON } from '../WorkflowTrace';
import { Spinner } from '../ui';

export type FlowNode = Node<{ node: WorkflowNode }, WorkflowNode['type']>;

/** Live run state and agent names, shared with node renderers without touching node data. */
export const EditorContext = createContext<{
  status: Record<string, { status: WorkflowStep['status']; decision?: string; runs: number }>;
  agents: Record<string, AgentInfo>;
}>({ status: {}, agents: {} });

const handleCls = '!h-2.5 !w-2.5 !border-2 !border-bg !bg-ink-3';

function Shell({ id, kind, title, subtitle, warning, selected, children, wide }: {
  id: string;
  kind: WorkflowNode['type'];
  title: string;
  subtitle?: string;
  warning?: string;
  selected?: boolean;
  children?: ReactNode;
  wide?: boolean;
}) {
  const { status } = useContext(EditorContext);
  const s = status[id];
  const Icon = KIND_ICON[kind];
  return (
    <div
      className={clsx(
        'rounded-xl border bg-bg shadow-sm transition-shadow',
        wide ? 'w-56' : 'w-48',
        selected ? 'border-accent ring-2 ring-accent/25' : 'border-line',
        s?.status === 'running' && 'ring-2 ring-accent/50 animate-pulse',
        s?.status === 'success' && !selected && 'border-accent/60',
        s?.status === 'error' && 'border-danger ring-2 ring-danger/20',
      )}
    >
      <div className="flex items-center gap-2 px-3 py-2">
        <span className={clsx('flex h-6 w-6 shrink-0 items-center justify-center rounded-md', kind === 'agent' ? 'bg-accent-soft text-accent' : 'bg-raised text-ink-2')}>
          <Icon className="h-3.5 w-3.5" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="truncate text-xs font-semibold">{title}</div>
          {subtitle && <div className="truncate text-[10px] text-ink-3">{subtitle}</div>}
        </div>
        {s?.status === 'running' && <Spinner className="h-3 w-3" />}
        {s && s.runs > 1 && <span className="rounded bg-raised px-1 text-[9px] text-ink-3">×{s.runs}</span>}
      </div>
      {warning && (
        <div className="flex items-center gap-1 border-t border-line px-3 py-1 text-[10px] text-danger">
          <AlertTriangle className="h-3 w-3" /> {warning}
        </div>
      )}
      {children}
    </div>
  );
}

function StartView({ id, selected }: NodeProps<FlowNode>) {
  return (
    <>
      <Shell id={id} kind="start" title="Start" subtitle="User's message → {{input}}" selected={selected} />
      <Handle type="source" position={Position.Right} className={handleCls} />
    </>
  );
}

function AgentView({ id, data, selected }: NodeProps<FlowNode>) {
  const { agents } = useContext(EditorContext);
  const n = data.node.type === 'agent' ? data.node : null;
  const agent = n ? agents[n.agentId] : undefined;
  return (
    <>
      <Handle type="target" position={Position.Left} className={handleCls} />
      <Shell
        id={id}
        kind="agent"
        title={data.node.label || agent?.displayName || 'Agent'}
        subtitle={agent ? agent.id : n?.agentId || undefined}
        warning={!n?.agentId ? 'Pick an agent' : !agent ? 'Agent not visible to your role' : undefined}
        selected={selected}
        wide
      />
      <Handle type="source" position={Position.Right} className={handleCls} />
    </>
  );
}

function ConditionView({ id, data, selected }: NodeProps<FlowNode>) {
  const { status } = useContext(EditorContext);
  const n = data.node.type === 'condition' ? data.node : null;
  const decision = status[id]?.decision;
  return (
    <>
      <Handle type="target" position={Position.Left} className={handleCls} />
      <Shell id={id} kind="condition" title={data.node.label || 'Condition'} subtitle={n?.method === 'rule' ? 'Keyword rules' : 'AI_CLASSIFY'} selected={selected} wide>
        <div className="border-t border-line py-1">
          {(n?.branches ?? []).map((b) => (
            <div key={b} className="relative flex items-center justify-end px-3 py-1 text-[11px]">
              <span className={clsx('rounded-full px-2 py-0.5', decision === b ? 'bg-accent text-accent-ink' : 'bg-raised text-ink-2')}>{b}</span>
              <Handle type="source" id={b} position={Position.Right} className={handleCls} style={{ top: '50%' }} />
            </div>
          ))}
        </div>
      </Shell>
    </>
  );
}

function JoinView({ id, selected }: NodeProps<FlowNode>) {
  return (
    <>
      <Handle type="target" position={Position.Left} className={handleCls} />
      <Shell id={id} kind="join" title="Join" subtitle="Waits for all branches" selected={selected} />
      <Handle type="source" position={Position.Right} className={handleCls} />
    </>
  );
}

function EndView({ id, data, selected }: NodeProps<FlowNode>) {
  return (
    <>
      <Handle type="target" position={Position.Left} className={handleCls} />
      <Shell id={id} kind="end" title={data.node.label || 'End'} subtitle="Final answer" selected={selected} />
    </>
  );
}

export const nodeTypes = { start: StartView, agent: AgentView, condition: ConditionView, join: JoinView, end: EndView };
