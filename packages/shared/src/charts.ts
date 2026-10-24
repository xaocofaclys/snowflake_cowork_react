import type { Column, TableData } from './events';

export type ChartType = 'bar' | 'line' | 'area' | 'pie' | 'scatter';
export const CHART_TYPES: ChartType[] = ['bar', 'line', 'area', 'pie', 'scatter'];

type Role = 'temporal' | 'quantitative' | 'nominal';
type VLSpec = Record<string, unknown>;

const VL_SCHEMA = 'https://vega.github.io/schema/vega-lite/v5.json';
const NUMERIC_TYPES = /^(fixed|real|number|numeric|decimal|int|integer|bigint|float|double)/i;
const TEMPORAL_TYPES = /^(date|time|timestamp)/i;
const TEMPORAL_NAMES = /(date|month|week|day|quarter|period|_at$|time)/i;

function isNumeric(v: unknown): boolean {
  if (typeof v === 'number') return Number.isFinite(v);
  return typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v));
}

function isDateLike(v: unknown): boolean {
  if (typeof v !== 'string') return false;
  return /^\d{4}-\d{2}(-\d{2})?([ T]\d{2}:\d{2}.*)?$/.test(v.trim());
}

export function columnRole(col: Column, rows: unknown[][], idx: number): Role {
  const sample = rows.slice(0, 50).map((r) => r[idx]).filter((v) => v !== null && v !== undefined);
  if (TEMPORAL_TYPES.test(col.type)) return 'temporal';
  if (sample.length && sample.every(isDateLike)) return 'temporal';
  if (/year/i.test(col.name)) return 'nominal';
  if (NUMERIC_TYPES.test(col.type) || (sample.length > 0 && sample.every(isNumeric))) {
    // Integer keys like IDs look numeric but are categories.
    if (/(^id$|_id$|_key$|key$)/i.test(col.name)) return 'nominal';
    return 'quantitative';
  }
  if (TEMPORAL_NAMES.test(col.name) && sample.every(isDateLike)) return 'temporal';
  return 'nominal';
}

/** Converts a table to Vega-Lite inline values, coercing numeric columns. */
export function tableToValues(table: TableData): Record<string, unknown>[] {
  const roles = table.columns.map((c, i) => columnRole(c, table.rows, i));
  return table.rows.map((row) => {
    const o: Record<string, unknown> = {};
    table.columns.forEach((c, i) => {
      const v = row[i];
      o[c.name] = roles[i] === 'quantitative' && v !== null && v !== undefined ? Number(v) : v;
    });
    return o;
  });
}

/** Recovers a table from a spec's inline data so a chart can be re-typed. */
export function tableFromSpec(spec: VLSpec): TableData | null {
  const data = spec.data as { values?: Record<string, unknown>[] } | undefined;
  const values = data?.values;
  if (!Array.isArray(values) || values.length === 0) return null;
  const names = Object.keys(values[0]);
  const columns = names.map((name) => {
    const v = values.find((r) => r[name] !== null && r[name] !== undefined)?.[name];
    return { name, type: typeof v === 'number' ? 'real' : 'text' };
  });
  return { columns, rows: values.map((r) => names.map((n) => r[n])) };
}

function field(name: string): string {
  return name.replace(/([.[\]])/g, '\\$1');
}

interface Plan {
  x?: { name: string; role: Role };
  y?: { name: string };
  y2?: { name: string };
  color?: { name: string };
  categories: number;
}

function plan(table: TableData): Plan {
  const cols = table.columns.map((c, i) => ({ name: c.name, role: columnRole(c, table.rows, i), i }));
  const temporal = cols.filter((c) => c.role === 'temporal');
  const quant = cols.filter((c) => c.role === 'quantitative');
  const nominal = cols.filter((c) => c.role === 'nominal');
  const x = temporal[0] ?? nominal[0];
  const color = temporal[0] ? nominal[0] : nominal[1];
  const categories = x ? new Set(table.rows.map((r) => r[x.i])).size : 0;
  return {
    x: x && { name: x.name, role: x.role },
    y: quant[0] && { name: quant[0].name },
    y2: quant[1] && { name: quant[1].name },
    color: color && { name: color.name },
    categories,
  };
}

/** Picks the most appropriate chart for a result set, or null when a chart wouldn't help. */
export function suggestChartType(table: TableData): ChartType | null {
  if (table.rows.length < 2) return null;
  const p = plan(table);
  if (!p.y) return null;
  if (!p.x) return p.y2 ? 'scatter' : null;
  if (p.x.role === 'temporal') return 'line';
  return 'bar';
}

