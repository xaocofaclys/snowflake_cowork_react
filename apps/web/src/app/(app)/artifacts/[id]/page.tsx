'use client';

import { useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, CalendarPlus, Database, FileDown, LayoutDashboard, MessageSquare, Pin, PinOff, Presentation, RefreshCw, Share2, Trash2 } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { use, useState } from 'react';
import { AUTO_AGENT_ID, type Artifact } from '@cowork/shared';
import { AddToDashboard } from '@/components/AddToDashboard';
import { KpiCard } from '@/components/dashboard/Tiles';
import { AutomationEditor } from '@/components/AutomationEditor';
import { DataTable } from '@/components/DataTable';
import { AssistantMessage } from '@/components/Message';
import { ReportView } from '@/components/ReportView';
import { Markdown } from '@/components/Markdown';
import { Button, Modal, Spinner, inputCls } from '@/components/ui';
import { VegaChart } from '@/components/VegaChart';
import { api } from '@/lib/api';
import { exportArtifactPptx, exportPdf } from '@/lib/export';
import { useAgents, useArtifact, useMe, useTogglePin } from '@/lib/hooks';

export default function ArtifactPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { data: a, isLoading, error } = useArtifact(id);
  const { data: me } = useMe();
  const qc = useQueryClient();
  const router = useRouter();
  const [refreshing, setRefreshing] = useState(false);
  const [refreshError, setRefreshError] = useState<string>();
  const [showSql, setShowSql] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [adding, setAdding] = useState(false);
  const [automating, setAutomating] = useState(false);
  const { data: agents = [] } = useAgents();
  const pins = useTogglePin();
  const [exporting, setExporting] = useState(false);

  if (isLoading) return <Spinner className="mx-auto mt-20" />;
  if (error || !a) return <p className="p-8 text-sm text-danger">{(error as Error)?.message ?? 'Not found'}</p>;
  const owner = a.userId === me?.user.id;

  const refresh = async () => {
    setRefreshing(true);
    setRefreshError(undefined);
    try {
      const next = await api<Artifact>(`/artifacts/${id}/refresh?force=true`, { method: 'POST' });
      qc.setQueryData(['artifact', id], next);
      qc.invalidateQueries({ queryKey: ['artifacts'] });
    } catch (e) {
      setRefreshError((e as Error).message);
    } finally {
      setRefreshing(false);
    }
  };

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-5xl px-6 py-6">
        <Link href="/artifacts" className="no-print inline-flex items-center gap-1 text-xs text-ink-3 hover:text-ink">
          <ArrowLeft className="h-3.5 w-3.5" /> Artifacts
        </Link>
        <div className="mt-3 flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold">{a.title}</h1>
            {a.description && <p className="mt-1 text-sm text-ink-2">{a.description}</p>}
            <p className="mt-1 text-xs text-ink-3">
              Data as of {new Date(a.refreshedAt ?? a.updatedAt).toLocaleString()}
              {a.agentId && <> · {a.agentId}</>}
            </p>
          </div>
          <div className="no-print flex flex-wrap gap-2">
            {(a.sql || a.type === 'report') && (
              <Button onClick={refresh} disabled={refreshing}>
                <RefreshCw className={`h-3.5 w-3.5 ${refreshing ? 'animate-spin' : ''}`} /> Refresh
              </Button>
            )}
            {a.sql && (
              <Button variant="ghost" onClick={() => setShowSql(true)}>
                <Database className="h-3.5 w-3.5" /> SQL
              </Button>
            )}
            {(a.type === 'chart' || a.type === 'table') && owner && (
              <Button variant="ghost" onClick={() => setAdding(true)}>
                <LayoutDashboard className="h-3.5 w-3.5" /> Add to dashboard
              </Button>
            )}
            <Button variant="ghost" onClick={() => pins.toggle({ kind: 'artifact', id: a.id, title: a.title })} title={pins.isPinned(a.id) ? 'Unpin from Home' : 'Pin to Home'}>
              {pins.isPinned(a.id) ? <PinOff className="h-3.5 w-3.5" /> : <Pin className="h-3.5 w-3.5" />} {pins.isPinned(a.id) ? 'Unpin' : 'Pin'}
            </Button>
            {(a.type === 'report' || a.type === 'answer') && a.question && (
              <Button variant="ghost" onClick={() => setAutomating(true)}>
                <CalendarPlus className="h-3.5 w-3.5" /> Automate
              </Button>
            )}
            <Button variant="ghost" onClick={exportPdf} title="Opens the print dialog: choose Save as PDF">
              <FileDown className="h-3.5 w-3.5" /> PDF
            </Button>
            <Button
              variant="ghost"
              disabled={exporting}
              onClick={async () => {
                setExporting(true);
                try {
                  await exportArtifactPptx(a);
                } finally {
                  setExporting(false);
                }
              }}
            >
              <Presentation className="h-3.5 w-3.5" /> {exporting ? 'Building…' : 'PowerPoint'}
            </Button>
            {a.threadId && owner && (
              <Button variant="ghost" onClick={() => router.push(`/c/${a.threadId}`)}>
                <MessageSquare className="h-3.5 w-3.5" /> Chat
              </Button>
            )}
            {owner && (
              <Button variant="ghost" onClick={() => setSharing(true)}>
                <Share2 className="h-3.5 w-3.5" /> Share
              </Button>
            )}
            {owner && (
              <Button
                variant="ghost"
                onClick={async () => {
                  if (!confirm('Delete this artifact?')) return;
                  await api(`/artifacts/${id}`, { method: 'DELETE' });
                  qc.invalidateQueries({ queryKey: ['artifacts'] });
                  router.push('/artifacts');
                }}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            )}
          </div>
        </div>
        {refreshError && <p className="mt-3 text-sm text-danger">{refreshError}</p>}
        <div className="mt-5 space-y-5">
          {a.type === 'chart' && a.spec && (
            <div className="rounded-xl border border-line bg-panel p-4">
              <VegaChart spec={a.spec} height={420} />
            </div>
          )}
          {a.type === 'kpi' && (
            <div className="max-w-sm rounded-xl border border-line bg-panel">
              <KpiCard a={a} table={a.table} />
            </div>
          )}
          {a.type === 'report' && <ReportView artifact={a} />}
          {a.type === 'answer' && a.blocks && <AssistantMessage blocks={a.blocks} ctx={{ agentId: a.agentId, question: a.question }} />}
          {a.type === 'answer' && !a.blocks && a.text && <Markdown text={a.text} />}
          {(a.type === 'chart' || a.type === 'table' || a.type === 'kpi') && a.table && <DataTable table={a.table} maxHeight={480} />}
        </div>
      </div>
      <Modal open={showSql} onClose={() => setShowSql(false)} title="SQL" wide>
        <pre className="max-h-[60vh] overflow-auto rounded-lg bg-raised p-3 font-mono text-xs">{a.sql}</pre>
      </Modal>
      {sharing && <ShareDialog artifact={a} onClose={() => setSharing(false)} />}
      {adding && <AddToDashboard artifactId={a.id} onClose={() => setAdding(false)} />}
      {automating && (
        <AutomationEditor
          initial={{
            name: a.title.split(' · ')[0].slice(0, 80),
            prompt: a.question,
            target: { kind: a.type === 'report' ? 'research' : 'agent', agentId: a.agentId ?? AUTO_AGENT_ID },
            schedule: { cron: '0 9 * * 1', timezone: 'Asia/Kolkata' },
            enabled: true,
          }}
          agents={agents}
          onClose={() => setAutomating(false)}
          onSaved={() => setAutomating(false)}
        />
      )}
    </div>
  );
}

