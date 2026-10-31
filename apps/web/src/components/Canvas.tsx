'use client';

import { BarChart3, ExternalLink, FileText, LayoutDashboard, X } from 'lucide-react';
import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useArtifact, useDashboard } from '@/lib/hooks';
import { useUi, type CanvasItem } from '@/lib/ui-store';
import { ResultCard } from './blocks/ResultCard';
import { DashboardView } from './dashboard/DashboardView';
import { KpiCard } from './dashboard/Tiles';
import { DataTable } from './DataTable';
import { AssistantMessage } from './Message';
import { ReportView } from './ReportView';
import { IconButton, Spinner } from './ui';
import { VegaChart } from './VegaChart';

const ICON = { result: BarChart3, artifact: FileText, dashboard: LayoutDashboard };

/** The live canvas: a resizable panel beside the chat showing a result, report or dashboard. */
export function CanvasPanel({ item }: { item: CanvasItem }) {
  const close = useUi((s) => s.closeCanvas);
  const [width, setWidth] = useState(52);
  const dragging = useRef(false);
  const Icon = ICON[item.kind];
  const href = item.kind === 'dashboard' ? `/dashboards/${item.id}` : item.kind === 'artifact' ? `/artifacts/${item.id}` : null;

  const onMove = useCallback((e: PointerEvent) => {
    if (!dragging.current) return;
    const pct = ((window.innerWidth - e.clientX) / window.innerWidth) * 100;
    setWidth(Math.min(72, Math.max(32, pct)));
  }, []);
  useEffect(() => {
    const up = () => (dragging.current = false);
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', up);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', up);
    };
  }, [onMove]);
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === 'Escape' && !useUi.getState().palette && close();
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [close]);

  return (
    <aside
      style={{ '--canvas-w': `${width}%` } as React.CSSProperties}
      className="animate-slide-in fixed inset-0 z-40 flex flex-col border-l border-line bg-canvas lg:relative lg:inset-auto lg:z-auto lg:w-[var(--canvas-w)] lg:shrink-0"
    >
      <div
        role="separator"
        aria-label="Resize canvas"
        onPointerDown={() => (dragging.current = true)}
        className="absolute inset-y-0 -left-1 z-10 hidden w-2 cursor-col-resize hover:bg-accent/20 lg:block"
      />
      <div className="flex h-12 shrink-0 items-center gap-2 border-b border-line bg-bg px-4">
        <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-accent-soft text-accent">
          <Icon className="h-4 w-4" />
        </span>
        <span className="min-w-0 flex-1 truncate text-sm font-semibold">{item.title}</span>
        {href && (
          <Link href={href} className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs text-ink-3 hover:bg-raised hover:text-ink">
            <ExternalLink className="h-3.5 w-3.5" /> Open page
          </Link>
        )}
        <IconButton label="Close canvas" onClick={close}>
          <X className="h-4 w-4" />
        </IconButton>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {item.kind === 'result' && (
          <div className="p-4">
            <ResultCard group={item.group} ctx={item.ctx} inCanvas />
          </div>
        )}
        {item.kind === 'artifact' && <ArtifactCanvas id={item.id} />}
        {item.kind === 'dashboard' && <DashboardCanvas id={item.id} />}
      </div>
    </aside>
  );
}

function ArtifactCanvas({ id }: { id: string }) {
  const { data: a, isLoading } = useArtifact(id);
  if (isLoading || !a) return <Spinner className="mx-auto mt-16 text-ink-3" />;
  return (
    <div className="space-y-4 p-5">
      {a.type === 'report' && <ReportView artifact={a} />}
      {a.type === 'answer' && a.blocks && <AssistantMessage blocks={a.blocks} ctx={{ agentId: a.agentId, question: a.question }} />}
      {a.type === 'kpi' && (
        <div className="max-w-sm rounded-2xl border border-line bg-panel shadow-soft">
          <KpiCard a={a} table={a.table} />
        </div>
      )}
      {a.type === 'chart' && a.spec && (
        <div className="rounded-2xl border border-line bg-panel p-4 shadow-soft">
          <VegaChart spec={a.spec} height={380} />
        </div>
      )}
      {(a.type === 'chart' || a.type === 'table' || a.type === 'kpi') && a.table && <DataTable table={a.table} maxHeight={420} />}
    </div>
  );
}

function DashboardCanvas({ id }: { id: string }) {
  const { data, isLoading } = useDashboard(id);
  if (isLoading || !data) return <Spinner className="mx-auto mt-16 text-ink-3" />;
  return <DashboardView key={`${data.dashboard.id}:${data.dashboard.updatedAt}`} dashboard={data.dashboard} initialArtifacts={data.artifacts} embedded />;
}
