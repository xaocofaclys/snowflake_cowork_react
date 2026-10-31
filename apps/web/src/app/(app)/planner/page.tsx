'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import { Check, ExternalLink, FileText, Layers, Locate, MapPin, MessageSquareText, PanelRightClose, Plus, Route as RouteIcon, Sparkles, TriangleAlert, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { diffPlans, enrichPlan, planTimeline, type FieldRep, type RoutePlan, type StopChange, type TerritoryHcp } from '@cowork/shared';
import { DayStrip } from '@/components/planner/DayStrip';
import { Itinerary, TierChip, type ActFn } from '@/components/planner/Itinerary';
import { PlannerChat } from '@/components/planner/PlannerChat';
import { RouteMap } from '@/components/planner/RouteMap';
import { Spinner } from '@/components/ui';
import { api } from '@/lib/api';
import { positionAt, useRoadLegs } from '@/lib/route-geo';
import { useTheme } from '@/lib/theme';

interface PlannerContext {
  agentId: string;
  reps: FieldRep[];
  defaultRepId?: string;
  today: string;
  live: boolean;
}

const addDays = (d: string, n: number) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86400_000).toISOString().slice(0, 10);
const dayLabel = (d: string, today: string) =>
  d === today ? 'Today' : d === addDays(today, 1) ? 'Tomorrow' : new Date(`${d}T00:00:00Z`).toLocaleDateString('en-GB', { weekday: 'short', timeZone: 'UTC' });
const dayNum = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });

