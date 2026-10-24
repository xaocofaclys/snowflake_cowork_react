'use client';

import { ArrowDown, ArrowUp, Download } from 'lucide-react';
import { useMemo, useState } from 'react';
import type { TableData } from '@cowork/shared';
import { IconButton } from './ui';

const PAGE = 50;
const isNum = (t: string) => /fixed|real|number|float|int|decimal/.test(t);

export function formatCell(v: unknown, type: string): string {
  if (v === null || v === undefined) return '—';
  if (typeof v === 'number' && isNum(type)) {
    return Number.isInteger(v) ? v.toLocaleString() : v.toLocaleString(undefined, { maximumFractionDigits: 2 });
  }
  return String(v);
}

export function toCsv(t: TableData): string {
  const esc = (v: unknown) => {
    const s = v === null || v === undefined ? '' : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [t.columns.map((c) => esc(c.name)).join(','), ...t.rows.map((r) => r.map(esc).join(','))].join('\n');
}

export function download(name: string, href: string) {
  const a = document.createElement('a');
  a.href = href;
  a.download = name;
  a.click();
}

export function DataTable({ table, maxHeight = 360 }: { table: TableData; maxHeight?: number }) {
  const [sort, setSort] = useState<{ i: number; dir: 1 | -1 } | null>(null);
  const [page, setPage] = useState(0);

  const rows = useMemo(() => {
    if (!sort) return table.rows;
    return [...table.rows].sort((a, b) => {
      const x = a[sort.i], y = b[sort.i];
      if (x === y) return 0;
      if (x === null || x === undefined) return 1;
      if (y === null || y === undefined) return -1;
      return (typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y))) * sort.dir;
    });
  }, [table.rows, sort]);

  const pages = Math.max(1, Math.ceil(rows.length / PAGE));
  const view = rows.slice(page * PAGE, page * PAGE + PAGE);

  return (
    <div>
      <div className="overflow-auto rounded-lg border border-line" style={{ maxHeight }}>
        <table className="w-full border-collapse text-[13px]">
          <thead className="sticky top-0 bg-sidebar">
            <tr>
              {table.columns.map((c, i) => (
                <th
                  key={c.name}
                  onClick={() => setSort((s) => (s?.i === i ? (s.dir === 1 ? { i, dir: -1 } : null) : { i, dir: 1 }))}
                  className={`cursor-pointer select-none whitespace-nowrap border-b border-line px-3 py-2 font-medium text-ink-2 hover:text-ink ${isNum(c.type) ? 'text-right' : 'text-left'}`}
                >
                  <span className="inline-flex items-center gap-1">
                    {c.name}
                    {sort?.i === i && (sort.dir === 1 ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />)}
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {view.map((r, ri) => (
              <tr key={ri} className="border-b border-line last:border-0 hover:bg-panel">
                {r.map((v, i) => (
                  <td key={i} className={`whitespace-nowrap px-3 py-1.5 ${isNum(table.columns[i]?.type ?? '') ? 'text-right tabular-nums' : ''}`}>
                    {formatCell(v, table.columns[i]?.type ?? '')}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="mt-1.5 flex items-center justify-between text-xs text-ink-3">
        <span>
          {table.rows.length.toLocaleString()} row{table.rows.length === 1 ? '' : 's'}
        </span>
        <div className="flex items-center gap-2">
          {pages > 1 && (
            <>
              <button disabled={page === 0} onClick={() => setPage((p) => p - 1)} className="hover:text-ink disabled:opacity-40">
                Prev
              </button>
              <span>
                {page + 1}/{pages}
              </span>
              <button disabled={page >= pages - 1} onClick={() => setPage((p) => p + 1)} className="hover:text-ink disabled:opacity-40">
                Next
              </button>
            </>
          )}
          <IconButton
            label="Download CSV"
            onClick={() => download('results.csv', URL.createObjectURL(new Blob([toCsv(table)], { type: 'text/csv' })))}
          >
            <Download className="h-3.5 w-3.5" />
          </IconButton>
        </div>
      </div>
    </div>
  );
}
