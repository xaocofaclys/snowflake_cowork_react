import { columnRole, tableToValues } from './charts';
import { formatCompact, type Currency, type NumberFormat } from './insights';
import type { TableData } from './events';

/**
 * Chat-built dashboards ("Power BI style"): each tile keeps the agent's result table including
 * filter columns, so filters, cross-filtering and drill-down run in the browser without new queries.
 * Charts are built here from explicit roles so filtered data always re-aggregates correctly.
 */

export type TileKind = 'kpi' | 'chart' | 'table';
export type TileChart = 'line' | 'area' | 'bar' | 'hbar' | 'stacked' | 'donut' | 'scatter';
export type KpiFormat = 'number' | 'currency' | 'percent';
export type Aggregate = 'sum' | 'mean' | 'last';

/** What the designer asked for (column names are hints until data arrives). */
export interface TileDesign {
  id: string;
  kind: TileKind;
  title: string;
  question: string;
  agentId: string;
  chart?: TileChart;
  x?: string;
  y?: string;
  color?: string;
  aggregate?: Aggregate;
  format?: KpiFormat;
  width?: 'third' | 'half' | 'full';
}

export interface DashboardFilter {
  key: string;
  label: string;
  kind: 'dimension' | 'date';
  /** Words that identify the column in result tables, e.g. ["region", "region_name"]. */
  hints: string[];
}

/** Stored on each tile's artifact once its data has arrived. */
export interface TileConfig {
  kind: TileKind;
  chart?: TileChart;
  /** Resolved column names in this tile's table. */
  x?: string;
  y?: string;
  color?: string;
  time?: string;
  aggregate: Aggregate;
  format?: KpiFormat;
  /** filter key → column in this tile's table (absent = tile ignores that filter). */
  filterColumns: Record<string, string>;
}

export type FilterValue = { value: string } | { from?: string; to?: string };
export type ActiveFilters = Record<string, FilterValue>;

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');

function findColumn(table: TableData, hints: (string | undefined)[], role?: 'temporal' | 'quantitative' | 'nominal', exclude: string[] = []): string | undefined {
  const cols = table.columns.map((c, i) => ({ name: c.name, role: columnRole(c, table.rows, i) })).filter((c) => !exclude.includes(c.name));
  const wanted = hints.filter(Boolean).map((h) => norm(h!)).filter(Boolean);
  for (const w of wanted) {
    const hit = cols.find((c) => norm(c.name) === w) ?? cols.find((c) => norm(c.name).includes(w) || (w.length > 3 && w.includes(norm(c.name))));
    if (hit && (!role || hit.role === role || (role === 'nominal' && hit.role !== 'quantitative'))) return hit.name;
  }
  return role ? cols.find((c) => c.role === role)?.name : undefined;
}

/** Maps a design onto the columns the agent actually returned. */
export function resolveTile(design: TileDesign, table: TableData, filters: DashboardFilter[]): TileConfig {
  const filterColumns: Record<string, string> = {};
  for (const f of filters) {
    const col = f.kind === 'date' ? findColumn(table, f.hints, 'temporal') : findColumn(table, [f.key, ...f.hints], 'nominal');
    if (col) filterColumns[f.key] = col;
  }
  const time = findColumn(table, [], 'temporal');
  const y = findColumn(table, [design.y], 'quantitative');
  if (design.kind === 'kpi') {
    return { kind: 'kpi', y, time, aggregate: design.aggregate ?? 'sum', format: design.format ?? 'number', filterColumns };
  }
  const chart = design.chart ?? 'bar';
  const x =
    chart === 'line' || chart === 'area'
      ? (findColumn(table, [design.x], 'temporal') ?? findColumn(table, [design.x], 'nominal'))
      : findColumn(table, [design.x], 'nominal', y ? [y] : []) ?? findColumn(table, [design.x]);
  const color = design.color ? findColumn(table, [design.color], 'nominal', [x ?? '']) : undefined;
  return { kind: design.kind, chart, x, y, color, time, aggregate: design.aggregate ?? 'sum', format: design.format, filterColumns };
}

/** Distinct values of a filter across tiles, for the filter dropdowns. */
export function filterValues(tiles: { table?: TableData; tile?: TileConfig }[], key: string): string[] {
  const out = new Set<string>();
  for (const t of tiles) {
    const col = t.tile?.filterColumns[key];
    if (!col || !t.table) continue;
    const i = t.table.columns.findIndex((c) => c.name === col);
    for (const r of t.table.rows) if (r[i] !== null && r[i] !== undefined) out.add(String(r[i]));
  }
  return [...out].sort();
}

const day = (v: unknown) => String(v ?? '').slice(0, 10);