export default function PlannerPage() {
  const qc = useQueryClient();
  const dark = useTheme((s) => s.dark);
  const ctx = useQuery({ queryKey: ['planner', 'context'], queryFn: () => api<PlannerContext>('/planner/context'), staleTime: 300_000 });
  const [repPick, setRepPick] = useState<string>();
  const [datePick, setDatePick] = useState<string>();
  const repId = repPick ?? ctx.data?.defaultRepId;
  const today = ctx.data?.today;
  const date = datePick ?? today;
  const rep = ctx.data?.reps.find((r) => r.repId === repId);

  const territory = useQuery({
    queryKey: ['planner', 'territory', repId],
    enabled: !!repId,
    queryFn: () => api<TerritoryHcp[]>(`/planner/territory?repId=${encodeURIComponent(repId!)}`),
    staleTime: 300_000,
  });
  const planKey = useMemo(() => ['planner', 'plan', repId, date], [repId, date]);
  const planQ = useQuery({
    queryKey: planKey,
    enabled: !!repId && !!date,
    queryFn: () => api<RoutePlan>('/planner/plan', { method: 'POST', json: { repId, date } }),
    staleTime: 60_000,
    retry: false,
  });
  const plan = planQ.data;

  const [selected, setSelected] = useState<string>();
  const [hovered, setHovered] = useState<string>();
  const [changed, setChanged] = useState<Record<string, StopChange>>({});
  const [busy, setBusy] = useState<string>();
  const [agentBusy, setAgentBusy] = useState(false);
  const [toast, setToast] = useState<{ text: string; error?: boolean }>();
  const [roads, setRoads] = useState(true);
  const [tiles, setTiles] = useState<'clean' | 'streets'>('clean');
  const [minute, setMinute] = useState<number>();
  const [playing, setPlaying] = useState(false);
  const [inbox, setInbox] = useState<{ n: number; text: string } | null>(null);
  const [tab, setTab] = useState<'plan' | 'chat'>('plan');
  const [chatOpen, setChatOpen] = useState(true);
  const [fitNonce, setFitNonce] = useState(0);
  const { legs, source } = useRoadLegs(plan, roads);
  const toastTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const flashTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => setChatOpen(window.innerWidth >= 1360), []);
  useEffect(() => {
    setSelected(undefined);
    setMinute(undefined);
    setPlaying(false);
    setChanged({});
  }, [repId, date]);

  const say = (text: string, error = false) => {
    setToast({ text, error });
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(undefined), error ? 7000 : 3200);
  };

  /** A new plan from the map or the agent: diff against what's on screen, then show it. */
  const applyPlan = (next: RoutePlan, note: string) => {
    const forDate = next.planDate || date;
    const key = ['planner', 'plan', repId, forDate];
    const prev = qc.getQueryData<RoutePlan>(key);
    const full = enrichPlan(next, { stops: prev?.stops, hcps: territory.data, start: prev?.start });
    const d = diffPlans(prev, full);
    qc.setQueryData(key, full);
    if (forDate !== date) setDatePick(forDate);
    setChanged(d.changed);
    clearTimeout(flashTimer.current);
    flashTimer.current = setTimeout(() => setChanged({}), 6000);
    const n = Object.keys(d.changed).length;
    say(`${note}${d.removed.length ? ` · ${d.removed.length} removed` : ''}${n ? ` · ${n} stop${n > 1 ? 's' : ''} changed` : ''}`);
  };

  const act: ActFn = async (action, hcpId, param, label) => {
    if (!repId || !date) return;
    setBusy(label ?? 'Re-planning');
    try {
      const next = await api<RoutePlan>('/planner/adjust', { method: 'POST', json: { repId, date, action, hcpId, param } });
      applyPlan(next, label ?? 'Plan updated');
      // A push also changes the target day's plan.
      if (action === 'PUSH') qc.invalidateQueries({ predicate: (q) => q.queryKey[0] === 'planner' && q.queryKey[1] === 'plan' && q.queryKey[2] === repId && q.queryKey[3] !== date });
      if (action === 'REMOVE' || action === 'PUSH') setSelected(undefined);
    } catch (e) {
      say((e as Error).message, true);
    } finally {
      setBusy(undefined);
    }
  };

  const ask = (text: string) => {
    setInbox((b) => ({ n: (b?.n ?? 0) + 1, text }));
    setChatOpen(true);
    setTab('chat');
  };

  // Play the day: ~12 seconds from leaving the office to the last visit (resumes from the playhead).
  useEffect(() => {
    if (!playing || !plan?.stops.length) return;
    const { start, end } = planTimeline(plan);
    const from = minute !== undefined && minute < end - 1 ? minute : start;
    const ms = (12000 * (end - from)) / Math.max(end - start, 1);
    const t0 = performance.now();
    let raf = 0;
    const tick = (t: number) => {
      const f = (t - t0) / ms;
      if (f >= 1) {
        setMinute(end);
        setPlaying(false);
        return;
      }
      setMinute(from + f * (end - from));
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing]);

  const playhead = useMemo(() => (plan && minute !== undefined ? positionAt(plan, legs, minute) : null), [plan, legs, minute]);
  const selectedStop = plan?.stops.find((s) => s.hcpId === selected);
  const selectedOther = !selectedStop ? territory.data?.find((h) => h.hcpId === selected) : undefined;
  const missed = plan?.unscheduled.find((u) => u.hcpId === selected);
  const days = today ? Array.from({ length: 5 }, (_, i) => addDays(today, i)) : [];

  const itinerary = plan ? (
    <Itinerary plan={plan} territory={territory.data ?? []} selected={selected} hovered={hovered} changed={changed} busy={!!busy || agentBusy} onSelect={setSelected} onHover={setHovered} act={act} ask={ask} />
  ) : planQ.isLoading || ctx.isLoading ? (
    <div className="space-y-3 p-4">
      {Array.from({ length: 5 }, (_, i) => (
        <div key={i} className="skeleton h-16 rounded-2xl" />
      ))}
    </div>
  ) : null;

  return (
    <div className="flex h-full min-h-0 flex-col bg-canvas">
      {/* Header */}
      <header className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-line bg-bg px-4 py-2.5">
        <div className="flex items-center gap-2.5">
          <span className="bg-brand flex h-8 w-8 items-center justify-center rounded-xl text-white shadow-soft">
            <RouteIcon className="h-4 w-4" />
          </span>
          <div className="leading-tight">
            <h1 className="text-sm font-semibold">Route Planner</h1>
            <p className="text-[11px] text-ink-3">{ctx.data?.live === false ? 'Offline demo data' : 'My Day Planner agent'} · times approx.</p>
          </div>
        </div>

        {ctx.data && (
          <label className="flex items-center gap-2 rounded-xl border border-line bg-bg py-1 pl-1 pr-2 shadow-soft">
            <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-accent-soft text-[11px] font-bold text-accent">
              {rep?.name
                .split(' ')
                .map((w) => w[0])
                .join('')
                .slice(0, 2)}
            </span>
            <select value={repId} onChange={(e) => setRepPick(e.target.value)} aria-label="Field rep" className="max-w-[11rem] cursor-pointer bg-transparent text-xs font-medium outline-none">
              {ctx.data.reps.map((r) => (
                <option key={r.repId} value={r.repId}>
                  {r.name}
                </option>
              ))}
            </select>
          </label>
        )}

        <div className="flex gap-1 overflow-x-auto [scrollbar-width:none]" role="radiogroup" aria-label="Day">
          {days.map((d) => (
            <button
              key={d}
              role="radio"
              aria-checked={d === date}
              onClick={() => setDatePick(d)}
              className={clsx(
                'flex shrink-0 flex-col items-center rounded-xl px-2.5 py-1 text-[11px] leading-tight transition',
                d === date ? 'bg-ink text-bg shadow-soft' : 'text-ink-2 hover:bg-raised',
              )}
            >
              <span className="font-semibold">{dayLabel(d, today!)}</span>
              <span className={d === date ? 'opacity-70' : 'text-ink-3'}>{dayNum(d)}</span>
            </button>
          ))}
        </div>

        <div className="ml-auto flex items-center gap-1.5">
          {plan?.mapUrl && (
            <a href={plan.mapUrl} target="_blank" rel="noreferrer" className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-line bg-bg px-2.5 text-xs font-medium text-ink-2 shadow-soft hover:bg-raised hover:text-ink">
              <ExternalLink className="h-3.5 w-3.5" /> <span className="hidden sm:inline">Google Maps</span>
            </a>
          )}
          <button
            onClick={() => setChatOpen((o) => !o)}
            className={clsx('hidden h-8 items-center gap-1.5 rounded-lg px-2.5 text-xs font-medium shadow-soft lg:inline-flex', chatOpen ? 'border border-line bg-bg text-ink-2 hover:bg-raised' : 'bg-brand text-white')}
          >
            {chatOpen ? <PanelRightClose className="h-3.5 w-3.5" /> : <Sparkles className="h-3.5 w-3.5" />}
            {chatOpen ? 'Hide chat' : 'Ask the planner'}
          </button>
        </div>
      </header>

      {/* Body: itinerary | map | chat on desktop; map over tabs on mobile */}
      <div className={clsx('grid min-h-0 flex-1 grid-rows-[minmax(300px,46vh)_auto_minmax(0,1fr)] lg:grid-rows-1', chatOpen ? 'lg:grid-cols-[340px_minmax(0,1fr)_360px]' : 'lg:grid-cols-[340px_minmax(0,1fr)]')}>
        <aside className={clsx('order-3 min-h-0 overflow-y-auto border-line bg-bg lg:order-1 lg:border-r', tab !== 'plan' && 'hidden lg:block')}>{itinerary}</aside>

        <main className="relative order-1 flex min-h-0 min-w-0 flex-col lg:order-2">
          {/* isolate: keep Leaflet's z-indexed panes below app modals */}
          <div className="relative isolate min-h-0 flex-1">
            <RouteMap
              plan={plan}
              legs={legs}
              territory={territory.data ?? []}
              selected={selected}
              hovered={hovered}
              changed={changed}
              playhead={playhead}
              dark={dark}
              tiles={tiles}
              fitKey={`${repId}:${date}:${fitNonce}`}
              onSelect={setSelected}
              onHover={setHovered}
            />

            {/* Map controls */}
            <div className="absolute left-3 top-3 z-[500] flex flex-col gap-1.5">
              <MapButton label="Fit the whole route" onClick={() => setFitNonce((n) => n + 1)}>
                <Locate className="h-4 w-4" />
              </MapButton>
              <MapButton label={tiles === 'clean' ? 'Street map' : 'Clean map'} onClick={() => setTiles((t) => (t === 'clean' ? 'streets' : 'clean'))}>
                <Layers className="h-4 w-4" />
              </MapButton>
              <button
                onClick={() => setRoads((r) => !r)}
                title="Draw legs along roads (OSRM) or as straight lines"
                className="rounded-xl border border-line bg-bg/95 px-2 py-1.5 text-[10px] font-semibold text-ink-2 shadow-soft backdrop-blur hover:text-ink"
              >
                {roads && source === 'roads' ? 'Roads' : roads ? 'Roads…' : 'Straight'}
              </button>
            </div>

            {/* Legend */}
            <div className="absolute right-3 top-3 z-[500] hidden rounded-xl border border-line bg-bg/95 px-3 py-2 text-[11px] text-ink-2 shadow-soft backdrop-blur sm:block">
              <div className="mb-1 font-semibold text-ink">Doctors</div>
              {(['A', 'B', 'C'] as const).map((t) => (
                <div key={t} className="flex items-center gap-1.5">
                  <span className="h-2.5 w-2.5 rounded-full border-2" style={{ borderColor: { A: '#e5484d', B: '#f59e0b', C: '#8792a2' }[t] }} /> Tier {t}
                </div>
              ))}
              <div className="mt-1 flex items-center gap-1.5 text-ink-3">
                <span className="h-2.5 w-2.5 rounded-full border-2 border-dashed border-ink-3" /> Couldn&apos;t fit
              </div>
            </div>

            {/* Busy / toast */}
            <div className="pointer-events-none absolute inset-x-0 top-3 z-[600] flex justify-center px-16">
              {busy || (planQ.isFetching && !plan) ? (
                <div className="animate-fade-up flex items-center gap-2 rounded-full border border-line bg-bg/95 px-3.5 py-1.5 text-xs font-medium shadow-lift backdrop-blur">
                  <Spinner className="h-3.5 w-3.5 text-accent" />
                  {busy ? `${busy}…` : 'Planning the day…'}
                </div>
              ) : toast ? (
                <div className={clsx('animate-fade-up flex max-w-md items-center gap-2 rounded-full border px-3.5 py-1.5 text-xs font-medium shadow-lift backdrop-blur', toast.error ? 'border-danger/30 bg-bg/95 text-danger' : 'border-line bg-bg/95')}>
                  {toast.error ? <TriangleAlert className="h-3.5 w-3.5 shrink-0" /> : <Check className="h-3.5 w-3.5 shrink-0 text-emerald-500" />}
                  <span className="truncate">{toast.text}</span>
                </div>
              ) : null}
            </div>

            {planQ.error && !plan && (
              <div className="absolute inset-0 z-[550] flex items-center justify-center bg-canvas/70 p-6 backdrop-blur-sm">
                <div className="max-w-sm rounded-2xl border border-line bg-bg p-5 text-center shadow-lift">
                  <TriangleAlert className="mx-auto h-6 w-6 text-danger" />
                  <div className="mt-2 text-sm font-medium">Couldn&apos;t plan this day</div>
                  <p className="mt-1 text-xs leading-relaxed text-ink-3">{(planQ.error as Error).message}</p>
                  <p className="mt-2 text-[11px] text-ink-3">If this mentions access, your role needs the grants in snowflake/10_release_v6.sql.</p>
                  <button onClick={() => planQ.refetch()} className="bg-brand mt-3 h-8 rounded-lg px-3 text-xs font-medium text-white">
                    Try again
                  </button>
                </div>
              </div>
            )}

            {/* A doctor who isn't on today's route */}
            {(selectedOther || missed) && (
              <div className="animate-fade-up absolute bottom-3 left-3 z-[600] w-[min(320px,calc(100%-24px))] rounded-2xl border border-line bg-bg p-3.5 shadow-lift">
                <div className="flex items-start gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium">{selectedOther?.hcpName ?? missed?.hcpName}</div>
                    <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-ink-3">
                      {selectedOther?.specialty && <span>{selectedOther.specialty}</span>}
                      <TierChip tier={selectedOther?.tier ?? missed?.tier} />
                      {selectedOther?.area && <span>{selectedOther.area}</span>}
                    </div>
                    {selectedOther?.availStart && <div className="mt-1 text-xs text-ink-3">Clinic {selectedOther.availStart}–{selectedOther.availEnd}</div>}
                    {missed && <div className="mt-1.5 rounded-lg bg-danger/10 px-2 py-1 text-[11px] text-danger">Couldn&apos;t fit: {missed.reason ?? 'not enough time'}</div>}
                  </div>
                  <button onClick={() => setSelected(undefined)} aria-label="Close" className="text-ink-3 hover:text-ink">
                    <X className="h-4 w-4" />
                  </button>
                </div>
                <div className="mt-3 grid grid-cols-2 gap-1.5">
                  <button
                    onClick={() => act('ADD', selected, undefined, `Added ${selectedOther?.hcpName ?? missed?.hcpName}`)}
                    className="bg-brand inline-flex h-8 items-center justify-center gap-1.5 rounded-lg text-xs font-medium text-white"
                  >
                    <Plus className="h-3.5 w-3.5" /> {missed ? 'Try to fit' : 'Add to this day'}
                  </button>
                  <button
                    onClick={() => ask(`Prep me for ${selectedOther?.hcpName ?? missed?.hcpName} (${selected})`)}
                    className="inline-flex h-8 items-center justify-center gap-1.5 rounded-lg border border-line bg-bg text-xs font-medium text-ink-2 hover:bg-raised"
                  >
                    <FileText className="h-3.5 w-3.5" /> Prep brief
                  </button>
                </div>
              </div>
            )}

            {!chatOpen && (
              <button onClick={() => setChatOpen(true)} className="bg-brand absolute bottom-4 right-14 z-[600] hidden items-center gap-2 rounded-full px-4 py-2.5 text-sm font-medium text-white shadow-lift transition hover:scale-[1.02] lg:inline-flex">
                <Sparkles className="h-4 w-4" /> Ask the planner
              </button>
            )}
          </div>
          {plan && plan.stops.length > 0 && (
            <DayStrip
              plan={plan}
              minute={minute}
              playing={playing}
              label={playhead?.label}
              hovered={hovered}
              onScrub={(m) => {
                setPlaying(false);
                setMinute(m);
              }}
              onPlay={() => setPlaying((p) => !p)}
              onHover={setHovered}
              onSelect={setSelected}
            />
          )}
        </main>

        {/* Mobile tabs */}
        <div className="order-2 flex gap-1 border-y border-line bg-bg p-1.5 lg:hidden" role="tablist">
          {(
            [
              ['plan', 'Itinerary', MapPin],
              ['chat', 'Ask the planner', MessageSquareText],
            ] as const
          ).map(([k, label, Icon]) => (
            <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)} className={clsx('flex h-8 flex-1 items-center justify-center gap-1.5 rounded-lg text-xs font-medium', tab === k ? 'bg-raised text-ink' : 'text-ink-3')}>
              <Icon className="h-3.5 w-3.5" /> {label}
            </button>
          ))}
        </div>

        <aside className={clsx('order-3 min-h-0 flex-col border-line bg-bg lg:border-l', tab === 'chat' ? 'flex' : 'hidden', chatOpen ? 'lg:flex' : 'lg:hidden')}>
          <div className="hidden items-center gap-2 border-b border-line px-4 py-3 lg:flex">
            <Sparkles className="h-4 w-4 text-accent" />
            <span className="text-sm font-semibold">Ask the planner</span>
            <span className="ml-auto truncate text-[11px] text-ink-3">{ctx.data?.agentId.split('.').pop()?.replace(/_/g, ' ').toLowerCase()}</span>
          </div>
          {repId && date && (
            <PlannerChat
              key={`${repId}:${date}`}
              repId={repId}
              date={date}
              firstName={plan?.firstName ?? rep?.name.split(' ')[0]}
              stops={plan?.stops ?? []}
              selected={selectedStop}
              inbox={inbox}
              onPlan={applyPlan}
              onBusy={setAgentBusy}
            />
          )}
        </aside>
      </div>
    </div>
  );
}

function MapButton({ label, onClick, children }: { label: string; onClick: () => void; children: ReactNode }) {
  return (
    <button onClick={onClick} aria-label={label} title={label} className="flex h-8 w-8 items-center justify-center rounded-xl border border-line bg-bg/95 text-ink-2 shadow-soft backdrop-blur transition hover:text-ink">
      {children}
    </button>
  );
}
