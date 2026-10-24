'use client';

import { useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import { BarChart3, Bookmark, FileText, Gauge, LayoutDashboard, MessageSquareText, Plus, Table2 } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import type { ArtifactType, Dashboard } from '@cowork/shared';
import { PageHeader } from '@/components/PageHeader';
import { Button, Spinner, inputCls } from '@/components/ui';
import { VegaChart } from '@/components/VegaChart';
import { api } from '@/lib/api';
import { useArtifacts, useDashboards } from '@/lib/hooks';

const ICON: Record<ArtifactType, typeof BarChart3> = { chart: BarChart3, table: Table2, answer: MessageSquareText, report: FileText, kpi: Gauge };
const FILTERS: { key: 'all' | ArtifactType; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'report', label: 'Reports' },
  { key: 'chart', label: 'Charts' },
  { key: 'table', label: 'Tables' },
  { key: 'answer', label: 'Answers' },
];

export default function ArtifactsPage() {
  const [tab, setTab] = useState<'artifacts' | 'dashboards'>('artifacts');
  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-6xl px-6 py-8">
        <PageHeader title="Artifacts" subtitle="Saved charts, tables, research reports and dashboards, all refreshable with live data." />
        <div className="mb-6 flex gap-1 border-b border-line">
          {(['artifacts', 'dashboards'] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={clsx('-mb-px border-b-2 px-3 py-2 text-sm capitalize', tab === t ? 'border-accent font-medium text-ink' : 'border-transparent text-ink-3 hover:text-ink')}
            >
              {t}
            </button>
          ))}
        </div>
        {tab === 'artifacts' ? <ArtifactGrid /> : <DashboardGrid />}
      </div>
    </div>
  );
}

function ArtifactGrid() {
  const { data = [], isLoading } = useArtifacts();
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState<'all' | ArtifactType>('all');
  const items = data.filter((a) => (filter === 'all' || a.type === filter) && a.title.toLowerCase().includes(q.toLowerCase()));

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="w-64">
          <input className={inputCls} placeholder="Search artifacts" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        {FILTERS.map((f) => (
          <button
            key={f.key}
            onClick={() => setFilter(f.key)}
            className={clsx('rounded-full px-3 py-1 text-xs', filter === f.key ? 'bg-ink text-bg' : 'bg-raised text-ink-2 hover:text-ink')}
          >
            {f.label}
          </button>
        ))}
      </div>
      {isLoading && <Spinner className="mx-auto mt-10" />}
      {!isLoading && !items.length && (
        <div className="mt-16 flex flex-col items-center gap-2 text-center text-ink-3">
          <Bookmark className="h-8 w-8" />
          <p className="text-sm">Nothing here yet. Save a chart or table from a chat, or run a deep research.</p>
        </div>
      )}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {items.map((a) => {
          const Icon = ICON[a.type] ?? FileText;
          return (
            <Link key={a.id} href={`/artifacts/${a.id}`} className="group overflow-hidden rounded-xl border border-line bg-panel hover:border-ink-3">
              <div className="pointer-events-none h-44 overflow-hidden border-b border-line bg-bg p-2">
                {a.type === 'chart' && a.spec ? (
                  <VegaChart spec={{ ...a.spec, title: undefined }} height={140} />
                ) : a.type === 'report' ? (
                  <div className="p-3 text-xs leading-relaxed text-ink-2">
                    <div className="mb-1 font-semibold text-ink">{a.findings?.length ?? 0} sources</div>
                    <p className="line-clamp-6">{(a.text ?? '').replace(/[#*[\]]/g, '').slice(0, 400)}</p>
                  </div>
                ) : (
                  <div className="flex h-full items-center justify-center text-ink-3">
                    <Icon className="h-8 w-8" />
                  </div>
                )}
              </div>
              <div className="p-3">
                <div className="flex items-center gap-1.5 text-sm font-medium">
                  <Icon className="h-3.5 w-3.5 shrink-0 text-ink-3" />
                  <span className="truncate">{a.title}</span>
                </div>
                <div className="mt-0.5 text-xs text-ink-3">
                  <span className="capitalize">{a.type}</span> · {new Date(a.refreshedAt ?? a.updatedAt).toLocaleString()}
                </div>
              </div>
            </Link>
          );
        })}
      </div>
    </>
  );
}

function DashboardGrid() {
  const { data = [], isLoading } = useDashboards();
  const router = useRouter();
  const qc = useQueryClient();
  const create = async () => {
    const d = await api<Dashboard>('/dashboards', { method: 'POST', json: { title: 'Untitled dashboard' } });
    qc.invalidateQueries({ queryKey: ['dashboards'] });
    router.push(`/dashboards/${d.id}`);
  };
  return (
    <>
      <div className="mb-4 flex justify-end gap-2">
        <Link href={`/?q=${encodeURIComponent('Build a dashboard for ')}`}>
          <Button variant="primary">
            <LayoutDashboard className="h-4 w-4" /> Build with Flurry
          </Button>
        </Link>
        <Button onClick={create}>
          <Plus className="h-4 w-4" /> Empty dashboard
        </Button>
      </div>
      {isLoading && <Spinner className="mx-auto mt-10" />}
      {!isLoading && !data.length && (
        <div className="mt-16 flex flex-col items-center gap-2 text-center text-ink-3">
          <LayoutDashboard className="h-8 w-8" />
          <p className="text-sm">No dashboards yet. Click “Build with Flurry” and describe the metrics you want, e.g. “rep performance by region”.</p>
        </div>
      )}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {data.map((d) => (
          <Link key={d.id} href={`/dashboards/${d.id}`} className="rounded-xl border border-line bg-panel p-4 hover:border-ink-3">
            <div className="flex items-center gap-2 text-sm font-medium">
              <LayoutDashboard className="h-4 w-4 text-accent" /> <span className="truncate">{d.title}</span>
            </div>
            {d.description && <p className="mt-1 line-clamp-2 text-xs text-ink-2">{d.description}</p>}
            <p className="mt-2 text-xs text-ink-3">
              {d.items.length} tile{d.items.length === 1 ? '' : 's'} · updated {new Date(d.updatedAt).toLocaleDateString()}
            </p>
          </Link>
        ))}
      </div>
    </>
  );
}
