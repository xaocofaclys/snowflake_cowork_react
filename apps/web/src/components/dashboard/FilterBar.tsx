'use client';

import { CalendarRange, Filter, X } from 'lucide-react';
import { filterValues, type ActiveFilters, type Artifact, type DashboardFilter } from '@cowork/shared';
import { datePresets, dateBounds, type CrossFilter } from '@/lib/dashboard-filters';

const selectCls = 'h-8 rounded-lg border border-line bg-bg px-2 text-xs text-ink outline-none focus:border-accent';

/** Slicers across the top of a dashboard: date presets, dimension dropdowns and cross-filter chips. */
export function FilterBar({
  filters,
  artifacts,
  active,
  cross,
  onChange,
  onClearCross,
}: {
  filters: DashboardFilter[];
  artifacts: Artifact[];
  active: ActiveFilters;
  cross: CrossFilter[];
  onChange: (next: ActiveFilters) => void;
  onClearCross: (column?: string) => void;
}) {
  if (!filters.length && !cross.length) return null;
  const set = (key: string, v: ActiveFilters[string] | undefined) => {
    const next = { ...active };
    if (v) next[key] = v;
    else delete next[key];
    onChange(next);
  };
  const tiles = artifacts.map((a) => ({ table: a.table, tile: a.tile }));
  const anyActive = Object.keys(active).length > 0 || cross.length > 0;

  return (
    <div className="no-print flex flex-wrap items-center gap-2 rounded-xl border border-line bg-panel px-3 py-2">
      <Filter className="h-3.5 w-3.5 text-ink-3" />
      {filters.map((f) => {
        if (f.kind === 'date') {
          const { max } = dateBounds(artifacts, f.key);
          const presets = datePresets(max);
          const cur = active[f.key];
          const curFrom = cur && 'from' in cur ? cur.from : undefined;
          return (
            <label key={f.key} className="flex items-center gap-1.5 text-xs text-ink-2">
              <CalendarRange className="h-3.5 w-3.5 text-ink-3" />
              <select className={selectCls} value={curFrom ?? ''} onChange={(e) => set(f.key, e.target.value ? { from: e.target.value } : undefined)} aria-label={f.label}>
                {presets.map((p) => (
                  <option key={p.label} value={p.from ?? ''}>
                    {p.label}
                  </option>
                ))}
              </select>
            </label>
          );
        }
        const values = filterValues(tiles, f.key);
        const cur = active[f.key];
        return (
          <label key={f.key} className="flex items-center gap-1.5 text-xs text-ink-2">
            {f.label}
            <select className={selectCls} value={cur && 'value' in cur ? cur.value : ''} onChange={(e) => set(f.key, e.target.value ? { value: e.target.value } : undefined)}>
              <option value="">All</option>
              {values.map((v) => (
                <option key={v} value={v}>
                  {v}
                </option>
              ))}
            </select>
          </label>
        );
      })}
      {cross.map((c) => (
        <span key={c.column} className="inline-flex h-7 items-center gap-1 rounded-full bg-accent-soft pl-2.5 pr-1 text-xs text-accent">
          {c.label}: <strong className="font-semibold">{c.value}</strong>
          <button aria-label={`Clear ${c.label} filter`} onClick={() => onClearCross(c.column)} className="rounded-full p-0.5 hover:bg-accent/10">
            <X className="h-3 w-3" />
          </button>
        </span>
      ))}
      {anyActive && (
        <button
          onClick={() => {
            onChange({});
            onClearCross();
          }}
          className="ml-auto text-xs text-ink-3 hover:text-ink"
        >
          Clear all
        </button>
      )}
    </div>
  );
}
