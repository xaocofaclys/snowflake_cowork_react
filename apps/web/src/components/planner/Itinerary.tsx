'use client';

import clsx from 'clsx';
import {
  ArrowDown,
  ArrowUp,
  Building2,
  CalendarArrowUp,
  Car,
  Clock,
  Coffee,
  ExternalLink,
  FileText,
  GripVertical,
  Minus,
  Plus,
  RotateCcw,
  Search,
  Sparkles,
  Timer,
  TriangleAlert,
  X,
} from 'lucide-react';
import { useState, type ReactNode } from 'react';
import type { PlanAction, RoutePlan, RouteStop, StopChange, TerritoryHcp } from '@cowork/shared';
import { inputCls } from '../ui';
import { TIER_COLOR } from './RouteMap';

export type ActFn = (action: PlanAction, hcpId?: string, param?: string, label?: string) => void;

export function TierChip({ tier }: { tier?: string }) {
  if (!tier) return null;
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-line px-1.5 py-px text-[10px] font-semibold text-ink-2">
      <span className="h-1.5 w-1.5 rounded-full" style={{ background: TIER_COLOR[tier] }} />
      Tier {tier}
    </span>
  );
}

const CHANGE_LABEL: Record<StopChange, { text: string; cls: string }> = {
  added: { text: 'Added', cls: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300' },
  moved: { text: 'Moved', cls: 'bg-amber-500/15 text-amber-700 dark:text-amber-300' },
  retimed: { text: 'New time', cls: 'bg-accent-soft text-accent' },
};

export function Itinerary({
  plan,
  territory,
  selected,
  hovered,
  changed,
  busy,
  onSelect,
  onHover,
  act,
  ask,
}: {
  plan: RoutePlan;
  territory: TerritoryHcp[];
  selected?: string;
  hovered?: string;
  changed: Record<string, StopChange>;
  busy: boolean;
  onSelect: (id?: string) => void;
  onHover: (id?: string) => void;
  act: ActFn;
  ask: (text: string) => void;
}) {
  const [drag, setDrag] = useState<string>();
  const [drop, setDrop] = useState<number>();

  const onDrop = (i: number) => {
    if (drag && plan.stops[i]?.hcpId !== drag) {
      const s = plan.stops.find((x) => x.hcpId === drag);
      act('PIN', drag, String(i + 1), `Moved ${s?.hcpName ?? drag} to stop ${String.fromCharCode(65 + i)}`);
    }
    setDrag(undefined);
    setDrop(undefined);
  };

  return (
    <div className={clsx('space-y-4 p-4 transition-opacity', busy && 'pointer-events-none opacity-60')}>
      <div className="grid grid-cols-3 divide-x divide-line rounded-2xl border border-line bg-panel py-2.5 shadow-soft">
        <Stat value={String(plan.totals.visits)} label={plan.totals.visits === 1 ? 'visit' : 'visits'} />
        <Stat value={`${plan.totals.km} km`} label={`${plan.totals.driveMin} min driving`} />
        <Stat value={plan.totals.finishAt ?? '—'} label="finish" />
      </div>
      <DayControls plan={plan} act={act} />

      {plan.start && (
        <div className="flex items-center gap-3 rounded-2xl border border-line bg-panel p-3 shadow-soft">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-ink text-bg">
            <Building2 className="h-4 w-4" />
          </span>
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-medium">{plan.start.name}</div>
            <div className="text-xs text-ink-3">{plan.start.leaveAt ? <>Leave at <b className="tabular-nums text-ink">{plan.start.leaveAt}</b></> : 'Start of day'}</div>
          </div>
        </div>
      )}

      {!plan.stops.length && <div className="rounded-2xl border border-dashed border-line px-4 py-8 text-center text-xs text-ink-3">No visits fit this day. Add a doctor below or relax the hard stop.</div>}

      <ol className="space-y-0">
        {plan.stops.map((s, i) => (
          <li key={s.hcpId}>
            <Leg stop={s} />
            <div
              draggable
              onDragStart={(e) => {
                e.dataTransfer.effectAllowed = 'move';
                setDrag(s.hcpId);
              }}
              onDragEnd={() => {
                setDrag(undefined);
                setDrop(undefined);
              }}
              onDragOver={(e) => {
                if (!drag) return;
                e.preventDefault();
                setDrop(i);
              }}
              onDrop={(e) => {
                e.preventDefault();
                onDrop(i);
              }}
            >
              <StopCard
                stop={s}
                index={i}
                count={plan.stops.length}
                selected={selected === s.hcpId}
                hot={hovered === s.hcpId}
                change={changed[s.hcpId]}
                dragging={drag === s.hcpId}
                dropTarget={drop === i && drag !== s.hcpId}
                onSelect={() => onSelect(selected === s.hcpId ? undefined : s.hcpId)}
                onHover={onHover}
                act={act}
                ask={ask}
              />
            </div>
          </li>
        ))}
      </ol>

      {plan.stops.length > 0 && (
        <div className="flex items-center gap-2 px-1 text-xs text-ink-3">
          <span className="flex h-6 w-6 items-center justify-center rounded-full bg-raised">
            <Clock className="h-3.5 w-3.5" />
          </span>
          Day ends around <b className="tabular-nums text-ink">{plan.totals.finishAt ?? '—'}</b>
          {plan.hardStop && <span className="ml-auto rounded-full bg-danger/10 px-2 py-0.5 font-medium text-danger">Hard stop {plan.hardStop}</span>}
        </div>
      )}

      {(plan.freeWindows.length > 0 || plan.breaks.length > 0) && (
        <Section title="Free time & breaks">
          {plan.breaks.map((b, i) => (
            <Row key={`b${i}`} icon={<Coffee className="h-3.5 w-3.5" />} tone="amber" title={`${b.from}–${b.to}`} body={b.label ?? 'Break'} />
          ))}
          {plan.freeWindows.map((f, i) => (
            <Row
              key={`f${i}`}
              icon={<Sparkles className="h-3.5 w-3.5" />}
              tone="green"
              title={`${f.from}–${f.to}`}
              body={f.label ?? 'Free: admin, lunch or an extra tier-A call'}
              action={<button onClick={() => ask(`I have free time ${f.from}-${f.to}. Which nearby tier A doctor could I fit in?`)} className="text-[11px] font-medium text-accent hover:underline">Fill it</button>}
            />
          ))}
        </Section>
      )}

      {plan.unscheduled.length > 0 && (
        <Section title={`Couldn't fit (${plan.unscheduled.length})`}>
          {plan.unscheduled.map((u) => (
            <Row
              key={u.hcpId}
              icon={<TriangleAlert className="h-3.5 w-3.5" />}
              tone="red"
              title={u.hcpName}
              body={u.reason ?? 'Not enough time today'}
              onClick={() => onSelect(u.hcpId)}
              action={
                <button onClick={() => act('PUSH', u.hcpId, undefined, `Pushed ${u.hcpName} to the next day`)} className="whitespace-nowrap text-[11px] font-medium text-accent hover:underline">
                  Push to next day
                </button>
              }
            />
          ))}
        </Section>
      )}

      <AddDoctor plan={plan} territory={territory} act={act} />
    </div>
  );
}

function Leg({ stop }: { stop: RouteStop }) {
  if (stop.travelMin === undefined && stop.travelKm === undefined) return <div className="h-3" />;
  return (
    <div className="flex items-center gap-2 py-1.5 pl-[22px] text-[11px] text-ink-3">
      <span className="h-5 border-l-2 border-dashed border-line" />
      <Car className="h-3 w-3" />
      <span className="tabular-nums">
        {stop.travelKm !== undefined && `${stop.travelKm} km`}
        {stop.travelKm !== undefined && stop.travelMin !== undefined && ' · '}
        {stop.travelMin !== undefined && `${stop.travelMin} min`}
      </span>
    </div>
  );
}

function StopCard({
  stop: s,
  index,
  count,
  selected,
  hot,
  change,
  dragging,
  dropTarget,
  onSelect,
  onHover,
  act,
  ask,
}: {
  stop: RouteStop;
  index: number;
  count: number;
  selected: boolean;
  hot: boolean;
  change?: StopChange;
  dragging: boolean;
  dropTarget: boolean;
  onSelect: () => void;
  onHover: (id?: string) => void;
  act: ActFn;
  ask: (t: string) => void;
}) {
  const dwell = s.timeOnSiteMin ?? 20;
  const directions = s.legMapUrl ?? `https://www.google.com/maps/dir/?api=1&destination=${s.lat},${s.lon}`;
  return (
    <div
      onMouseEnter={() => onHover(s.hcpId)}
      onMouseLeave={() => onHover(undefined)}
      className={clsx(
        'group rounded-2xl border bg-panel shadow-soft transition',
        selected ? 'border-accent/50 ring-4 ring-accent/10' : hot ? 'border-accent/30' : 'border-line',
        dragging && 'opacity-40',
        dropTarget && 'translate-y-1 border-accent border-dashed',
      )}
    >
      <button onClick={onSelect} className="flex w-full items-start gap-3 p-3 text-left">
        <span className="relative mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-accent text-sm font-bold text-white shadow-soft">
          {s.stop}
          <GripVertical className="absolute -left-3.5 h-3.5 w-3.5 cursor-grab text-ink-3 opacity-0 transition group-hover:opacity-100" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-2">
            <span className="truncate text-sm font-medium">{s.hcpName}</span>
            {change && <span className={clsx('shrink-0 rounded-full px-1.5 py-px text-[10px] font-semibold', CHANGE_LABEL[change].cls)}>{CHANGE_LABEL[change].text}</span>}
          </span>
          <span className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-ink-3">
            <span className="font-medium tabular-nums text-ink-2">
              {s.arrive}–{s.depart}
            </span>
            {s.specialty && <span>{s.specialty}</span>}
            <TierChip tier={s.tier} />
          </span>
          {!selected && s.objective && <span className="mt-1 block truncate text-xs text-ink-3">{s.objective}</span>}
        </span>
      </button>

      {selected && (
        <div className="animate-fade-up space-y-3 border-t border-line px-3 pb-3 pt-3 text-xs">
          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 text-ink-2">
            {s.objective && <Dt label="Why">{s.objective}</Dt>}
            {s.focusProduct && <Dt label="Focus">{s.focusProduct}</Dt>}
            {(s.clinic || s.area) && <Dt label="Where">{[s.clinic, s.area].filter(Boolean).join(', ')}</Dt>}
            {s.availStart && <Dt label="Clinic">{s.availStart}–{s.availEnd}</Dt>}
            {s.priority && <Dt label="Priority">{s.priority}</Dt>}
          </dl>
          <div className="flex items-center justify-between rounded-xl bg-raised/60 px-2.5 py-1.5">
            <span className="flex items-center gap-1.5 text-ink-2">
              <Timer className="h-3.5 w-3.5" /> Time on site
            </span>
            <span className="flex items-center gap-1">
              <Step label="5 minutes less" disabled={dwell <= 5} onClick={() => act('DWELL', s.hcpId, String(dwell - 5), `${s.hcpName}: ${dwell - 5} min on site`)}>
                <Minus className="h-3 w-3" />
              </Step>
              <span className="w-12 text-center font-semibold tabular-nums text-ink">{dwell} min</span>
              <Step label="5 minutes more" onClick={() => act('DWELL', s.hcpId, String(dwell + 5), `${s.hcpName}: ${dwell + 5} min on site`)}>
                <Plus className="h-3 w-3" />
              </Step>
            </span>
          </div>
          <div className="grid grid-cols-2 gap-1.5">
            <Action icon={<FileText className="h-3.5 w-3.5" />} primary onClick={() => ask(`Prep me for ${s.hcpName} (${s.hcpId})`)}>
              Prep brief
            </Action>
            <Action icon={<ExternalLink className="h-3.5 w-3.5" />} href={directions}>
              Directions
            </Action>
            <Action icon={<ArrowUp className="h-3.5 w-3.5" />} disabled={index === 0} onClick={() => act('PIN', s.hcpId, String(index), `Moved ${s.hcpName} earlier`)}>
              Earlier
            </Action>
            <Action icon={<ArrowDown className="h-3.5 w-3.5" />} disabled={index === count - 1} onClick={() => act('PIN', s.hcpId, String(index + 2), `Moved ${s.hcpName} later`)}>
              Later
            </Action>
            <Action icon={<CalendarArrowUp className="h-3.5 w-3.5" />} onClick={() => act('PUSH', s.hcpId, undefined, `Pushed ${s.hcpName} to the next day`)}>
              Next day
            </Action>
            <Action icon={<X className="h-3.5 w-3.5" />} danger onClick={() => act('REMOVE', s.hcpId, undefined, `Removed ${s.hcpName}`)}>
              Remove
            </Action>
          </div>
        </div>
      )}
    </div>
  );
}

const Stat = ({ value, label }: { value: string; label: string }) => (
  <div className="px-2 text-center">
    <div className="text-base font-semibold tabular-nums tracking-tight">{value}</div>
    <div className="truncate text-[11px] text-ink-3">{label}</div>
  </div>
);

const Dt = ({ label, children }: { label: string; children: ReactNode }) => (
  <>
    <dt className="text-ink-3">{label}</dt>
    <dd className="min-w-0 text-ink">{children}</dd>
  </>
);

function Step({ label, onClick, disabled, children }: { label: string; onClick: () => void; disabled?: boolean; children: ReactNode }) {
  return (
    <button aria-label={label} title={label} disabled={disabled} onClick={onClick} className="flex h-6 w-6 items-center justify-center rounded-md border border-line bg-bg text-ink-2 transition hover:text-ink disabled:opacity-40">
      {children}
    </button>
  );
}

function Action({ icon, children, onClick, href, primary, danger, disabled }: { icon: ReactNode; children: ReactNode; onClick?: () => void; href?: string; primary?: boolean; danger?: boolean; disabled?: boolean }) {
  const cls = clsx(
    'inline-flex h-8 items-center justify-center gap-1.5 rounded-lg border text-xs font-medium transition disabled:pointer-events-none disabled:opacity-40',
    primary ? 'bg-brand border-transparent text-white hover:opacity-95' : danger ? 'border-line bg-bg text-danger hover:bg-danger/10' : 'border-line bg-bg text-ink-2 hover:bg-raised hover:text-ink',
  );
  return href ? (
    <a href={href} target="_blank" rel="noreferrer" className={cls}>
      {icon}
      {children}
    </a>
  ) : (
    <button onClick={onClick} disabled={disabled} className={cls}>
      {icon}
      {children}
    </button>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section>
      <h3 className="mb-2 px-1 text-[11px] font-semibold uppercase tracking-wider text-ink-3">{title}</h3>
      <div className="space-y-1.5">{children}</div>
    </section>
  );
}

function Row({ icon, tone, title, body, action, onClick }: { icon: ReactNode; tone: 'green' | 'amber' | 'red'; title: string; body: string; action?: ReactNode; onClick?: () => void }) {
  const toneCls = { green: 'bg-emerald-500/12 text-emerald-600 dark:text-emerald-300', amber: 'bg-amber-500/15 text-amber-600 dark:text-amber-300', red: 'bg-danger/10 text-danger' }[tone];
  return (
    <div className="flex items-center gap-2.5 rounded-xl border border-line bg-panel px-3 py-2">
      <span className={clsx('flex h-6 w-6 shrink-0 items-center justify-center rounded-lg', toneCls)}>{icon}</span>
      <button onClick={onClick} disabled={!onClick} className="min-w-0 flex-1 text-left">
        <span className="block truncate text-xs font-medium tabular-nums">{title}</span>
        <span className="block truncate text-[11px] text-ink-3">{body}</span>
      </button>
      {action}
    </div>
  );
}

/** Start time, hard stop, a break, and reset: the day-level changes FR_ADJUST_PLAN understands. */
function DayControls({ plan, act }: { plan: RoutePlan; act: ActFn }) {
  const [open, setOpen] = useState<'start' | 'stop' | 'break'>();
  const [a, setA] = useState('');
  const [b, setB] = useState('');
  const show = (k: 'start' | 'stop' | 'break', first: string, second = '') => {
    setOpen(open === k ? undefined : k);
    setA(first);
    setB(second);
  };
  const apply = () => {
    if (open === 'start' && a) act('START_TIME', undefined, a, `Starting at ${a}`);
    if (open === 'stop' && a) act('HARD_STOP', undefined, a, `Hard stop at ${a}`);
    if (open === 'break' && a && b && b > a) act('BREAK', undefined, `${a}-${b}`, `Blocked ${a}–${b}`);
    setOpen(undefined);
  };
  const chip = 'inline-flex h-7 items-center gap-1.5 rounded-full border px-2.5 text-xs font-medium transition';
  const on = (k: string) => (open === k ? 'border-accent/50 bg-accent-soft text-accent' : 'border-line bg-bg text-ink-2 hover:bg-raised hover:text-ink');
  return (
    <div>
      <div className="flex flex-wrap gap-1.5">
        <button className={clsx(chip, on('start'))} onClick={() => show('start', plan.start?.leaveAt ?? '09:00')}>
          <Clock className="h-3 w-3" /> Start{plan.start?.leaveAt ? ` ${plan.start.leaveAt}` : ''}
        </button>
        <button className={clsx(chip, on('stop'), plan.hardStop && open !== 'stop' && 'border-danger/40 text-danger')} onClick={() => show('stop', plan.hardStop ?? '16:00')}>
          <Timer className="h-3 w-3" /> {plan.hardStop ? `Stop ${plan.hardStop}` : 'Hard stop'}
        </button>
        <button className={clsx(chip, on('break'))} onClick={() => show('break', '13:00', '13:45')}>
          <Coffee className="h-3 w-3" /> Add break
        </button>
        <button className={clsx(chip, 'ml-auto border-line bg-bg text-ink-3 hover:text-ink')} onClick={() => act('RESET', undefined, undefined, 'Reset to the original plan')} title="Undo all changes for this day">
          <RotateCcw className="h-3 w-3" /> Reset
        </button>
      </div>
      {open && (
        <div className="animate-fade-up mt-2 flex items-center gap-2 rounded-xl border border-line bg-panel p-2 shadow-soft">
          <span className="pl-1 text-xs text-ink-3">{open === 'start' ? 'Leave from' : open === 'stop' ? 'Finish by' : 'From'}</span>
          <input type="time" value={a} onChange={(e) => setA(e.target.value)} className={clsx(inputCls, 'h-8 w-[6.5rem] px-2 py-0 text-xs')} />
          {open === 'break' && (
            <>
              <span className="text-xs text-ink-3">to</span>
              <input type="time" value={b} onChange={(e) => setB(e.target.value)} className={clsx(inputCls, 'h-8 w-[6.5rem] px-2 py-0 text-xs')} />
            </>
          )}
          <button onClick={apply} className="bg-brand ml-auto h-8 rounded-lg px-3 text-xs font-medium text-white">
            Apply
          </button>
        </div>
      )}
    </div>
  );
}

function AddDoctor({ plan, territory, act }: { plan: RoutePlan; territory: TerritoryHcp[]; act: ActFn }) {
  const [q, setQ] = useState('');
  const planned = new Set(plan.stops.map((s) => s.hcpId));
  const matches = territory
    .filter((h) => !planned.has(h.hcpId))
    .filter((h) => !q || `${h.hcpName} ${h.specialty} ${h.area} ${h.tier}`.toLowerCase().includes(q.toLowerCase()))
    .sort((a, b) => (a.tier ?? 'Z').localeCompare(b.tier ?? 'Z'))
    .slice(0, q ? 6 : 3);
  if (!territory.length) return null;
  return (
    <Section title="Add a doctor">
      <label className="flex h-9 items-center gap-2 rounded-xl border border-line bg-bg px-3 text-sm focus-within:border-accent/50">
        <Search className="h-3.5 w-3.5 text-ink-3" />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Name, specialty or area…" className="min-w-0 flex-1 bg-transparent text-xs outline-none placeholder:text-ink-3" />
      </label>
      {matches.map((h) => (
        <div key={h.hcpId} className="flex items-center gap-2.5 rounded-xl border border-line bg-panel px-3 py-2">
          <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: TIER_COLOR[h.tier ?? ''] }} />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-xs font-medium">{h.hcpName}</span>
            <span className="block truncate text-[11px] text-ink-3">{[h.specialty, h.area, h.availStart && `${h.availStart}–${h.availEnd}`].filter(Boolean).join(' · ')}</span>
          </span>
          <button onClick={() => act('ADD', h.hcpId, undefined, `Added ${h.hcpName}`)} className="flex h-7 items-center gap-1 rounded-lg border border-line px-2 text-[11px] font-medium text-accent hover:bg-accent-soft">
            <Plus className="h-3 w-3" /> Add
          </button>
        </div>
      ))}
    </Section>
  );
}
