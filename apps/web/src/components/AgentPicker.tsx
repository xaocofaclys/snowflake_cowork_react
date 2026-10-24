'use client';

import { Bot, Check, ChevronDown, Sparkles, Workflow } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { AUTO_AGENT_ID, type AgentInfo } from '@cowork/shared';

export function AgentPicker({ agents, value, onChange, disabled }: { agents: AgentInfo[]; value?: string; onChange: (id: string) => void; disabled?: boolean }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const isAuto = value === AUTO_AGENT_ID;
  const current = agents.find((a) => a.id === value);
  const hasChoice = agents.filter((a) => a.kind === 'agent').length > 1;

  useEffect(() => {
    const h = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false);
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, []);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen((o) => !o)}
        className="inline-flex h-8 items-center gap-1.5 rounded-lg px-2 text-xs font-medium text-ink-2 hover:bg-raised disabled:hover:bg-transparent"
      >
        {isAuto ? <Sparkles className="h-3.5 w-3.5" /> : current?.kind === 'workflow' ? <Workflow className="h-3.5 w-3.5" /> : <Bot className="h-3.5 w-3.5" />}
        {isAuto ? 'Auto' : (current?.displayName ?? 'Select agent')}
        {!disabled && <ChevronDown className="h-3 w-3" />}
      </button>
      {open && (
        <div className="absolute bottom-full left-0 z-30 mb-2 max-h-96 w-80 overflow-y-auto rounded-xl border border-line bg-bg p-1 shadow-lg">
          {agents.length === 0 && <div className="px-3 py-2 text-xs text-ink-3">No agents visible to your role.</div>}
          {hasChoice && (
            <button
              onClick={() => {
                onChange(AUTO_AGENT_ID);
                setOpen(false);
              }}
              className="flex w-full items-start gap-2 rounded-lg px-3 py-2 text-left hover:bg-raised"
            >
              <Sparkles className="mt-0.5 h-3.5 w-3.5 text-accent" />
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium">Auto</div>
                <div className="text-xs text-ink-3">Picks the right agent for each question; deep research can use several</div>
              </div>
              {isAuto && <Check className="mt-1 h-3.5 w-3.5 text-accent" />}
            </button>
          )}
          {(['agent', 'workflow'] as const).map((kind) => {
            const list = agents.filter((a) => a.kind === kind);
            if (!list.length) return null;
            return (
              <div key={kind}>
                <div className="px-3 pb-1 pt-2 text-[10px] font-medium uppercase tracking-wide text-ink-3">{kind === 'agent' ? 'Agents' : 'Workflows'}</div>
                {list.map((a) => (
            <button
              key={a.id}
              onClick={() => {
                onChange(a.id);
                setOpen(false);
              }}
              className="flex w-full items-start gap-2 rounded-lg px-3 py-2 text-left hover:bg-raised"
            >
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium">{a.displayName}</div>
                {a.description && <div className="truncate text-xs text-ink-3">{a.description}</div>}
                <div className="truncate font-mono text-[10px] text-ink-3">{a.kind === 'workflow' ? `workflow · by ${a.owner ?? 'unknown'}` : a.id}</div>
              </div>
              {a.id === value && <Check className="mt-1 h-3.5 w-3.5 text-accent" />}
            </button>
                ))}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