function ShareDialog({ artifact, onClose }: { artifact: Artifact; onClose: () => void }) {
  const [users, setUsers] = useState((artifact.sharedWith ?? []).filter((u) => u !== '*').join(', '));
  const [everyone, setEveryone] = useState(artifact.sharedWith?.includes('*') ?? false);
  const qc = useQueryClient();
  const link = typeof window !== 'undefined' ? `${location.origin}/artifacts/${artifact.id}` : '';
  return (
    <Modal open onClose={onClose} title="Share artifact">
      <div className="space-y-3 text-sm">
        <p className="text-xs text-ink-3">
          Viewers see live data under their own Snowflake role when they refresh, so access to the underlying tables still applies.
        </p>
        <label className="block text-xs font-medium text-ink-2">
          Snowflake usernames (comma-separated)
          <input className={`${inputCls} mt-1`} value={users} onChange={(e) => setUsers(e.target.value)} />
        </label>
        <label className="flex items-center gap-2 text-xs">
          <input type="checkbox" checked={everyone} onChange={(e) => setEveryone(e.target.checked)} /> Anyone signed in to this app
        </label>
        <div className="flex gap-2">
          <input readOnly className={inputCls} value={link} />
          <Button onClick={() => navigator.clipboard.writeText(link)}>Copy</Button>
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            onClick={async () => {
              const sharedWith = [...users.split(',').map((u) => u.trim()).filter(Boolean), ...(everyone ? ['*'] : [])];
              const next = await api<Artifact>(`/artifacts/${artifact.id}`, { method: 'PATCH', json: { sharedWith } });
              qc.setQueryData(['artifact', artifact.id], next);
              onClose();
            }}
          >
            Save
          </Button>
        </div>
      </div>
    </Modal>
  );
}
