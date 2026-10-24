'use client';

import { useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import { Bot, CalendarClock, ExternalLink, Mail, Pencil, Play, Plus, Telescope, Trash2, Workflow as WorkflowIcon } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { AUTO_AGENT_ID, describeCron, istTime, type Automation, type AutomationRun } from '@cowork/shared';
import { AutomationEditor } from '@/components/AutomationEditor';
import { PageHeader } from '@/components/PageHeader';
import { Button, Modal, Spinner } from '@/components/ui';
import { api } from '@/lib/api';
import { useAgents, useAutomationRuns, useAutomations } from '@/lib/hooks';

const KIND_ICON = { agent: Bot, workflow: WorkflowIcon, research: Telescope };
const KIND_LABEL = { agent: 'Agent answer', workflow: 'Workflow', research: 'Deep research report' };
const STATUS_CLS: Record<string, string> = {
  success: 'bg-accent-soft text-accent',
  running: 'bg-raised text-ink-2',
  error: 'bg-danger/10 text-danger',
  missed: 'bg-raised text-ink-3',
};

export default function AutomationsPage() {
  const { data: automations = [], isLoading } = useAutomations();
  const { data: agents = [] } = useAgents();
  const [editing, setEditing] = useState<Partial<Automation> | null>(null);
  const [history, setHistory] = useState<Automation | null>(null);
  const [running, setRunning] = useState<string | null>(null);
  const qc = useQueryClient();
  const refresh = () => qc.invalidateQueries({ queryKey: ['automations'] });
  const nameOf = (id: string) => (id === AUTO_AGENT_ID ? 'Auto' : (agents.find((a) => a.id === id)?.displayName ?? id.split('.').pop()?.replace('workflow:', '')));

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-5xl px-6 py-8">
        <PageHeader title="Automations" subtitle="Run an agent, workflow or deep research on a schedule. Each result is saved as an artifact and can be emailed.">
          <Button variant="primary" onClick={() => setEditing({})}>
            <Plus className="h-4 w-4" /> New automation
          </Button>
        </PageHeader>

        {isLoading && <Spinner className="mx-auto mt-10" />}
        {!isLoading && !automations.length && (
          <div className="mt-16 flex flex-col items-center gap-2 text-center text-ink-3">
            <CalendarClock className="h-8 w-8" />
            <p className="text-sm">No automations yet. Example: a deep-research brief on last week's field activity every Monday at 08:00.</p>
          </div>
        )}

        <div className="divide-y divide-line rounded-xl border border-line empty:hidden">
          {automations.map((a) => {
            const Icon = KIND_ICON[a.target.kind];
            return (
              <div key={a.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                <Icon className="h-4 w-4 shrink-0 text-ink-3" />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate text-sm font-medium">{a.name}</span>
                    {!a.enabled && <span className="rounded-full bg-raised px-2 py-0.5 text-[10px] text-ink-3">Paused</span>}
                    {a.email?.enabled && <Mail className="h-3.5 w-3.5 text-ink-3" aria-label="Emails results" />}
                  </div>
                  <div className="text-xs text-ink-3">
                    {KIND_LABEL[a.target.kind]} · {nameOf(a.target.agentId)} · {describeCron(a.schedule.cron)}
                  </div>
                  <div className="text-xs text-ink-3">
                    {a.enabled ? `Next: ${istTime(a.nextRunAt)}` : 'Not scheduled'}
                    {a.lastStatus && (
                      <>
                        {' · Last: '}
                        <button onClick={() => setHistory(a)} className={clsx('rounded-full px-1.5 py-0.5 text-[10px]', STATUS_CLS[a.lastStatus])}>
                          {a.lastStatus}
                        </button>
                      </>
                    )}
                  </div>
                </div>
                <label className="flex items-center gap-1.5 text-xs text-ink-2">
                  <input
                    type="checkbox"
                    checked={a.enabled}
                    onChange={async (e) => {
                      await api(`/automations/${a.id}`, { method: 'PATCH', json: { enabled: e.target.checked } });
                      refresh();
                    }}
                  />
                  On
                </label>
                <Button
                  size="sm"
                  disabled={running === a.id}
                  onClick={async () => {
                    setRunning(a.id);
                    try {
                      await api(`/automations/${a.id}/run`, { method: 'POST' });
                    } finally {
                      setRunning(null);
                      refresh();
                      qc.invalidateQueries({ queryKey: ['automation-runs', a.id] });
                      qc.invalidateQueries({ queryKey: ['artifacts'] });
                    }
                  }}
                >
                  {running === a.id ? <Spinner className="h-3 w-3" /> : <Play className="h-3 w-3" />} {running === a.id ? 'Running…' : 'Run now'}
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setHistory(a)}>
                  History
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setEditing(a)} aria-label="Edit">
                  <Pencil className="h-3.5 w-3.5" />
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  aria-label="Delete"
                  onClick={async () => {
                    if (!confirm(`Delete "${a.name}" and its run history?`)) return;
                    await api(`/automations/${a.id}`, { method: 'DELETE' });
                    refresh();
                  }}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            );
          })}
        </div>
        <p className="mt-4 text-xs text-ink-3">
          Times are India Standard Time. If the app is stopped outside working hours, Snowflake wakes it shortly before a scheduled run.
        </p>
      </div>
      {editing && <AutomationEditor initial={editing} agents={agents} onClose={() => setEditing(null)} onSaved={refresh} />}
      {history && <History automation={history} onClose={() => setHistory(null)} />}
    </div>
  );
}

function History({ automation, onClose }: { automation: Automation; onClose: () => void }) {
  const { data: runs = [], isLoading } = useAutomationRuns(automation.id);
  return (
    <Modal open onClose={onClose} title={`${automation.name}: run history`} wide>
      {isLoading && <Spinner className="mx-auto" />}
      {!isLoading && !runs.length && <p className="text-sm text-ink-3">No runs yet.</p>}
      <div className="max-h-[60vh] divide-y divide-line overflow-y-auto">
        {runs.map((r: AutomationRun) => {
          const secs = r.finishedAt ? Math.round((Date.parse(r.finishedAt) - Date.parse(r.startedAt)) / 1000) : null;
          return (
            <div key={r.id} className="flex flex-wrap items-center gap-3 py-2 text-sm">
              <span className={clsx('rounded-full px-2 py-0.5 text-[11px]', STATUS_CLS[r.status])}>{r.status}</span>
              <span className="text-ink-2">{istTime(r.startedAt)}</span>
              <span className="text-xs text-ink-3">
                {r.trigger}
                {secs !== null && ` · ${secs}s`}
                {r.emailed && ' · emailed'}
              </span>
              {r.error && <span className="text-xs text-danger">{r.error}</span>}
              {r.artifactId && (
                <Link href={`/artifacts/${r.artifactId}`} className="ml-auto inline-flex items-center gap-1 text-xs text-accent hover:underline">
                  Open result <ExternalLink className="h-3 w-3" />
                </Link>
              )}
            </div>
          );
        })}
      </div>
    </Modal>
  );
}
