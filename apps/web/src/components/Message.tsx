'use client';

import { AlertTriangle, BookMarked, Check, Copy, Sparkle, ThumbsDown, ThumbsUp } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { blocksToText, type BlockOf, type ContentBlock } from '@cowork/shared';
import { api } from '@/lib/api';
import { Markdown } from './Markdown';
import { Reasoning } from './blocks/Reasoning';
import { ResultCard, type ResultContext, type ResultGroup } from './blocks/ResultCard';
import { IconButton } from './ui';

export function UserMessage({ text }: { text: string }) {
  return (
    <div className="flex justify-end">
      <div className="max-w-[80%] whitespace-pre-wrap rounded-2xl bg-raised px-4 py-2.5 text-[15px]">{text}</div>
    </div>
  );
}

type Item =
  | { kind: 'text'; block: BlockOf<'text'> }
  | { kind: 'result'; group: ResultGroup }
  | { kind: 'error'; message: string };

/** Groups tool/table/chart blocks by tool call so each renders as one result card. */
function layout(blocks: ContentBlock[]) {
  const items: Item[] = [];
  const groups = new Map<string, ResultGroup>();
  const group = (id: string) => {
    let g = groups.get(id);
    if (!g) {
      g = { toolUseId: id, tables: [], charts: [] };
      groups.set(id, g);
      items.push({ kind: 'result', group: g });
    }
    return g;
  };
  let steps: BlockOf<'steps'> | undefined;
  const thinking: BlockOf<'thinking'>[] = [];
  for (const b of blocks) {
    if (b.type === 'steps') steps = b;
    else if (b.type === 'thinking') thinking.push(b);
    else if (b.type === 'text') b.text.trim() && items.push({ kind: 'text', block: b });
    else if (b.type === 'tool') {
      // data_to_chart is a helper tool; its chart attaches to the analyst call it charts.
      if (b.toolType !== 'data_to_chart') group(b.toolUseId).tool = b;
    } else if (b.type === 'table') group(b.toolUseId).tables.push(b);
    else if (b.type === 'chart') {
      const target = groups.get(b.toolUseId) ?? [...groups.values()].reverse().find((g) => g.tables.length);
      (target ?? group(b.toolUseId)).charts.push(b);
    } else if (b.type === 'error') items.push({ kind: 'error', message: b.message });
  }
  return { steps, thinking, items };
}

export function AssistantMessage({
  blocks,
  streaming = false,
  ctx,
  feedback,
  memorySaved,
}: {
  blocks: ContentBlock[];
  streaming?: boolean;
  ctx: ResultContext;
  feedback?: 'up' | 'down' | null;
  memorySaved?: string[];
}) {
  const { steps, thinking, items } = layout(blocks);
  const lastText = [...items].reverse().find((i) => i.kind === 'text');
  return (
    <div className="group">
      <Reasoning steps={steps} thinking={thinking} streaming={streaming} />
      {items.map((it, i) =>
        it.kind === 'text' ? (
          <div key={i}>
            <Markdown text={it.block.text} caret={streaming && it === lastText} />
            {!!it.block.annotations?.length && <Citations annotations={it.block.annotations} />}
          </div>
        ) : it.kind === 'result' ? (
          <ResultCard key={it.group.toolUseId} group={it.group} ctx={ctx} streaming={streaming} />
        ) : (
          <div key={i} className="my-2 flex items-start gap-2 rounded-lg border border-danger/30 bg-danger/5 px-3 py-2 text-sm text-danger">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            {it.message}
          </div>
        ),
      )}
      {streaming && !items.length && !steps && <div className="caret text-ink-3" />}
      {!!memorySaved?.length && (
        <Link href="/settings#memory" className="mt-2 inline-flex items-center gap-1.5 rounded-full bg-accent-soft px-2.5 py-1 text-xs text-accent">
          <Sparkle className="h-3 w-3" /> Memory updated: {memorySaved.join('; ')}
        </Link>
      )}
      {!streaming && ctx.messageId && <Actions blocks={blocks} messageId={ctx.messageId} initial={feedback ?? null} />}
    </div>
  );
}

function Citations({ annotations }: { annotations: NonNullable<BlockOf<'text'>['annotations']> }) {
  return (
    <div className="mt-1 flex flex-wrap gap-1.5">
      {annotations.map((a, i) => (
        <a
          key={i}
          href={a.url}
          target="_blank"
          rel="noreferrer"
          title={a.text}
          className="inline-flex max-w-xs items-center gap-1 truncate rounded-md border border-line bg-panel px-2 py-0.5 text-[11px] text-ink-2 hover:text-ink"
        >
          <BookMarked className="h-3 w-3 shrink-0" />
          <span className="truncate">
            [{a.index ?? i + 1}] {a.title ?? a.docId ?? 'Source'}
          </span>
        </a>
      ))}
    </div>
  );
}

function Actions({ blocks, messageId, initial }: { blocks: ContentBlock[]; messageId: string; initial: 'up' | 'down' | null }) {
  const [fb, setFb] = useState(initial);
  const [copied, setCopied] = useState(false);
  const vote = async (v: 'up' | 'down') => {
    const next = fb === v ? null : v;
    setFb(next);
    await api(`/messages/${messageId}/feedback`, { method: 'POST', json: { feedback: next } });
  };
  return (
    <div className="mt-2 flex gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
      <IconButton
        label="Copy"
        onClick={() => {
          navigator.clipboard.writeText(blocksToText(blocks));
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        }}
      >
        {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
      </IconButton>
      <IconButton label="Good response" onClick={() => vote('up')} className={fb === 'up' ? 'text-accent' : ''}>
        <ThumbsUp className="h-3.5 w-3.5" />
      </IconButton>
      <IconButton label="Bad response" onClick={() => vote('down')} className={fb === 'down' ? 'text-accent' : ''}>
        <ThumbsDown className="h-3.5 w-3.5" />
      </IconButton>
    </div>
  );
}