/** Rows of a tile that pass the active filters (filters the tile has no column for are ignored). */
export function applyFilters(table: TableData, tile: TileConfig | undefined, active: ActiveFilters): TableData {
  if (!tile) return table;
  const checks: ((r: unknown[]) => boolean)[] = [];
  for (const [key, f] of Object.entries(active)) {
    const col = tile.filterColumns[key];
    const i = col ? table.columns.findIndex((c) => c.name === col) : -1;
    if (i < 0) continue;
    if ('value' in f) checks.push((r) => String(r[i]) === f.value);
    else checks.push((r) => (!f.from || day(r[i]) >= f.from) && (!f.to || day(r[i]) <= f.to));
  }
  return checks.length ? { ...table, rows: table.rows.filter((r) => checks.every((c) => c(r))) } : table;
}

/** Filters a tile is actually affected by, for "not filtered by" hints. */
export function unaffectedFilters(tile: TileConfig | undefined, active: ActiveFilters): string[] {
  return Object.keys(active).filter((k) => !tile?.filterColumns[k]);
}

function agg(values: number[], how: Aggregate): number | null {
  if (!values.length) return null;
  if (how === 'last') return values[values.length - 1];
  const sum = values.reduce((a, b) => a + b, 0);
  return how === 'mean' ? sum / values.length : sum;
}

export interface KpiValue {
  value: number | null;
  previous: number | null;
  /** Fractional change, e.g. 0.12 = +12%. */
  delta: number | null;
  comparison: string;
  series: { t: string; v: number }[];
}

/**
 * KPI from a time series: with a date range, the range vs the equally long window before it;
 * without one, the latest period vs the one before.
 */
export function computeKpi(table: TableData, tile: TileConfig, range?: { from?: string; to?: string }): KpiValue {
  const yi = table.columns.findIndex((c) => c.name === tile.y);
  const ti = table.columns.findIndex((c) => c.name === tile.time);
  if (yi < 0) return { value: null, previous: null, delta: null, comparison: '', series: [] };
  if (ti < 0) {
    const value = agg(table.rows.map((r) => Number(r[yi])).filter(Number.isFinite), tile.aggregate);
    return { value, previous: null, delta: null, comparison: '', series: [] };
  }
  // Collapse to one value per period (rows may also be split by filter dimensions).
  const byT = new Map<string, number[]>();
  for (const r of table.rows) {
    const v = Number(r[yi]);
    if (!Number.isFinite(v)) continue;
    const t = day(r[ti]);
    byT.set(t, [...(byT.get(t) ?? []), v]);
  }
  // Within a period, rows split by dimensions add up (rates average); across periods use the tile's aggregate.
  const perPeriod = tile.format === 'percent' ? 'mean' : 'sum';
  const series = [...byT.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([t, vs]) => ({ t, v: agg(vs, perPeriod)! }));
  if (!series.length) return { value: null, previous: null, delta: null, comparison: '', series };

  let cur: number[];
  let prev: number[];
  let comparison: string;
  if (range?.from || range?.to) {
    const inRange = series.filter((s) => (!range.from || s.t >= range.from) && (!range.to || s.t <= range.to));
    const firstIdx = series.indexOf(inRange[0]);
    cur = inRange.map((s) => s.v);
    prev = firstIdx > 0 ? series.slice(Math.max(0, firstIdx - inRange.length), firstIdx).map((s) => s.v) : [];
    comparison = `vs previous ${inRange.length} period${inRange.length === 1 ? '' : 's'}`;
  } else {
    cur = [series[series.length - 1].v];
    prev = series.length > 1 ? [series[series.length - 2].v] : [];
    comparison = 'vs previous period';
  }
  const how = tile.aggregate === 'sum' ? 'sum' : tile.aggregate;
  const value = agg(cur, how);
  const previous = prev.length ? agg(prev, how) : null;
  const delta = value !== null && previous ? (value - previous) / Math.abs(previous) : null;
  return { value, previous, delta, comparison, series };
}

export function formatKpi(v: number | null, format: KpiFormat = 'number', prefs: { numberFormat?: NumberFormat; currency?: Currency } = {}): string {
  if (v === null || !Number.isFinite(v)) return '—';
  if (format === 'percent') return `${(Math.abs(v) <= 1.5 ? v * 100 : v).toFixed(1)}%`;
  return formatCompact(v, { numberFormat: prefs.numberFormat, currency: format === 'currency' ? (prefs.currency ?? 'USD') : undefined });
}

const field = (name: string) => name.replace(/([.[\]])/g, '\\$1');

