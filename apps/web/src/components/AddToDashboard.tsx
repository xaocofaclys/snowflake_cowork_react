'use client';

import { useQueryClient } from '@tanstack/react-query';
import { LayoutDashboard, Plus } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import type { Dashboard } from '@cowork/shared';
import { api } from '@/lib/api';
import { useDashboards } from '@/lib/hooks';
import { Button, Modal, inputCls } from './ui';

export function AddToDashboard({ artifactId, onClose }: { artifactId: string; onClose: () => void }) {
  const { data: dashboards = [] } = useDashboards();
  const [title, setTitle] = useState('');
  const [done, setDone] = useState<Dashboard>();
  const [error, setError] = useState<string>();
  const qc = useQueryClient();

  const finish = (d: Dashboard) => {
    qc.invalidateQueries({ queryKey: ['dashboards'] });
    qc.invalidateQueries({ queryKey: ['dashboard', d.id] });
    setDone(d);
  };

  return (
    <Modal open onClose={onClose} title="Add to dashboard">
      {done ? (
        <div className="space-y-3 text-sm">
          <p>Added to “{done.title}”.</p>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={onClose}>
              Close
            </Button>
            <Link href={`/dashboards/${done.id}`}>
              <Button variant="primary">Open dashboard</Button>
            </Link>
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          {dashboards.length > 0 && (
            <div className="max-h-56 space-y-1 overflow-y-auto">
              {dashboards.map((d) => (
                <button
                  key={d.id}
                  onClick={async () => {
                    try {
                      finish(await api<Dashboard>(`/dashboards/${d.id}/items`, { method: 'POST', json: { artifactId } }));
                    } catch (e) {
                      setError((e as Error).message);
                    }
                  }}
                  className="flex w-full items-center gap-2 rounded-lg border border-line px-3 py-2 text-left text-sm hover:bg-raised"
                >
                  <LayoutDashboard className="h-4 w-4 text-ink-3" />
                  <span className="flex-1 truncate">{d.title}</span>
                  <span className="text-xs text-ink-3">{d.items.length} tiles</span>
                </button>
              ))}
            </div>
          )}
          <form
            className="flex gap-2"
            onSubmit={async (e) => {
              e.preventDefault();
              try {
                finish(await api<Dashboard>('/dashboards', { method: 'POST', json: { title: title || 'Untitled dashboard', artifactIds: [artifactId] } }));
              } catch (err) {
                setError((err as Error).message);
              }
            }}
          >
            <input className={inputCls} placeholder="New dashboard name" value={title} onChange={(e) => setTitle(e.target.value)} />
            <Button type="submit">
              <Plus className="h-4 w-4" /> Create
            </Button>
          </form>
          {error && <p className="text-xs text-danger">{error}</p>}
        </div>
      )}
    </Modal>
  );
}
