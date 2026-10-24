import { describe, expect, it } from 'vitest';
import {
  applyFilters,
  buildTileSpec,
  computeKpi,
  filterValues,
  layoutTiles,
  resolveTile,
  type Dashboard,
  type DashboardFilter,
  type StreamEvent,
  type TableData,
} from '@cowork/shared';
import { DashboardBuilderService } from '../src/dashboards/dashboard-builder.service';

const monthly: TableData = {
  columns: [
    { name: 'ORDER_MONTH', type: 'date' },
    { name: 'REGION', type: 'text' },
    { name: 'REVENUE', type: 'fixed' },
  ],
  rows: [
    ['1997-01-01', 'ASIA', 10],
    ['1997-01-01', 'EUROPE', 20],
    ['1997-02-01', 'ASIA', 15],
    ['1997-02-01', 'EUROPE', 25],
    ['1997-03-01', 'ASIA', 30],
    ['1997-03-01', 'EUROPE', 30],
  ],
};
const filters: DashboardFilter[] = [
  { key: 'date', label: 'Date', kind: 'date', hints: ['month'] },
  { key: 'region', label: 'Region', kind: 'dimension', hints: ['region'] },
];

describe('dashboard tiles', () => {
  it('resolves roles and filter columns from hints', () => {
    const t = resolveTile({ id: 't', kind: 'chart', title: 'By region', question: 'q', agentId: 'a', chart: 'bar', x: 'region', y: 'revenue' }, monthly, filters);
    expect(t).toMatchObject({ x: 'REGION', y: 'REVENUE', time: 'ORDER_MONTH', filterColumns: { date: 'ORDER_MONTH', region: 'REGION' } });
  });

  it('filters rows by dimension and date range, ignoring filters a tile lacks', () => {
    const t = resolveTile({ id: 't', kind: 'chart', title: 'x', question: 'q', agentId: 'a', chart: 'line', x: 'month', y: 'revenue' }, monthly, filters);
    expect(applyFilters(monthly, t, { region: { value: 'ASIA' } }).rows).toHaveLength(3);
    expect(applyFilters(monthly, t, { date: { from: '1997-02-01' } }).rows).toHaveLength(4);
    expect(applyFilters(monthly, { ...t, filterColumns: {} }, { region: { value: 'ASIA' } }).rows).toHaveLength(6);
    expect(filterValues([{ table: monthly, tile: t }], 'region')).toEqual(['ASIA', 'EUROPE']);
  });

  it('computes KPIs: latest period vs previous, and a date range vs the window before it', () => {
    const t = resolveTile({ id: 'k', kind: 'kpi', title: 'Revenue', question: 'q', agentId: 'a', y: 'revenue', aggregate: 'sum' }, monthly, filters);
    const latest = computeKpi(monthly, t);
    expect(latest).toMatchObject({ value: 60, previous: 40 });
    expect(latest.delta).toBeCloseTo(0.5);
    expect(latest.series.map((s) => s.v)).toEqual([30, 40, 60]);
    const ranged = computeKpi(monthly, t, { from: '1997-02-01', to: '1997-03-31' });
    expect(ranged).toMatchObject({ value: 100, previous: 30 });
  });

  it('builds aggregated chart specs that re-aggregate filtered rows', () => {
    const t = resolveTile({ id: 't', kind: 'chart', title: 'x', question: 'q', agentId: 'a', chart: 'bar', x: 'region', y: 'revenue' }, monthly, filters);
    const spec = buildTileSpec(monthly, t) as any;
    expect(spec.encoding.y).toMatchObject({ field: 'REVENUE', aggregate: 'sum' });
    expect(spec.transform.some((tr: any) => tr.filter)).toBe(true);
  });

  it('lays out a KPI row then charts two per row', () => {
    const l = layoutTiles([
      { id: 'k1', kind: 'kpi' },
      { id: 'k2', kind: 'kpi' },
      { id: 'k3', kind: 'kpi' },
      { id: 'c1', kind: 'chart', width: 'full' },
      { id: 'c2', kind: 'chart' },
      { id: 'c3', kind: 'chart' },
    ]);
    expect(l.slice(0, 3).map((x) => [x.x, x.y, x.w])).toEqual([[0, 0, 4], [4, 0, 4], [8, 0, 4]]);
    expect(l[3]).toMatchObject({ x: 0, y: 4, w: 12 });
    expect(l[4]).toMatchObject({ x: 0, y: 13, w: 6 });
    expect(l[5]).toMatchObject({ x: 6, y: 13, w: 6 });
  });
});

describe('DashboardBuilderService', () => {
  function setup() {
    const docs = new Map<string, any>();
    const store = {
      insert: async (_c: string, d: any) => (docs.set(d.id, d), d),
      get: async (_c: string, id: string) => docs.get(id) ?? null,
      patch: async (_c: string, id: string, p: any) => (docs.set(id, { ...docs.get(id), ...p }), docs.get(id)),
      delete: async (_c: string, id: string) => void docs.delete(id),
    };
    let n = 0;
    const artifacts = { createFor: async (_u: string, a: any) => store.insert('ARTIFACTS', { id: `art_${++n}`, userId: 'u', ...a }) };
    const cortex = {
      listAgents: async () => [{ id: 'DB.S.SALES', displayName: 'Sales', sampleQuestions: [], kind: 'agent' }],
      async *run(): AsyncGenerator<StreamEvent> {
        yield { type: 'table', index: 0, toolUseId: 't', table: { ...monthly, columns: [...monthly.columns, { name: 'ORDERS', type: 'fixed' }], rows: monthly.rows.map((r) => [...r, 5]) } };
      },
    };
    const svc = new DashboardBuilderService(cortex as never, { completeJson: async () => null } as never, artifacts as never, store as never);
    return { svc, docs };
  }

  it('detects build and edit requests', () => {
    expect(DashboardBuilderService.looksLikeBuild('Build a dashboard for rep performance')).toBe(true);
    expect(DashboardBuilderService.looksLikeBuild('I want a dashboard to report HCP metrics')).toBe(true);
    expect(DashboardBuilderService.looksLikeBuild('Show monthly revenue for 1997')).toBe(false);
    expect(DashboardBuilderService.looksLikeEdit('make the trend a bar chart')).toBe(true);
  });

  it('builds a filterable dashboard offline and edits it with rules', async () => {
    const { svc, docs } = setup();
    const events: StreamEvent[] = [];
    const d = await svc.build({ userId: 'u', request: 'Build a dashboard for sales performance', agentId: 'auto', emit: (e) => events.push(e) });
    expect(d.items).toHaveLength(6);
    expect(d.filters?.map((f) => f.key)).toEqual(['date', 'region']);
    expect(events.filter((e) => e.type === 'node_start')).toHaveLength(6);
    expect(events.find((e) => e.type === 'artifact')).toMatchObject({ kind: 'dashboard', artifactId: d.id });

    const emit = () => undefined;
    await svc.edit({ userId: 'u', request: 'make the monthly trend a bar chart', agentId: 'auto', emit, dashboardId: d.id });
    const trend = [...docs.values()].find((x) => x.title === 'Monthly trend');
    expect(trend.design.chart).toBe('bar');

    const after = (await svc.edit({ userId: 'u', request: 'remove the share by region chart', agentId: 'auto', emit, dashboardId: d.id })) as Dashboard;
    expect(after.items).toHaveLength(5);

    const added = (await svc.edit({ userId: 'u', request: 'add a chart of orders by region', agentId: 'auto', emit, dashboardId: d.id })) as Dashboard;
    expect(added.items).toHaveLength(6);
  });
});
