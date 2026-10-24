'use client';

import clsx from 'clsx';
import { Bot, CheckCircle2, ChevronRight, CircleDot, Flag, GitBranch, GitMerge, LayoutDashboard, Play, Telescope, XCircle } from 'lucide-react';
import { useState } from 'react';
import type { WorkflowStep } from '@cowork/shared';
import type { ResultContext } from './blocks/ResultCard';
import { Markdown } from './Markdown';
import { AssistantMessage } from './Message';
import { Spinner } from './ui';

export const KIND_ICON = { start: Play, agent: Bot, condition: GitBranch, join: GitMerge, end: Flag, research: Telescope, tile: LayoutDashboard } as Record<string, typeof Bot>;

/** Step-by-step view of a workflow run: each node, its status, branch decisions and the agent's own output. */
export function WorkflowTrace({ steps, streaming, ctx }: { steps: WorkflowStep[]; streaming?: boolean; ctx: ResultContext }) {
  const visible = steps.filter((s) => s.kind !== 'start' && s.kind !== 'end');
  const done = visible.filter((s) => s.status !== 'running').length;
  const [open, setOpen] = useState(false);
  const running = visible.find((s) => s.status === 'running');
  const isResearch = visible.some((s) => s.kind === 'research');
  const isDashboard = visible.some((s) => s.kind === 'tile');
  const Icon = isDashboard ? LayoutDashboard : isResearch ? Telescope : GitBranch;
  const noun = isDashboard ? 'tile' : isResearch ? 'question' : 'step';

  return (
    <div className="my-2 rounded-xl border border-line bg-panel">
      <button onClick={() => setOpen((o) => !o)} className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs text-ink-2">
        {streaming && running ? <Spinner className="h-3.5 w-3.5" /> : <Icon className="h-3.5 w-3.5 text-ink-3" />}
        <span className="font-medium text-ink">{isDashboard ? 'Building dashboard' : isResearch ? 'Deep research' : 'Workflow'}</span>
        <span className="truncate">
          {streaming && running
            ? isResearch || isDashboard
              ? `${done} of ${visible.length} ${noun}s done`
              : `Running ${running.label}…`
            : `${done} ${noun}${done === 1 ? '' : 's'}`}
        </span>
        <span className="ml-1 flex items-center gap-1">
          {visible.map((s, i) => (
            <StatusDot key={i} status={s.status} />
          ))}
        </span>
        <ChevronRight className={clsx('ml-auto h-3.5 w-3.5 transition-transform', open && 'rotate-90')} />
      </button>
      {open && (
        <div className="space-y-1 border-t border-line p-2">
          {visible.map((s, i) => (
            <StepRow key={`${s.nodeId}-${s.run}-${i}`} step={s} streaming={streaming} ctx={ctx} />
          ))}
        </div>
      )}
    </div>
  );
}

function StatusDot({ status }: { status: WorkflowStep['status'] }) {
  return (
    <span
      className={clsx(
        'inline-block h-1.5 w-1.5 rounded-full',
        status === 'success' && 'bg-accent',
        status === 'error' && 'bg-danger',
        status === 'running' && 'animate-pulse bg-ink-3',
        status === 'skipped' && 'bg-line',
      )}
    />
  );
}

export function StepRow({ step, streaming, ctx }: { step: WorkflowStep; streaming?: boolean; ctx: ResultContext }) {
  const [open, setOpen] = useState(false);
  const Icon = KIND_ICON[step.kind] ?? CircleDot;
  return (
    <div className="rounded-lg bg-bg">
      <button onClick={() => setOpen((o) => !o)} className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-xs">
        <Icon className="h-3.5 w-3.5 text-ink-3" />
        <span className="font-medium">{step.label}</span>
        {step.run > 1 && <span className="rounded bg-raised px-1 text-[10px] text-ink-3">run {step.run}</span>}
        {step.decision && (
          <span className="rounded-full bg-accent-soft px-2 py-0.5 text-[10px] font-medium text-accent">→ {step.decision}</span>
        )}
        <span className="ml-auto">
          {step.status === 'running' ? (
            <Spinner className="h-3.5 w-3.5" />
          ) : step.status === 'error' ? (
            <XCircle className="h-3.5 w-3.5 text-danger" />
          ) : (
            <CheckCircle2 className="h-3.5 w-3.5 text-ink-3" />
          )}
        </span>
      </button>
      {open && (
        <div className="space-y-2 border-t border-line px-3 py-2">
          {step.input && (
            <details className="text-xs text-ink-2">
              <summary className="cursor-pointer text-ink-3">Input</summary>
              <pre className="mt-1 max-h-48 overflow-auto whitespace-pre-wrap rounded bg-raised p-2 font-sans">{step.input}</pre>
            </details>
          )}
          {step.error && <p className="text-xs text-danger">{step.error}</p>}
          {step.kind === 'agent' || step.kind === 'research' || step.kind === 'tile' ? (
            <AssistantMessage blocks={step.blocks} streaming={streaming && step.status === 'running'} ctx={{ ...ctx, messageId: undefined }} />
          ) : (
            step.output && <Markdown text={step.output} />
          )}
        </div>
      )}
    </div>
  );
}
