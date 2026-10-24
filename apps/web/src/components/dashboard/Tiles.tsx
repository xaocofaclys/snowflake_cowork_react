'use client';

import clsx from 'clsx';
import { ArrowDownRight, ArrowUpRight, Minus, TableProperties } from 'lucide-react';
import { useMemo, useState } from 'react';
import { buildTileSpec, computeKpi, formatKpi, type Artifact, type KpiValue, type TableData } from '@cowork/shared';
import { DataTable } from '../DataTable';
import { Markdown } from '../Markdown';
import { Modal } from '../ui';
import { VegaChart } from '../VegaChart';

/** Small trend line for KPI cards: recessive, single series, no axes. */
function Sparkline({ series }: { series: KpiValue['series'] }) {
  if (series.length < 2) return null;
  const w = 120;
  const h = 32;
  const vs = series.map((s) => s.v);
  const min = Math.min(...vs);
  const max = Math.max(...vs);
  const pts = vs.map((v, i) => `${(i / (vs.length - 1)) * w},${h - 3 - ((v - min) / (max - min || 1)) * (h - 6)}`);
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} className="overflow-visible" aria-hidden>
      <polyline points={pts.join(' ')} fill="none" stroke="var(--accent)" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={pts[pts.length - 1].split(',')[0]} cy={pts[pts.length - 1].split(',')[1]} r={3} fill="var(--accent)" stroke="var(--panel)" strokeWidth={2} />
    </svg>
  );
}

export function KpiCard({ a, table, range }: { a: Artifact; table?: TableData; range?: { from?: string; to?: string } }) {
  const k = useMemo(() => (a.tile && table ? computeKpi(table, a.tile, range) : null), [a.tile, table, range]);
  const up = (k?.delta ?? 0) > 0.0005;
  const down = (k?.delta ?? 0) < -0.0005;
  const Icon = up ? ArrowUpRight : down ? ArrowDownRight : Minus;
  return (
    <div className="flex h-full flex-col justify-between p-4">
      <div className="text-xs font-medium uppercase tracking-wide text-ink-2">{a.title}</div>
      <div className="flex items-end justify-between gap-2">
        <div>
          <div className="text-3xl font-semibold tabular-nums tracking-tight">{formatKpi(k?.value ?? null, a.tile?.format)}</div>
          {k?.delta !== null && k?.delta !== undefined ? (
            <div className="mt-1 flex items-center gap-1 text-xs text-ink-2">
              <span className={clsx('inline-flex items-center gap-0.5 rounded-md px-1.5 py-0.5 font-medium', up && 'bg-accent-soft text-accent', down && 'bg-danger/10 text-danger', !up && !down && 'bg-raised')}>
                <Icon className="h-3 w-3" />
                {up ? '+' : ''}
                {(k.delta * 100).toFixed(1)}%
              </span>
              <span className="text-ink-3">{k.comparison}</span>
            </div>
          ) : (
            <div className="mt-1 text-xs text-ink-3">{k?.series.length ? 'No earlier period to compare' : ' '}</div>
          )}
        </div>
        {k && <Sparkline series={k.series} />}
      </div>
    </div>
  );
}

/** A chart tile: spec rebuilt from the filtered rows; clicking a mark cross-filters the dashboard. */
export function ChartTile({
  a,
  table,
  height,
  selected,
  onSelect,
}: {
  a: Artifact;
  table?: TableData;
  height: number;
  selected?: string;
  onSelect?: (column: string, value: string) => void;
}) {
  const spec = useMemo(() => {
    if (!a.tile || !table) return a.spec ?? null;
    const s = buildTileSpec(table, a.tile);
    if (!s || !selected || !a.tile.x) return s;
    // Keep the selected category emphasized and fade the rest.
    const enc = (s.encoding ?? {}) as Record<string, unknown>;
    return { ...s, encoding: { ...enc, opacity: { condition: { test: `datum[${JSON.stringify(a.tile.x)}] == ${JSON.stringify(selected)}`, value: 1 }, value: 0.35 } } };
  }, [a.tile, a.spec, table, selected]);

  if (table && !table.rows.length) return <Empty text="No data for the current filters" />;
  if (!spec) return <Empty text="This tile couldn't be drawn" />;
  return (
    <VegaChart
      spec={{ ...spec, title: undefined }}
      height={height}
      onSelect={
        onSelect && a.tile?.x
          ? (d) => {
              const v = d[a.tile!.x!];
              if (v !== undefined && v !== null && !(v instanceof Date)) onSelect(a.tile!.x!, String(v));
            }
          : undefined
      }
    />
  );
}

export function TileBody({ a, table, height, range, selected, onSelect }: { a: Artifact; table?: TableData; height: number; range?: { from?: string; to?: string }; selected?: string; onSelect?: (column: string, value: string) => void }) {
  if (a.type === 'kpi') return <KpiCard a={a} table={table} range={range} />;
  if (a.type === 'chart') return <ChartTile a={a} table={table} height={height} selected={selected} onSelect={onSelect} />;
  if (a.type === 'table' && table) return <DataTable table={table} maxHeight={Math.max(120, height - 24)} />;
  return <Markdown text={(a.text ?? '').slice(0, 1500)} />;
}

function Empty({ text }: { text: string }) {
  return <div className="flex h-full min-h-24 items-center justify-center text-xs text-ink-3">{text}</div>;
}

/** Drill-down: the rows behind a tile (after filters) and its SQL. */
export function DetailsButton({ a, table }: { a: Artifact; table?: TableData }) {
  const [open, setOpen] = useState(false);
  if (!table) return null;
  return (
    <>
      <button aria-label="Show data" title="Show data" onClick={() => setOpen(true)} className="no-print rounded p-1 text-ink-3 hover:bg-raised hover:text-ink">
        <TableProperties className="h-3.5 w-3.5" />
      </button>
      {open && (
        <Modal open onClose={() => setOpen(false)} title={a.title} wide>
          <div className="space-y-3">
            <DataTable table={table} maxHeight={420} />
            {a.sql && (
              <details className="text-xs">
                <summary className="cursor-pointer text-ink-3">SQL</summary>
                <pre className="mt-1 max-h-48 overflow-auto rounded-lg bg-raised p-2 font-mono text-[11px]">{a.sql}</pre>
              </details>
            )}
          </div>
        </Modal>
      )}
    </>
  );
}
