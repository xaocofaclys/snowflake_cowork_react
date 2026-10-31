'use client';

import clsx from 'clsx';
import { Pause, Play } from 'lucide-react';
import { useMemo, useRef } from 'react';
import { fromMin, planTimeline, toMin, type RoutePlan } from '@cowork/shared';

/**
 * The day as a strip: drive → visit per stop, breaks, free windows and waiting, with a
 * scrubbable playhead that moves the "you are here" marker on the map.
 */
export function DayStrip({
  plan,
  minute,
  playing,
  label,
  hovered,
  onScrub,
  onPlay,
  onHover,
  onSelect,
}: {
  plan: RoutePlan;
  minute?: number;
  playing: boolean;
  label?: string;
  hovered?: string;
  onScrub: (m: number) => void;
  onPlay: () => void;
  onHover: (hcpId?: string) => void;
  onSelect: (hcpId: string) => void;
}) {
  const { segments, start, end } = useMemo(() => planTimeline(plan), [plan]);
  const bar = useRef<HTMLDivElement>(null);
  const from = Math.floor(start / 30) * 30;
  const to = Math.ceil(Math.max(end, start + 60) / 30) * 30;
  const pct = (m: number) => `${((m - from) / (to - from)) * 100}%`;
  const hours = [];
  for (let h = Math.ceil(from / 60) * 60; h <= to; h += 60) hours.push(h);
  const hardStop = toMin(plan.hardStop);

  const scrubAt = (clientX: number) => {
    const r = bar.current?.getBoundingClientRect();
    if (!r) return;
    onScrub(Math.round(from + Math.min(1, Math.max(0, (clientX - r.left) / r.width)) * (to - from)));
  };

  return (
    <div className="flex items-center gap-3 border-t border-line bg-bg/95 px-3 py-2.5 backdrop-blur md:px-4">
      <button
        onClick={onPlay}
        aria-label={playing ? 'Pause' : 'Play the day'}
        title={playing ? 'Pause' : 'Play the day on the map'}
        className="bg-brand flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-white shadow-soft transition hover:scale-105 active:scale-95"
      >
        {playing ? <Pause className="h-3.5 w-3.5" /> : <Play className="ml-0.5 h-3.5 w-3.5" />}
      </button>
      <div className="min-w-0 flex-1">
        <div className="mb-1 flex h-4 items-center justify-between text-[11px] text-ink-3">
          <span className="truncate font-medium text-ink-2">{minute !== undefined ? <><span className="tabular-nums text-ink">{fromMin(minute)}</span> · {label}</> : 'Drag along the day to follow the route'}</span>
          <span className="hidden shrink-0 items-center gap-2.5 sm:flex">
            <Key cls="bg-accent" text="Visit" />
            <Key cls="rp-hatch bg-raised" text="Drive" />
            <Key cls="bg-emerald-400/50" text="Free" />
            <Key cls="bg-amber-400/70" text="Break" />
          </span>
        </div>
        <div
          ref={bar}
          className="relative h-7 cursor-pointer touch-none select-none rounded-lg bg-raised/60"
          onPointerDown={(e) => {
            (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
            scrubAt(e.clientX);
          }}
          onPointerMove={(e) => e.buttons === 1 && scrubAt(e.clientX)}
        >
          {segments.map((s, i) => {
            const stop = s.stopIndex !== undefined ? plan.stops[s.stopIndex] : undefined;
            const hot = stop && hovered === stop.hcpId;
            return (
              <div
                key={i}
                title={`${fromMin(s.from)}–${fromMin(s.to)} · ${s.kind === 'visit' ? `${stop?.stop} ${stop?.hcpName}` : s.kind === 'drive' ? `Drive to ${stop?.stop}` : (s.label ?? s.kind)}`}
                onPointerEnter={() => stop && onHover(stop.hcpId)}
                onPointerLeave={() => stop && onHover(undefined)}
                onDoubleClick={() => stop && onSelect(stop.hcpId)}
                className={clsx(
                  'absolute top-1 bottom-1 flex items-center justify-center overflow-hidden text-[10px] font-semibold transition-[filter]',
                  s.kind === 'visit' && 'rounded-md bg-accent text-white',
                  s.kind === 'drive' && 'rp-hatch rounded-sm bg-raised',
                  s.kind === 'free' && 'rounded-md bg-emerald-400/40 text-emerald-800 dark:text-emerald-200',
                  s.kind === 'break' && 'rounded-md bg-amber-400/60 text-amber-900 dark:text-amber-100',
                  s.kind === 'wait' && 'border-y border-dashed border-line',
                  hot && 'brightness-110 ring-2 ring-accent/40',
                )}
                style={{ left: pct(s.from), width: `calc(${pct(s.to)} - ${pct(s.from)})` }}
              >
                {s.kind === 'visit' ? s.label : s.kind === 'break' || s.kind === 'free' ? <span className="truncate px-1">{s.kind === 'free' ? 'Free' : (s.label ?? 'Break')}</span> : null}
              </div>
            );
          })}
          {Number.isFinite(hardStop) && hardStop > from && hardStop < to && (
            <div className="absolute -top-1 -bottom-1 w-0.5 rounded bg-danger" style={{ left: pct(hardStop) }} title={`Hard stop ${plan.hardStop}`} />
          )}
          {minute !== undefined && (
            <div className="pointer-events-none absolute -top-1.5 -bottom-1.5 w-0.5 -translate-x-1/2 rounded bg-emerald-500 shadow" style={{ left: pct(minute) }}>
              <span className="absolute -top-1 left-1/2 h-2.5 w-2.5 -translate-x-1/2 rounded-full border-2 border-bg bg-emerald-500" />
            </div>
          )}
        </div>
        <div className="relative mt-0.5 h-3.5 text-[10px] tabular-nums text-ink-3">
          {hours.map((h) => (
            <span key={h} className="absolute -translate-x-1/2" style={{ left: pct(h) }}>
              {fromMin(h)}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

const Key = ({ cls, text }: { cls: string; text: string }) => (
  <span className="inline-flex items-center gap-1">
    <span className={clsx('h-2 w-3 rounded-sm', cls)} />
    {text}
  </span>
);
