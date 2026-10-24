'use client';

import { BarChart3, Bookmark, FileText, Table2 } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { PageHeader } from '@/components/PageHeader';
import { Spinner, inputCls } from '@/components/ui';
import { VegaChart } from '@/components/VegaChart';
import { useArtifacts } from '@/lib/hooks';

const ICON = { chart: BarChart3, table: Table2, answer: FileText };

export default function ArtifactsPage() {
  const { data = [], isLoading } = useArtifacts();
  const [q, setQ] = useState('');
  const items = data.filter((a) => a.title.toLowerCase().includes(q.toLowerCase()));

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-6xl px-6 py-8">
        <PageHeader title="Artifacts" subtitle="Saved charts and tables. Open one to refresh it with live data or share it.">
          <div className="w-64">
            <input className={inputCls} placeholder="Search artifacts" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
        </PageHeader>
        {isLoading && <Spinner className="mx-auto mt-10" />}
        {!isLoading && !items.length && (
          <div className="mt-16 flex flex-col items-center gap-2 text-center text-ink-3">
            <Bookmark className="h-8 w-8" />
            <p className="text-sm">No artifacts yet. Use the bookmark icon on any chart or table in a chat to save it.</p>
          </div>
        )}
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {items.map((a) => {
            const Icon = ICON[a.type];
            return (
              <Link key={a.id} href={`/artifacts/${a.id}`} className="group overflow-hidden rounded-xl border border-line bg-panel hover:border-ink-3">
                <div className="pointer-events-none h-44 overflow-hidden border-b border-line bg-bg p-2">
                  {a.type === 'chart' && a.spec ? (
                    <VegaChart spec={{ ...a.spec, title: undefined }} height={140} />
                  ) : (
                    <div className="flex h-full items-center justify-center text-ink-3">
                      <Icon className="h-8 w-8" />
                    </div>
                  )}
                </div>
                <div className="p-3">
                  <div className="flex items-center gap-1.5 text-sm font-medium">
                    <Icon className="h-3.5 w-3.5 text-ink-3" />
                    <span className="truncate">{a.title}</span>
                  </div>
                  <div className="mt-0.5 text-xs text-ink-3">
                    Updated {new Date(a.refreshedAt ?? a.updatedAt).toLocaleString()}
                  </div>
                </div>
              </Link>
            );
          })}
        </div>
      </div>
    </div>
  );
}
