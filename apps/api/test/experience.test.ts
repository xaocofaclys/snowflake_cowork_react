import { describe, expect, it } from 'vitest';
import { computeInsights, formatCompact, formatKpi, shapeFollowUps, type TableData } from '@cowork/shared';
import { SettingsService } from '../src/auth/settings.service';

const monthly: TableData = {
  columns: [{ name: 'ORDER_MONTH', type: 'date' }, { name: 'REVENUE', type: 'fixed' }],
  rows: [['1997-01-01', 100], ['1997-02-01', 150], ['1997-03-01', 120]],
};
const regions: TableData = {
  columns: [{ name: 'REGION', type: 'text' }, { name: 'REVENUE', type: 'fixed' }],
  rows: [['ASIA', 50], ['EUROPE', 30], ['AMERICA', 20]],
};

describe('number formats', () => {
  it('formats compact numbers in international and Indian systems', () => {
    expect(formatCompact(2_600_000_000)).toBe('2.6B');
    expect(formatCompact(260_000_000, { numberFormat: 'indian' })).toBe('26 Cr');
    expect(formatCompact(4_500_000, { numberFormat: 'indian' })).toBe('45 L');
    expect(formatCompact(1234, { numberFormat: 'indian' })).toBe('1,234');
    expect(formatKpi(3_100_000_000, 'currency', { currency: 'INR', numberFormat: 'indian' })).toBe('₹310 Cr');
  });
});

describe('insights', () => {
  it('summarises a time series: latest change, peak, overall change', () => {
    const i = computeInsights(monthly);
    expect(i[0]).toMatchObject({ kind: 'down', text: 'Latest revenue 120, -20% vs previous period' });
    expect(i[1].text).toBe('Peak 150 in Feb 1997');
    expect(i[2]).toMatchObject({ kind: 'up', text: '+20% over the period shown' });
  });
  it('summarises categories: leader with share, laggard vs average', () => {
    const i = computeInsights(regions);
    expect(i[0].text).toBe('ASIA leads with 50 (50% of total)');
    expect(i[1].text).toBe('AMERICA is lowest, 40% below average');
  });
  it('suggests shape-based follow-ups when no model is available', () => {
    const f = shapeFollowUps('Revenue by region?', regions);
    expect(f[0]).toBe('Revenue by region, as a monthly trend');
    expect(f).toHaveLength(3);
  });
});

describe('SettingsService', () => {
  it('saving one setting keeps the others (default agent no longer wiped)', async () => {
    const docs = new Map<string, any>();
    const store = {
      get: async (_c: string, id: string) => docs.get(id) ?? null,
      insert: async (_c: string, d: any) => (docs.set(d.id, d), d),
      put: async (_c: string, d: any) => (docs.set(d.id, d), d),
    };
    const svc = new SettingsService(store as never);
    await svc.update('u', { defaultAgentId: 'DB.S.NBA', numberFormat: 'indian' });
    const after = await svc.update('u', { autoChart: false, defaultAgentId: undefined } as never);
    expect(after.numberFormat).toBe('indian');
    expect(after.autoChart).toBe(false);
    const pins = await svc.update('u', { pins: [{ kind: 'dashboard', id: 'd1', title: 'Sales' }, { kind: 'bogus', id: 'x' } as never] });
    expect(pins.pins).toEqual([{ kind: 'dashboard', id: 'd1', title: 'Sales' }]);
  });
});
