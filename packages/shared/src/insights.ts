import { columnRole } from './charts';
import type { TableData } from './events';

export type NumberFormat = 'international' | 'indian';
export type Currency = 'USD' | 'INR' | 'EUR' | 'GBP';

const SYMBOL: Record<Currency, string> = { USD: '$', INR: '₹', EUR: '€', GBP: '£' };

/** Compact number in the user's preferred system: 2.6B / 26.0 Cr, 45.2K / 45.2K, 3.1M / 31.0 L. */
export function formatCompact(v: number, opts: { numberFormat?: NumberFormat; currency?: Currency } = {}): string {
  if (!Number.isFinite(v)) return '—';
  const abs = Math.abs(v);
  const sym = opts.currency ? SYMBOL[opts.currency] : '';
  const fix = (n: number) => (Math.abs(n) >= 100 ? n.toFixed(0) : n.toFixed(1)).replace(/\.0$/, '');
  let s: string;
  if (opts.numberFormat === 'indian') {
    s = abs >= 1e7 ? `${fix(v / 1e7)} Cr` : abs >= 1e5 ? `${fix(v / 1e5)} L` : abs >= 1e4 ? `${fix(v / 1e3)}K` : v.toLocaleString('en-IN', { maximumFractionDigits: abs < 10 ? 2 : 0 });
  } else {
    s = abs >= 1e9 ? `${fix(v / 1e9)}B` : abs >= 1e6 ? `${fix(v / 1e6)}M` : abs >= 1e4 ? `${fix(v / 1e3)}K` : v.toLocaleString('en-US', { maximumFractionDigits: abs < 10 ? 2 : 0 });
  }
  return `${v < 0 && sym ? '-' : ''}${sym}${sym ? s.replace(/^-/, '') : s}`;
}

export interface Insight {
  kind: 'up' | 'down' | 'flat' | 'peak' | 'top' | 'low' | 'share' | 'total';
  text: string;
}

const pct = (x: number) => `${x >= 0 ? '+' : ''}${(x * 100).toFixed(Math.abs(x) < 0.1 ? 1 : 0)}%`;

/**
 * Deterministic highlights for a result table, independent of which agent produced it:
 * trend and peak for time series; leader, laggard and concentration for categories.
 */
export function computeInsights(table: TableData, opts: { numberFormat?: NumberFormat } = {}): Insight[] {
  if (table.rows.length < 2) return [];
  const roles = table.columns.map((c, i) => columnRole(c, table.rows, i));
  const yi = roles.indexOf('quantitative');
  if (yi < 0) return [];
  const y = table.columns[yi].name.replace(/_/g, ' ').toLowerCase();
  const ti = roles.indexOf('temporal');
  const ni = roles.findIndex((r, i) => r === 'nominal' && i !== yi);
  const fmt = (v: number) => formatCompact(v, opts);
  const out: Insight[] = [];

  if (ti >= 0) {
    // Sum per period (rows may be split by other dimensions), in time order.
    const byT = new Map<string, number>();
    for (const r of table.rows) {
      const v = Number(r[yi]);
      if (!Number.isFinite(v)) continue;
      const t = String(r[ti]).slice(0, 10);
      byT.set(t, (byT.get(t) ?? 0) + v);
    }
    const series = [...byT.entries()].sort(([a], [b]) => a.localeCompare(b));
    if (series.length >= 2) {
      const [, first] = series[0];
      const [, last] = series[series.length - 1];
      const [, prev] = series[series.length - 2];
      const change = prev ? (last - prev) / Math.abs(prev) : 0;
      out.push({
        kind: Math.abs(change) < 0.005 ? 'flat' : change > 0 ? 'up' : 'down',
        text: `Latest ${y} ${fmt(last)}, ${pct(change)} vs previous period`,
      });
      const peak = series.reduce((m, s) => (s[1] > m[1] ? s : m));
      out.push({ kind: 'peak', text: `Peak ${fmt(peak[1])} in ${label(peak[0])}` });
      if (series.length > 2 && first) out.push({ kind: last >= first ? 'up' : 'down', text: `${pct((last - first) / Math.abs(first))} over the period shown` });
    }
    return out.slice(0, 3);
  }

  if (ni >= 0) {
    const byCat = new Map<string, number>();
    for (const r of table.rows) {
      const v = Number(r[yi]);
      if (!Number.isFinite(v)) continue;
      const k = String(r[ni]);
      byCat.set(k, (byCat.get(k) ?? 0) + v);
    }
    const cats = [...byCat.entries()].sort((a, b) => b[1] - a[1]);
    if (cats.length >= 2) {
      const total = cats.reduce((s, c) => s + c[1], 0);
      const avg = total / cats.length;
      const [topK, topV] = cats[0];
      const [lowK, lowV] = cats[cats.length - 1];
      out.push({ kind: 'top', text: `${topK} leads with ${fmt(topV)}${total > 0 ? ` (${Math.round((topV / total) * 100)}% of total)` : ''}` });
      if (avg) out.push({ kind: 'low', text: `${lowK} is lowest, ${Math.round(Math.abs((lowV - avg) / avg) * 100)}% below average` });
      if (cats.length >= 5 && total > 0) {
        const top3 = cats.slice(0, 3).reduce((s, c) => s + c[1], 0) / total;
        out.push({ kind: 'share', text: `Top 3 make up ${Math.round(top3 * 100)}% of ${y}` });
      } else out.push({ kind: 'total', text: `Total ${fmt(total)} across ${cats.length} ${cats.length === 1 ? 'item' : 'items'}` });
    }
  }
  return out.slice(0, 3);
}

function label(t: string): string {
  const d = new Date(`${t.slice(0, 10)}T00:00:00Z`);
  return Number.isNaN(d.getTime()) ? t : d.toLocaleDateString('en-GB', { month: 'short', year: 'numeric', timeZone: 'UTC' });
}

/**
 * Follow-up suggestions from a result's shape (used when no LLM is available): drill into
 * the time dimension or a breakdown the result doesn't have yet.
 */
export function shapeFollowUps(question: string, table?: TableData): string[] {
  const q = question.replace(/[?.!]+$/, '');
  const out: string[] = [];
  if (table && table.rows.length) {
    const roles = table.columns.map((c, i) => columnRole(c, table.rows, i));
    const hasTime = roles.includes('temporal');
    const nominal = table.columns.find((_, i) => roles[i] === 'nominal');
    if (!hasTime) out.push(`${q}, as a monthly trend`);
    if (nominal) out.push(`Which ${nominal.name.replace(/_/g, ' ').toLowerCase()} changed the most recently?`);
    if (!hasTime && nominal && table.rows.length > 10) out.push(`${q}: top 10 only`);
  }
  out.push(`${q}, compared with the same period last year`);
  out.push(`What's driving this?`);
  return [...new Set(out)].slice(0, 3);
}
