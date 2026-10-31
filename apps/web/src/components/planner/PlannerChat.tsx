'use client';

import clsx from 'clsx';
import { ArrowUp, MapPinned, Sparkles, Square } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { stripRoutePlanBlock, type RoutePlan, type RouteStop } from '@cowork/shared';
import { streamPost } from '@/lib/sse';
import { Markdown } from '../Markdown';
import { LogoMark } from '../Logo';

interface Turn {
  role: 'user' | 'assistant';
  text: string;
  status?: string;
  updatedMap?: boolean;
  error?: string;
  streaming?: boolean;
}

const TOOL_LABEL: Record<string, string> = {
  plan_route: 'Planning the route',
  adjust_plan: 'Saving your change and re-planning',
  prep_brief: 'Pulling call notes and Rx trends',
  field_rep_analytics: 'Querying your field data',
};

/** Chat with the FIELD_REP_DAY_PLANNER agent; plan changes it makes flow straight onto the map. */
export function PlannerChat({
  repId,
  date,
  firstName,
  stops,
  selected,
  inbox,
  onPlan,
  onBusy,
}: {
  repId: string;
  date: string;
  firstName?: string;
  stops: RouteStop[];
  selected?: RouteStop;
  /** Messages sent from elsewhere on the page (e.g. "Prep brief" on a stop). */
  inbox: { n: number; text: string } | null;
  onPlan: (plan: RoutePlan, note: string) => void;
  onBusy: (busy: boolean) => void;
}) {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const abort = useRef<AbortController>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const lastInbox = useRef(inbox?.n ?? 0);

  useEffect(() => {
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: 'smooth' });
  }, [turns]);

  useEffect(() => {
    if (inbox && inbox.n !== lastInbox.current) {
      lastInbox.current = inbox.n;
      void send(inbox.text);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inbox]);

  useEffect(() => () => abort.current?.abort(), []);

  const patchLast = (f: (t: Turn) => Turn) => setTurns((ts) => [...ts.slice(0, -1), f(ts[ts.length - 1])]);

  async function send(raw: string) {
    const q = raw.trim();
    if (!q || busy) return;
    setText('');
    setBusy(true);
    onBusy(true);
    setTurns((ts) => [...ts, { role: 'user', text: q }, { role: 'assistant', text: '', status: 'Thinking', streaming: true }]);
    const parts = new Map<number, string>();
    const ctl = new AbortController();
    abort.current = ctl;
    try {
      await streamPost(
        '/planner/chat',
        { repId, date, text: q, stops: stops.map(({ stop, hcpId, hcpName }) => ({ stop, hcpId, hcpName })) },
        (ev) => {
          if (ev.type === 'text_delta' || ev.type === 'text') {
            parts.set(ev.index, ev.type === 'text' ? ev.text : (parts.get(ev.index) ?? '') + ev.text);
            const joined = [...parts.entries()].sort(([a], [b]) => a - b).map(([, t]) => t).join('\n\n');
            patchLast((t) => ({ ...t, text: joined, status: undefined }));
          } else if (ev.type === 'status' && ev.message) patchLast((t) => ({ ...t, status: ev.message }));
          else if (ev.type === 'tool_use') patchLast((t) => ({ ...t, status: TOOL_LABEL[ev.name] ?? `Using ${ev.name}` }));
          else if (ev.type === 'route_plan') {
            onPlan(ev.plan, 'Updated by the planner');
            patchLast((t) => ({ ...t, updatedMap: true }));
          } else if (ev.type === 'error') patchLast((t) => ({ ...t, error: ev.message }));
        },
        ctl.signal,
      );
    } catch (e) {
      if (!ctl.signal.aborted) patchLast((t) => ({ ...t, error: (e as Error).message }));
    } finally {
      patchLast((t) => ({ ...t, streaming: false, status: undefined }));
      setBusy(false);
      onBusy(false);
    }
  }

  const chips = selected
    ? [`Prep me for ${selected.hcpName}`, `Push ${selected.hcpName} to tomorrow`, `Spend 30 min with ${selected.hcpName}`]
    : ['Plan my day', 'I have a hard stop at 4pm', 'Add lunch from 13:00 to 13:45', `Prep me for stop ${stops[0]?.stop ?? 'A'}`, 'Which tier A doctors have falling Rx?'];

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div ref={scroller} className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-4">
        {!turns.length && (
          <div className="animate-fade-up rounded-2xl border border-line bg-panel p-4 text-sm shadow-soft">
            <div className="flex items-center gap-2 font-medium">
              <Sparkles className="h-4 w-4 text-accent" /> Ask the planner
            </div>
            <p className="mt-1.5 text-xs leading-relaxed text-ink-3">
              {firstName ? `${firstName}, change` : 'Change'} the day in plain words. Push a doctor, add lunch, set a hard stop, or ask for a pre-call brief. The map updates as the agent re-plans.
            </p>
          </div>
        )}
        {turns.map((t, i) =>
          t.role === 'user' ? (
            <div key={i} className="flex justify-end">
              <div className="max-w-[85%] rounded-2xl rounded-br-md bg-accent-soft px-3 py-2 text-sm text-ink">{t.text}</div>
            </div>
          ) : (
            <div key={i} className="flex gap-2.5">
              <LogoMark size={22} className="mt-0.5 shrink-0" />
              <div className="min-w-0 flex-1 text-sm">
                {t.status && (
                  <div className="mb-1.5 flex items-center gap-2 text-xs text-ink-3">
                    <span className="relative flex h-2 w-2">
                      <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-accent opacity-60" />
                      <span className="relative inline-flex h-2 w-2 rounded-full bg-accent" />
                    </span>
                    {t.status}…
                  </div>
                )}
                {t.updatedMap && (
                  <div className="mb-2 inline-flex items-center gap-1.5 rounded-full bg-emerald-500/12 px-2 py-0.5 text-[11px] font-medium text-emerald-700 dark:text-emerald-300">
                    <MapPinned className="h-3 w-3" /> Map updated
                  </div>
                )}
                {t.text && (
                  <div className="planner-md overflow-x-auto">
                    <Markdown text={stripRoutePlanBlock(t.text)} caret={t.streaming} />
                  </div>
                )}
                {t.error && <div className="mt-1 text-xs text-danger">{t.error}</div>}
              </div>
            </div>
          ),
        )}
      </div>
      <div className="border-t border-line p-3">
        <div className="mb-2 flex gap-1.5 overflow-x-auto pb-0.5 [scrollbar-width:none]">
          {chips.map((c) => (
            <button
              key={c}
              disabled={busy}
              onClick={() => send(c)}
              className="shrink-0 rounded-full border border-line bg-bg px-2.5 py-1 text-[11px] text-ink-2 transition hover:border-accent/40 hover:text-ink disabled:opacity-50"
            >
              {c}
            </button>
          ))}
        </div>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void send(text);
          }}
          className="flex items-end gap-2 rounded-2xl border border-line bg-bg p-1.5 pl-3 shadow-soft focus-within:border-accent/50"
        >
          <textarea
            value={text}
            rows={1}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                void send(text);
              }
            }}
            placeholder="Push Dr. Bhat to Monday, lunch at 1…"
            className="max-h-28 min-h-[34px] flex-1 resize-none bg-transparent py-1.5 text-sm outline-none placeholder:text-ink-3"
          />
          {busy ? (
            <button type="button" onClick={() => abort.current?.abort()} aria-label="Stop" className="flex h-8 w-8 items-center justify-center rounded-xl bg-ink text-bg">
              <Square className="h-3 w-3" fill="currentColor" />
            </button>
          ) : (
            <button type="submit" disabled={!text.trim()} aria-label="Send" className={clsx('bg-brand flex h-8 w-8 items-center justify-center rounded-xl text-white transition disabled:opacity-40')}>
              <ArrowUp className="h-4 w-4" />
            </button>
          )}
        </form>
      </div>
    </div>
  );
}
