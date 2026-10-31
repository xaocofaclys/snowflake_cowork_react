'use client';

import { useQueries } from '@tanstack/react-query';
import { Activity, ArrowRight, BarChart3, CalendarClock, Clock, FileText, LayoutDashboard, MessageSquare, Pin, Sparkles, Telescope, Workflow } from 'lucide-react';
import Link from 'next/link';
import type { ReactNode } from 'react';
import type { AgentInfo, Artifact } from '@cowork/shared';
import { api } from '@/lib/api';
import { useArtifacts, useMe, usePrefs, useThreads } from '@/lib/hooks';
import type { ChatMode } from '@/lib/ui-store';
import { KpiCard } from './dashboard/Tiles';

function greeting() {
  const h = new Date().getHours();
  return h < 5 ? 'Working late' : h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
}

const ago = (iso: string) => {
  const m = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  return h < 24 ? `${h}h ago` : `${Math.round(h / 24)}d ago`;
};

/** The workspace shown when no conversation is open. */
export function Home({ composer, agent, onAsk, onMode }: { composer: ReactNode; agent?: AgentInfo; onAsk: (q: string) => void; onMode: (m: ChatMode) => void }) {
  const { data: me } = useMe();
  const prefs = usePrefs();
  const { data: threads = [] } = useThreads();
  const { data: artifacts = [] } = useArtifacts();
  const name = (me?.user.displayName ?? me?.user.name ?? '').split(/[ ._]/)[0].replace(/^./, (c) => c.toUpperCase());
  const pins = prefs.pins ?? [];
  const pinnedArtifacts = useQueries({
    queries: pins.filter((p) => p.kind === 'artifact').map((p) => ({ queryKey: ['artifact', p.id], queryFn: () => api<Artifact>(`/artifacts/${p.id}`), retry: false })),
  });
  const kpis = pinnedArtifacts.map((q) => q.data).filter((a): a is Artifact => a?.type === 'kpi');
  const otherPins = pins.filter((p) => p.kind === 'dashboard' || !kpis.some((k) => k.id === p.id));
  const samples = agent?.sampleQuestions.slice(0, 4) ?? [];

  return (
    <div className="h-full overflow-y-auto">
      <section className="hero-snow px-4 pb-10 pt-[9vh]">
        <div className="mx-auto max-w-2xl">
          <h1 className="animate-fade-up text-center text-3xl font-semibold tracking-tight md:text-4xl">
            {greeting()}
            {name && (
              <>
                , <span className="text-brand">{name}</span>
              </>
            )}
          </h1>
          <p className="animate-fade-up mt-2 text-center text-sm text-ink-2 [animation-delay:60ms]">
            What would you like to know about your data today?
          </p>
          <div className="animate-fade-up mt-7 [animation-delay:120ms]">{composer}</div>
          {samples.length > 0 && (
            <div className="animate-fade-up mt-4 flex flex-wrap justify-center gap-2 [animation-delay:180ms]">
              {samples.map((q) => (
                <button
                  key={q}
                  onClick={() => onAsk(q)}
                  className="inline-flex items-center gap-1.5 rounded-full border border-line bg-bg/80 px-3 py-1.5 text-xs text-ink-2 shadow-soft transition hover:-translate-y-px hover:border-accent/40 hover:text-ink"
                >
                  <Sparkles className="h-3 w-3 text-accent" />
                  {q}
                </button>
              ))}
            </div>
          )}
        </div>
      </section>

      <div className="mx-auto max-w-5xl space-y-9 px-4 pb-16 md:px-6">
        {kpis.length > 0 && (
          <Section icon={Activity} title="Watchlist" hint="Pinned KPIs with live values">
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {kpis.map((a) => (
                <Link key={a.id} href={`/artifacts/${a.id}`} className="h-36 rounded-2xl border border-line bg-panel shadow-soft transition hover:-translate-y-0.5 hover:shadow-lift">
                  <KpiCard a={a} table={a.table} />
                </Link>
              ))}
            </div>
          </Section>
        )}

        <Section icon={Sparkles} title="Do more with your data">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Feature icon={Telescope} title="Deep research" body="A cited report from several sub-questions, researched in parallel." onClick={() => onMode('research')} />
            <Feature icon={LayoutDashboard} title="Build a dashboard" body="Describe the metrics; get a live, filterable dashboard." onClick={() => onMode('dashboard')} />
            <Feature icon={CalendarClock} title="Automate a brief" body="Schedule any question and get it by email." href="/automations" />
            <Feature icon={Workflow} title="Combine agents" body="Chain, parallelise or branch your Snowflake agents." href="/workflows" />
          </div>
        </Section>

        {otherPins.length > 0 && (
          <Section icon={Pin} title="Pinned">
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {otherPins.map((p) => (
                <Link
                  key={p.id}
                  href={p.kind === 'dashboard' ? `/dashboards/${p.id}` : `/artifacts/${p.id}`}
                  className="group flex items-center gap-3 rounded-2xl border border-line bg-panel p-4 shadow-soft transition hover:-translate-y-0.5 hover:shadow-lift"
                >
                  <span className="bg-brand flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-white">
                    {p.kind === 'dashboard' ? <LayoutDashboard className="h-5 w-5" /> : <BarChart3 className="h-5 w-5" />}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">{p.title}</span>
                    <span className="block text-xs capitalize text-ink-3">{p.kind}</span>
                  </span>
                  <ArrowRight className="h-4 w-4 text-ink-3 transition group-hover:translate-x-0.5 group-hover:text-accent" />
                </Link>
              ))}
            </div>
          </Section>
        )}

        <div className="grid gap-8 md:grid-cols-2">
          <Section icon={Clock} title="Recent chats" href={threads.length ? undefined : undefined}>
            {!threads.length ? (
              <Empty text="Your conversations will appear here." />
            ) : (
              <div className="divide-y divide-line overflow-hidden rounded-2xl border border-line bg-panel shadow-soft">
                {threads.slice(0, 5).map((t) => (
                  <Link key={t.id} href={`/c/${t.id}`} className="flex items-center gap-3 px-4 py-3 text-sm transition hover:bg-raised/60">
                    <MessageSquare className="h-4 w-4 shrink-0 text-ink-3" />
                    <span className="min-w-0 flex-1 truncate">{t.title}</span>
                    <span className="text-xs text-ink-3">{ago(t.updatedAt)}</span>
                  </Link>
                ))}
              </div>
            )}
          </Section>
          <Section icon={FileText} title="Recent artifacts" href="/artifacts">
            {!artifacts.length ? (
              <Empty text="Saved charts, reports and dashboard tiles appear here." />
            ) : (
              <div className="divide-y divide-line overflow-hidden rounded-2xl border border-line bg-panel shadow-soft">
                {artifacts.slice(0, 5).map((a) => (
                  <Link key={a.id} href={`/artifacts/${a.id}`} className="flex items-center gap-3 px-4 py-3 text-sm transition hover:bg-raised/60">
                    {a.type === 'report' ? <FileText className="h-4 w-4 shrink-0 text-ink-3" /> : <BarChart3 className="h-4 w-4 shrink-0 text-ink-3" />}
                    <span className="min-w-0 flex-1 truncate">{a.title}</span>
                    <span className="text-xs capitalize text-ink-3">{a.type === 'kpi' ? 'KPI' : a.type}</span>
                  </Link>
                ))}
              </div>
            )}
          </Section>
        </div>
      </div>
    </div>
  );
}

