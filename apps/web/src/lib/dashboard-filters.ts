import { applyFilters, type ActiveFilters, type Artifact, type TableData } from '@cowork/shared';

/** A click on a chart mark: filter every tile that has this column to this value. */
export interface CrossFilter {
  column: string;
  value: string;
  label: string;
}

/**
 * Declared filters (via each tile's filterColumns) plus cross-filters (by column name).
 * KPI tiles keep their full time series; they apply the date range themselves to compare periods.
 */
export function filteredTable(a: Artifact, active: ActiveFilters, cross: CrossFilter[], dateKey?: string): TableData | undefined {
  if (!a.table) return undefined;
  const scoped = a.type === 'kpi' && dateKey ? Object.fromEntries(Object.entries(active).filter(([k]) => k !== dateKey)) : active;
  let t = applyFilters(a.table, a.tile, scoped);
  for (const c of cross) {
    // Charts broken down by the clicked column keep every category and highlight the selection instead.
    if (a.type === 'chart' && a.tile?.x === c.column) continue;
    const i = t.columns.findIndex((col) => col.name === c.column);
    if (i >= 0) t = { ...t, rows: t.rows.filter((r) => String(r[i]) === c.value) };
  }
  return t;
}

/** Earliest and latest dates across tiles' date-filter columns (YYYY-MM-DD). */
export function dateBounds(artifacts: Artifact[], key: string): { min?: string; max?: string } {
  let min: string | undefined;
  let max: string | undefined;
  for (const a of artifacts) {
    const col = a.tile?.filterColumns[key];
    const i = col && a.table ? a.table.columns.findIndex((c) => c.name === col) : -1;
    if (i < 0) continue;
    for (const r of a.table!.rows) {
      const d = String(r[i] ?? '').slice(0, 10);
      if (!d) continue;
      if (!min || d < min) min = d;
      if (!max || d > max) max = d;
    }
  }
  return { min, max };
}

/** Presets relative to the latest date in the data (sample data can be historical). */
export function datePresets(max?: string): { label: string; from?: string }[] {
  if (!max) return [{ label: 'All time' }];
  const end = new Date(`${max}T00:00:00Z`);
  const monthsBack = (n: number) => {
    const d = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth() - (n - 1), 1));
    return d.toISOString().slice(0, 10);
  };
  return [
    { label: 'All time' },
    { label: 'Last 3 months', from: monthsBack(3) },
    { label: 'Last 6 months', from: monthsBack(6) },
    { label: 'Last 12 months', from: monthsBack(12) },
    { label: 'Year to date', from: `${end.getUTCFullYear()}-01-01` },
  ];
}
