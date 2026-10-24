'use client';

import 'react-grid-layout/css/styles.css';
import 'react-resizable/css/styles.css';
import { useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, FileDown, GripVertical, MessageSquare, Pencil, Presentation, RefreshCw, Share2, Trash2, X } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { use, useEffect, useMemo, useState } from 'react';
import RGL, { WidthProvider, type Layout } from 'react-grid-layout';
import type { ActiveFilters, Artifact, Dashboard, DashboardItem } from '@cowork/shared';
import { FilterBar } from '@/components/dashboard/FilterBar';
import { DetailsButton, TileBody } from '@/components/dashboard/Tiles';
import { Button, Modal, Spinner, inputCls } from '@/components/ui';
import { api } from '@/lib/api';
import { filteredTable, type CrossFilter } from '@/lib/dashboard-filters';
import { exportDashboardPptx, exportPdf } from '@/lib/export';
import { useDashboard, useMe } from '@/lib/hooks';

const Grid = WidthProvider(RGL);
const ROW = 32;
const MARGIN = 16;

export default function DashboardPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { data, isLoading, error } = useDashboard(id);
  if (isLoading) return <Spinner className="mx-auto mt-20" />;
  if (error || !data) return <p className="p-8 text-sm text-danger">{(error as Error)?.message ?? 'Dashboard not found'}</p>;
  return <DashboardView key={data.dashboard.id} dashboard={data.dashboard} initialArtifacts={data.artifacts} />;
}