/** Vega-Lite spec for a chart tile from its (filtered) table and resolved roles. */
export function buildTileSpec(table: TableData, tile: TileConfig): Record<string, unknown> | null {
  if (!tile.y || !tile.x || !table.rows.length) return null;
  const values = tableToValues(table);
  const vlAgg = tile.aggregate === 'mean' ? 'mean' : 'sum';
  const xRole = columnRole(table.columns.find((c) => c.name === tile.x)!, table.rows, table.columns.findIndex((c) => c.name === tile.x));
  const xType = xRole === 'temporal' ? 'temporal' : 'nominal';
  // Dashboards read time by month: group and label at month level whatever the row grain.
  const timeX = xType === 'temporal' ? { timeUnit: 'yearmonth', axis: { format: '%b %y', labelOverlap: 'greedy' } } : {};
  const y = { field: field(tile.y), type: 'quantitative', aggregate: vlAgg, title: null };
  const color = tile.color ? { color: { field: field(tile.color), type: 'nominal', title: null } } : {};
  const base = { $schema: 'https://vega.github.io/schema/vega-lite/v5.json', data: { values }, width: 'container', autosize: { type: 'fit', contains: 'padding' } };
  const tooltip = [
    { field: field(tile.x), type: xType, ...(xType === 'temporal' ? { timeUnit: 'yearmonth', format: '%b %Y' } : {}) },
    ...(tile.color ? [{ field: field(tile.color), type: 'nominal' }] : []),
    { field: field(tile.y), type: 'quantitative', aggregate: vlAgg, format: ',.2~f' },
  ];

  switch (tile.chart) {
    case 'line':
    case 'area':
      return {
        ...base,
        mark: tile.chart === 'line' ? { type: 'line', point: true } : { type: 'area', line: true, opacity: 0.15 },
        encoding: { x: { field: field(tile.x), type: xType, title: null, ...timeX }, y, ...color, tooltip },
      };
    case 'donut':
      return {
        ...base,
        mark: { type: 'arc', innerRadius: 55, padAngle: 0.01 },
        encoding: { theta: { ...y, stack: true }, color: { field: field(tile.x), type: 'nominal', title: null, sort: { op: vlAgg, field: field(tile.y), order: 'descending' } }, tooltip },
      };
    case 'scatter':
      return { ...base, mark: { type: 'point', filled: true }, encoding: { x: { field: field(tile.x), type: 'nominal', title: null }, y, ...color, tooltip } };
    case 'hbar':
      return {
        ...base,
        mark: { type: 'bar' },
        transform: topN(tile, vlAgg, 15),
        encoding: { y: { field: field(tile.x), type: 'nominal', title: null, sort: '-x' }, x: y, ...color, tooltip },
      };
    case 'stacked':
    case 'bar':
    default:
      return {
        ...base,
        mark: { type: 'bar' },
        ...(xType === 'nominal' ? { transform: topN(tile, vlAgg, 15) } : {}),
        encoding: { x: { field: field(tile.x), type: xType, title: null, ...(xType === 'nominal' ? { sort: '-y' } : timeX) }, y, ...color, tooltip },
      };
  }
}

/** Keep the top N categories by value so bars stay readable after filtering. */
function topN(tile: TileConfig, op: string, n: number) {
  return [
    { joinaggregate: [{ op, field: tile.y!, as: '__total' }], groupby: [tile.x!] },
    { window: [{ op: 'dense_rank', as: '__rank' }], sort: [{ field: '__total', order: 'descending' }] },
    { filter: `datum.__rank <= ${n}` },
  ];
}

/** Grid layout for a designed dashboard: KPI row, then charts two per row (or full width). */
export function layoutTiles(tiles: { id: string; kind: TileKind; width?: TileDesign['width'] }[]) {
  const out: { id: string; x: number; y: number; w: number; h: number }[] = [];
  const kpis = tiles.filter((t) => t.kind === 'kpi');
  const kw = kpis.length ? Math.max(2, Math.floor(12 / Math.min(kpis.length, 6))) : 0;
  kpis.forEach((t, i) => out.push({ id: t.id, x: (i * kw) % 12, y: Math.floor((i * kw) / 12) * 4, w: kw, h: 4 }));
  let y = kpis.length ? Math.ceil((kpis.length * kw) / 12) * 4 : 0;
  let x = 0;
  for (const t of tiles.filter((t) => t.kind !== 'kpi')) {
    const w = t.width === 'full' || t.kind === 'table' ? 12 : t.width === 'third' ? 4 : 6;
    if (x + w > 12) {
      x = 0;
      y += 9;
    }
    out.push({ id: t.id, x, y, w, h: 9 });
    x += w;
  }
  return out;
}
