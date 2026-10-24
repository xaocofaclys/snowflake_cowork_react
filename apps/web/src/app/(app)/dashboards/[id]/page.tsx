'use client';

import 'react-grid-layout/css/styles.css';
import 'react-resizable/css/styles.css';
import { useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, FileDown, GripVertical, Pencil, Presentation, RefreshCw, Share2, Trash2, X } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { use, useEffect, useMemo, useState } from 'react';
import RGL, { WidthProvider, type Layout } from 'react-grid-layout';
import type { Artifact, Dashboard, DashboardItem } from '@cowork/shared';
import { DataTable } from '@/components/DataTable';
import { Markdown } from '@/components/Markdown';
import { Button, Modal, Spinner, inputCls } from '@/components/ui';
import { VegaChart } from '@/components/VegaChart';
import { api } from '@/lib/api';
import { exportDashboardPptx, exportPdf } from '@/lib/export';
import { useDashboard, useMe } from '@/lib/hooks';

const Grid = WidthProvider(RGL);
const ROW = 32;

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
  const [sharing, setSharing] = useState(false);
  const [exporting, setExporting] = useState(false);

  const layout: Layout[] = useMemo(() => items.map((i) => ({ i: i.artifactId, x: i.x, y: i.y, w: i.w, h: i.h, minW: 3, minH: 5 })), [items]);

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
  };

  // On open, load live data through the cache (ARTIFACT_CACHE_TTL); "Refresh all" forces fresh queries.
  useEffect(() => {
    refreshAll(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-7xl px-6 py-6">
        <Link href="/artifacts" className="no-print inline-flex items-center gap-1 text-xs text-ink-3 hover:text-ink">
          <ArrowLeft className="h-3.5 w-3.5" /> Artifacts
        </Link>
        <div className="mt-3 flex flex-wrap items-center gap-3">
          {editing ? (
            <input className={`${inputCls} max-w-md text-lg font-semibold`} value={title} onChange={(e) => setTitle(e.target.value)} />
          ) : (
            <h1 className="text-xl font-semibold">{title}</h1>
          )}
          <div className="no-print ml-auto flex flex-wrap gap-2">
            <Button onClick={() => refreshAll(true)} disabled={refreshing.size > 0}>
              <RefreshCw className={`h-3.5 w-3.5 ${refreshing.size ? 'animate-spin' : ''}`} /> Refresh all
            </Button>
            {owner &&
              (editing ? (
                <Button
                  variant="primary"
                  onClick={async () => {
                    await save({ title, items });
                    setEditing(false);
                  }}
                >
                  Done
                </Button>
              ) : (
                <Button variant="ghost" onClick={() => setEditing(true)}>
                  <Pencil className="h-3.5 w-3.5" /> Edit
                </Button>
              ))}
            {owner && (
              <Button variant="ghost" onClick={() => setSharing(true)}>
                <Share2 className="h-3.5 w-3.5" /> Share
              </Button>
            )}
            <Button variant="ghost" onClick={exportPdf}>
              <FileDown className="h-3.5 w-3.5" /> PDF
            </Button>
            <Button
              variant="ghost"
              disabled={exporting}
              onClick={async () => {
                setExporting(true);
                try {
                  await exportDashboardPptx({ ...dashboard, title, items }, Object.values(artifacts));
                } finally {
                  setExporting(false);
                }
              }}
            >
              <Presentation className="h-3.5 w-3.5" /> {exporting ? 'Building…' : 'PowerPoint'}
            </Button>
            {owner && editing && (
              <Button
                variant="ghost"
                className="text-danger"
                onClick={async () => {
                  if (!confirm('Delete this dashboard? The artifacts stay.')) return;
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
        {editing && <p className="no-print mt-2 text-xs text-ink-3">Drag tiles by the handle, resize from the bottom-right corner, remove with ×. Click Done to save.</p>}

        {!items.length ? (
          <p className="mt-16 text-center text-sm text-ink-3">This dashboard is empty. Open a chart or table artifact and choose “Add to dashboard”.</p>
        ) : (
          <Grid
            className="mt-4"
            layout={layout}
            cols={12}
            rowHeight={ROW}
            margin={[16, 16]}
            isDraggable={editing}
            isResizable={editing}
            draggableHandle=".tile-handle"
            onLayoutChange={(l) => editing && setItems(l.map((x) => ({ artifactId: x.i, x: x.x, y: x.y, w: x.w, h: x.h })))}
          >
            {items.map((item) => {
              const a = artifacts[item.artifactId];
              return (
                <div key={item.artifactId} className="print-avoid flex flex-col overflow-hidden rounded-xl border border-line bg-panel">
                  <div className="flex items-center gap-2 border-b border-line px-3 py-2">
                    {editing && <GripVertical className="tile-handle h-4 w-4 cursor-grab text-ink-3" />}
                    <Link href={`/artifacts/${item.artifactId}`} className="min-w-0 flex-1 truncate text-sm font-medium hover:underline">
                      {a?.title ?? 'Unavailable'}
                    </Link>
                    {refreshing.has(item.artifactId) && <Spinner className="h-3.5 w-3.5 text-ink-3" />}
                    {editing && (
                      <button aria-label="Remove tile" onClick={() => setItems((xs) => xs.filter((x) => x.artifactId !== item.artifactId))} className="text-ink-3 hover:text-danger">
                        <X className="h-4 w-4" />
                      </button>
                    )}
                  </div>
                  {/* Tile height in react-grid-layout = rowHeight*h + margin*(h-1); minus header (~41px) and padding. */}
                  <div className="min-h-0 flex-1 overflow-auto p-2">{a && <TileBody a={a} height={item.h * ROW + (item.h - 1) * 16 - 41 - 20} />}</div>
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

function TileBody({ a, height }: { a: Artifact; height: number }) {
  if (a.type === 'chart' && a.spec) return <VegaChart spec={{ ...a.spec, title: undefined }} height={Math.max(120, height)} />;
  if (a.table && a.type === 'table') return <DataTable table={a.table} maxHeight={Math.max(120, height - 24)} />;
  return <Markdown text={(a.text ?? '').slice(0, 1500)} />;
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