function DashboardView({ dashboard, initialArtifacts }: { dashboard: Dashboard; initialArtifacts: Artifact[] }) {
  const { data: me } = useMe();
  const owner = me?.user.id === dashboard.userId;
  const qc = useQueryClient();
  const router = useRouter();
  const [artifacts, setArtifacts] = useState<Record<string, Artifact>>(() => Object.fromEntries(initialArtifacts.map((a) => [a.id, a])));
  const [items, setItems] = useState<DashboardItem[]>(dashboard.items.filter((i) => initialArtifacts.some((a) => a.id === i.artifactId)));
  const [title, setTitle] = useState(dashboard.title);
  const [editing, setEditing] = useState(false);
  const [refreshing, setRefreshing] = useState<Set<string>>(new Set());
  const [refreshedAt, setRefreshedAt] = useState<string>();
  const [sharing, setSharing] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [active, setActive] = useState<ActiveFilters>({});
  const [cross, setCross] = useState<CrossFilter[]>([]);

  const layout: Layout[] = useMemo(
    () => items.map((i) => ({ i: i.artifactId, x: i.x, y: i.y, w: i.w, h: i.h, minW: artifacts[i.artifactId]?.type === 'kpi' ? 2 : 3, minH: artifacts[i.artifactId]?.type === 'kpi' ? 3 : 5 })),
    [items, artifacts],
  );
  const filters = dashboard.filters ?? [];
  const list = useMemo(() => items.map((i) => artifacts[i.artifactId]).filter(Boolean), [items, artifacts]);
  // Each tile's rows after slicers and cross-filters, recomputed in the browser.
  const dateKey = filters.find((f) => f.kind === 'date')?.key;
  const tables = useMemo(() => Object.fromEntries(list.map((a) => [a.id, filteredTable(a, active, cross, dateKey)])), [list, active, cross, dateKey]);
  const range = dateKey && active[dateKey] && 'from' in active[dateKey] ? (active[dateKey] as { from?: string; to?: string }) : undefined;

  const save = async (patch: Partial<Dashboard>) => {
    const d = await api<Dashboard>(`/dashboards/${dashboard.id}`, { method: 'PATCH', json: patch });
    qc.invalidateQueries({ queryKey: ['dashboards'] });
    return d;
  };

  const refreshAll = async (force = true) => {
    const ids = items.map((i) => i.artifactId).filter((id) => artifacts[id]?.sql || artifacts[id]?.type === 'report');
    setRefreshing(new Set(ids));
    await Promise.all(
      ids.map(async (id) => {
        try {
          const a = await api<Artifact>(`/artifacts/${id}/refresh${force ? '?force=true' : ''}`, { method: 'POST' });
          setArtifacts((m) => ({ ...m, [id]: a }));
        } finally {
          setRefreshing((s) => {
            const n = new Set(s);
            n.delete(id);
            return n;
          });
        }
      }),
    );
    setRefreshedAt(new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }));
  };

  // On open, load live data through the cache (ARTIFACT_CACHE_TTL); "Refresh" forces fresh queries.
  useEffect(() => {
    refreshAll(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const crossFilter = (column: string, value: string, label: string) =>
    setCross((cs) => {
      const existing = cs.find((c) => c.column === column);
      if (existing?.value === value) return cs.filter((c) => c.column !== column); // click again to clear
      return [...cs.filter((c) => c.column !== column), { column, value, label }];
    });

  return (
    <div className="h-full overflow-y-auto bg-sidebar">
      <div className="mx-auto max-w-[1400px] space-y-4 px-6 py-5">
        {/* header */}
        <div className="rounded-xl border border-line bg-panel px-5 py-4">
          <Link href="/artifacts" className="no-print inline-flex items-center gap-1 text-xs text-ink-3 hover:text-ink">
            <ArrowLeft className="h-3.5 w-3.5" /> Dashboards
          </Link>
          <div className="mt-2 flex flex-wrap items-start gap-3">
            <div className="min-w-0 flex-1">
              {editing ? (
                <input className={`${inputCls} max-w-md text-lg font-semibold`} value={title} onChange={(e) => setTitle(e.target.value)} />
              ) : (
                <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
              )}
              <p className="mt-0.5 text-xs text-ink-3">
                {dashboard.description ? `${dashboard.description} · ` : ''}
                {refreshing.size ? 'Refreshing…' : refreshedAt ? `Data refreshed ${refreshedAt}` : 'Live data from Snowflake'}
              </p>
            </div>
            <div className="no-print flex flex-wrap gap-1.5">
              <Button size="sm" onClick={() => refreshAll(true)} disabled={refreshing.size > 0}>
                <RefreshCw className={`h-3.5 w-3.5 ${refreshing.size ? 'animate-spin' : ''}`} /> Refresh
              </Button>
              {dashboard.threadId && owner && (
                <Button size="sm" variant="ghost" onClick={() => router.push(`/c/${dashboard.threadId}`)} title="Ask for changes in the conversation that built this dashboard">
                  <MessageSquare className="h-3.5 w-3.5" /> Edit in chat
                </Button>
              )}
              {owner &&
                (editing ? (
                  <Button
                    size="sm"
                    variant="primary"
                    onClick={async () => {
                      await save({ title, items });
                      setEditing(false);
                    }}
                  >
                    Done
                  </Button>
                ) : (
                  <Button size="sm" variant="ghost" onClick={() => setEditing(true)}>
                    <Pencil className="h-3.5 w-3.5" /> Layout
                  </Button>
                ))}
              {owner && (
                <Button size="sm" variant="ghost" onClick={() => setSharing(true)}>
                  <Share2 className="h-3.5 w-3.5" /> Share
                </Button>
              )}
              <Button size="sm" variant="ghost" onClick={exportPdf}>
                <FileDown className="h-3.5 w-3.5" /> PDF
              </Button>
              <Button
                size="sm"
                variant="ghost"
                disabled={exporting}
                onClick={async () => {
                  setExporting(true);
                  try {
                    await exportDashboardPptx({ ...dashboard, title, items }, list, tables, range);
                  } finally {
                    setExporting(false);
                  }
                }}
              >
                <Presentation className="h-3.5 w-3.5" /> {exporting ? 'Building…' : 'PowerPoint'}
              </Button>
              {owner && editing && (
                <Button
                  size="sm"
                  variant="ghost"
                  className="text-danger"
                  onClick={async () => {
                    if (!confirm('Delete this dashboard? Its tiles stay in Artifacts.')) return;
                    await api(`/dashboards/${dashboard.id}`, { method: 'DELETE' });
                    qc.invalidateQueries({ queryKey: ['dashboards'] });
                    router.push('/artifacts');
                  }}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              )}
            </div>
          </div>
        </div>

        <FilterBar
          filters={filters}
          artifacts={list}
          active={active}
          cross={cross}
          onChange={setActive}
          onClearCross={(column) => setCross((cs) => (column ? cs.filter((c) => c.column !== column) : []))}
        />
        {editing && <p className="no-print text-xs text-ink-3">Drag tiles by the handle, resize from the bottom-right corner, remove with ×. Click Done to save.</p>}

        {!items.length ? (
          <p className="py-16 text-center text-sm text-ink-3">
            This dashboard is empty. Ask in chat: “build a dashboard for …”, or add charts from Artifacts.
          </p>
        ) : (
          <Grid
            className="-mx-4"
            layout={layout}
            cols={12}
            rowHeight={ROW}
            margin={[MARGIN, MARGIN]}
            isDraggable={editing}
            isResizable={editing}
            draggableHandle=".tile-handle"
            onLayoutChange={(l) => editing && setItems(l.map((x) => ({ artifactId: x.i, x: x.x, y: x.y, w: x.w, h: x.h })))}
          >
            {items.map((item) => {
              const a = artifacts[item.artifactId];
              const isKpi = a?.type === 'kpi';
              const xLabel = a?.tile?.x ? (filters.find((f) => a.tile!.filterColumns[f.key] === a.tile!.x)?.label ?? a.tile.x) : '';
              return (
                <div key={item.artifactId} className="print-avoid flex flex-col overflow-hidden rounded-xl border border-line bg-panel shadow-sm">
                  {!isKpi && (
                    <div className="flex items-center gap-2 px-4 pb-1 pt-3">
                      {editing && <GripVertical className="tile-handle h-4 w-4 cursor-grab text-ink-3" />}
                      <Link href={`/artifacts/${item.artifactId}`} className="min-w-0 flex-1 truncate text-sm font-semibold hover:underline">
                        {a?.title ?? 'Unavailable'}
                      </Link>
                      {refreshing.has(item.artifactId) && <Spinner className="h-3.5 w-3.5 text-ink-3" />}
                      {a && <DetailsButton a={a} table={tables[a.id]} />}
                      {editing && <RemoveTile onClick={() => setItems((xs) => xs.filter((x) => x.artifactId !== item.artifactId))} />}
                    </div>
                  )}
                  {isKpi && editing && (
                    <div className="flex items-center justify-between px-3 pt-2">
                      <GripVertical className="tile-handle h-4 w-4 cursor-grab text-ink-3" />
                      <RemoveTile onClick={() => setItems((xs) => xs.filter((x) => x.artifactId !== item.artifactId))} />
                    </div>
                  )}
                  <div className={isKpi ? 'min-h-0 flex-1' : 'min-h-0 flex-1 overflow-auto px-3 pb-3'}>
                    {a && (
                      <TileBody
                        a={a}
                        table={tables[a.id]}
                        range={range}
                        height={item.h * ROW + (item.h - 1) * MARGIN - 44 - 16}
                        selected={cross.find((c) => c.column === a.tile?.x)?.value}
                        onSelect={editing ? undefined : (column, value) => crossFilter(column, value, xLabel)}
                      />
                    )}
                  </div>
                </div>
              );
            })}
          </Grid>
        )}
      </div>
      {sharing && <ShareDashboard dashboard={dashboard} onClose={() => setSharing(false)} />}
    </div>
  );
}

function RemoveTile({ onClick }: { onClick: () => void }) {
  return (
    <button aria-label="Remove tile" onClick={onClick} className="text-ink-3 hover:text-danger">
      <X className="h-4 w-4" />
    </button>
  );
}

function ShareDashboard({ dashboard, onClose }: { dashboard: Dashboard; onClose: () => void }) {
  const [users, setUsers] = useState((dashboard.sharedWith ?? []).filter((u) => u !== '*').join(', '));
  const [everyone, setEveryone] = useState(dashboard.sharedWith?.includes('*') ?? false);
  const qc = useQueryClient();
  return (
    <Modal open onClose={onClose} title="Share dashboard">
      <div className="space-y-3 text-sm">
        <p className="text-xs text-ink-3">Viewers also need access to each tile's artifact. Share those too, or tiles they can't open are hidden.</p>
        <label className="block text-xs font-medium text-ink-2">
          Snowflake usernames (comma-separated)
          <input className={`${inputCls} mt-1`} value={users} onChange={(e) => setUsers(e.target.value)} />
        </label>
        <label className="flex items-center gap-2 text-xs">
          <input type="checkbox" checked={everyone} onChange={(e) => setEveryone(e.target.checked)} /> Anyone signed in to this app
        </label>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            onClick={async () => {
              const sharedWith = [...users.split(',').map((u) => u.trim()).filter(Boolean), ...(everyone ? ['*'] : [])];
              await api(`/dashboards/${dashboard.id}`, { method: 'PATCH', json: { sharedWith } });
              qc.invalidateQueries({ queryKey: ['dashboard', dashboard.id] });
              onClose();
            }}
          >
            Save
          </Button>
        </div>
      </div>
    </Modal>
  );
}