function Section({ icon: Icon, title, hint, href, children }: { icon: typeof Clock; title: string; hint?: string; href?: string; children: ReactNode }) {
  return (
    <section className="animate-fade-up">
      <div className="mb-3 flex items-center gap-2">
        <Icon className="h-4 w-4 text-accent" />
        <h2 className="text-sm font-semibold">{title}</h2>
        {hint && <span className="text-xs text-ink-3">· {hint}</span>}
        {href && (
          <Link href={href} className="ml-auto text-xs text-ink-3 hover:text-accent">
            View all
          </Link>
        )}
      </div>
      {children}
    </section>
  );
}

function Feature({ icon: Icon, title, body, href, onClick }: { icon: typeof Clock; title: string; body: string; href?: string; onClick?: () => void }) {
  const inner = (
    <>
      <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-accent-soft text-accent transition group-hover:scale-105">
        <Icon className="h-[18px] w-[18px]" />
      </span>
      <span className="mt-3 block text-sm font-medium">{title}</span>
      <span className="mt-1 block text-xs leading-relaxed text-ink-3">{body}</span>
    </>
  );
  const cls = 'group block rounded-2xl border border-line bg-panel p-4 text-left shadow-soft transition hover:-translate-y-0.5 hover:border-accent/30 hover:shadow-lift';
  return href ? (
    <Link href={href} className={cls}>
      {inner}
    </Link>
  ) : (
    <button onClick={onClick} className={cls}>
      {inner}
    </button>
  );
}

function Empty({ text }: { text: string }) {
  return <div className="rounded-2xl border border-dashed border-line px-4 py-8 text-center text-xs text-ink-3">{text}</div>;
}
