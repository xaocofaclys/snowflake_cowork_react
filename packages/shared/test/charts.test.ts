import { describe, expect, it } from 'vitest';
import { buildChartSpec, retypeSpec, specChartType, suggestChartType, tableFromSpec, withTableData } from '../src/charts';

const monthly = {
  columns: [
    { name: 'ORDER_MONTH', type: 'date' },
    { name: 'REVENUE', type: 'fixed' },
  ],
  rows: [
    ['1997-01-01', 100],
    ['1997-02-01', 120],
    ['1997-03-01', 90],
  ],
};
const byRegion = {
  columns: [
    { name: 'REGION', type: 'text' },
    { name: 'REVENUE', type: 'fixed' },
  ],
  rows: [
    ['ASIA', 10],
    ['EUROPE', 20],
  ],
};

describe('chart heuristics', () => {
  it('uses a line for time series', () => {
    expect(suggestChartType(monthly)).toBe('line');
    const spec = buildChartSpec(monthly)!;
    expect((spec.encoding as any).x.type).toBe('temporal');
  });

  it('uses a bar for categories', () => {
    expect(suggestChartType(byRegion)).toBe('bar');
  });

  it('treats ID-like integers as categories, not measures', () => {
    const t = { columns: [{ name: 'CUSTOMER_ID', type: 'fixed' }, { name: 'SPEND', type: 'real' }], rows: [[1, 5], [2, 6]] };
    expect(suggestChartType(t)).toBe('bar');
  });

  it('declines to chart single rows or tables without measures', () => {
    expect(suggestChartType({ ...byRegion, rows: [['ASIA', 1]] })).toBeNull();
    expect(suggestChartType({ columns: [{ name: 'A', type: 'text' }, { name: 'B', type: 'text' }], rows: [['x', 'y'], ['z', 'w']] })).toBeNull();
  });

  it('goes horizontal when there are many categories', () => {
    const many = { columns: byRegion.columns, rows: Array.from({ length: 20 }, (_, i) => [`N${i}`, i]) };
    const spec = buildChartSpec(many)!;
    expect((spec.encoding as any).y.type).toBe('nominal');
  });

  it('round-trips data through a spec so charts can be re-typed', () => {
    const spec = buildChartSpec(byRegion)!;
    expect(tableFromSpec(spec)?.rows).toHaveLength(2);
    expect(specChartType(retypeSpec(spec, 'pie'))).toBe('pie');
  });

  it('swaps fresh rows into a saved spec', () => {
    const spec = buildChartSpec(byRegion)!;
    const next = withTableData(spec, { ...byRegion, rows: [['ASIA', 99]] });
    expect((next.data as any).values).toEqual([{ REGION: 'ASIA', REVENUE: 99 }]);
  });
});
