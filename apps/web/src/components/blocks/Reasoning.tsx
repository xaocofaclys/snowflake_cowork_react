'use client';

import { Brain, Check, ChevronRight } from 'lucide-react';
import { useState } from 'react';
import type { BlockOf } from '@cowork/shared';
import { Spinner } from '../ui';

/** Collapsible agent progress: status steps plus streamed thinking. */
export function Reasoning({ steps, thinking, streaming }: { steps?: BlockOf<'steps'>; thinking: BlockOf<'thinking'>[]; streaming: boolean }) {
  const [open, setOpen] = useState(false);
  const list = steps?.steps ?? [];
  const current = list[list.length - 1];
  const text = thinking.map((t) => t.text).join('\n\n').trim();
  if (!list.length && !text) return null;

  return (
    <div className="mb-2">
      <button onClick={() => setOpen((o) => !o)} className="inline-flex items-center gap-1.5 text-xs text-ink-3 hover:text-ink-2">
        {streaming ? <Spinner className="h-3.5 w-3.5" /> : <Brain className="h-3.5 w-3.5" />}
        <span>{streaming && current ? current.message : `Reasoned in ${list.length || 1} step${list.length === 1 ? '' : 's'}`}</span>
        <ChevronRight className={`h-3.5 w-3.5 transition-transform ${open ? 'rotate-90' : ''}`} />
      </button>
      {open && (
        <div className="mt-2 space-y-2 border-l-2 border-line pl-3 text-xs text-ink-2">
          {list.map((s, i) => (
            <div key={i} className="flex items-center gap-1.5">
              {streaming && i === list.length - 1 ? <Spinner className="h-3 w-3" /> : <Check className="h-3 w-3 text-ink-3" />}
              {s.message}
            </div>
          ))}
          {text && <p className="whitespace-pre-wrap italic text-ink-3">{text}</p>}
        </div>
      )}
    </div>
  );
}