export function buildChartSpec(table: TableData, type?: ChartType, title?: string): VLSpec | null {
  const chartType = type ?? suggestChartType(table);
  if (!chartType) return null;
  const p = plan(table);
  if (!p.y) return null;
  const values = tableToValues(table);
  const base: VLSpec = {
    $schema: VL_SCHEMA,
    ...(title ? { title } : {}),
    data: { values },
    width: 'container',
    height: 300,
  };
  const y = p.y.name;

  if (chartType === 'scatter') {
    const xq = p.y2 ? p.y2.name : p.x?.name;
    if (!xq) return null;
    return {
      ...base,
      mark: { type: 'point', filled: true, tooltip: true },
      encoding: {
        x: { field: field(xq), type: p.y2 ? 'quantitative' : 'nominal' },
        y: { field: field(y), type: 'quantitative' },
        ...(p.color || (p.y2 && p.x) ? { color: { field: field((p.color ?? p.x)!.name), type: 'nominal' } } : {}),
      },
    };
  }

  if (!p.x) return null;
  const xType = p.x.role === 'temporal' ? 'temporal' : 'nominal';

  if (chartType === 'pie') {
    return {
      ...base,
      mark: { type: 'arc', innerRadius: 50, tooltip: true },
      encoding: {
        theta: { field: field(y), type: 'quantitative', aggregate: 'sum' },
        color: { field: field(p.x.name), type: 'nominal' },
      },
    };
  }

  if (chartType === 'bar' && xType === 'nominal' && p.categories > 8) {
    // Many categories: horizontal, sorted, which keeps labels readable.
    return {
      ...base,
      height: { step: 18 },
      mark: { type: 'bar', tooltip: true },
      encoding: {
        y: { field: field(p.x.name), type: 'nominal', sort: '-x', title: p.x.name },
        x: { field: field(y), type: 'quantitative', aggregate: 'sum', title: y },
        ...(p.color ? { color: { field: field(p.color.name), type: 'nominal' } } : {}),
      },
    };
  }

  const mark =
    chartType === 'line'
      ? { type: 'line', point: true, tooltip: true }
      : chartType === 'area'
        ? { type: 'area', line: true, opacity: 0.12, tooltip: true }
        : { type: 'bar', tooltip: true };

  return {
    ...base,
    mark,
    encoding: {
      x: { field: field(p.x.name), type: xType, title: p.x.name, ...(xType === 'nominal' ? { sort: null } : {}) },
      y: { field: field(y), type: 'quantitative', aggregate: 'sum', title: y },
      ...(p.color ? { color: { field: field(p.color.name), type: 'nominal' } } : {}),
    },
  };
}

/** Returns the chart type a spec currently uses, for the type toggle. */
export function specChartType(spec: VLSpec): ChartType | null {
  const mark = spec.mark as string | { type?: string } | undefined;
  const m = typeof mark === 'string' ? mark : mark?.type;
  switch (m) {
    case 'bar':
      return 'bar';
    case 'line':
      return 'line';
    case 'area':
      return 'area';
    case 'arc':
      return 'pie';
    case 'point':
    case 'circle':
      return 'scatter';
    default:
      return null;
  }
}

export function retypeSpec(spec: VLSpec, type: ChartType): VLSpec {
  const table = tableFromSpec(spec);
  const rebuilt = table && buildChartSpec(table, type, typeof spec.title === 'string' ? spec.title : undefined);
  return rebuilt ?? spec;
}

/** Makes a Cortex or LLM-produced spec responsive and self-describing. */
export function normalizeSpec(spec: VLSpec): VLSpec {
  const out: VLSpec = { ...spec };
  out.$schema ??= VL_SCHEMA;
  if (out.width === undefined || typeof out.width === 'number') out.width = 'container';
  out.height ??= 300;
  out.autosize ??= { type: 'fit', contains: 'padding' };
  return out;
}

/** Swaps fresh rows into a saved spec when refreshing an artifact. */
export function withTableData(spec: VLSpec, table: TableData): VLSpec {
  const data = spec.data as { values?: unknown[] } | undefined;
  if (data && Array.isArray(data.values)) return { ...spec, data: { values: tableToValues(table) } };
  return buildChartSpec(table, specChartType(spec) ?? undefined, spec.title as string | undefined) ?? spec;
}
