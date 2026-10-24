'use client';

import { useQueryClient } from '@tanstack/react-query';
import { Bot, GitBranch, GitMerge, ListOrdered, MessageSquare, Play, Plus, Workflow as WorkflowIcon } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import type { AgentInfo, Workflow, WorkflowGraph } from '@cowork/shared';
import { PageHeader } from '@/components/PageHeader';
import { Button } from '@/components/ui';
import { TryAgent } from '@/components/workflow/TryAgent';
import { api } from '@/lib/api';
import { useAgents, useMe, useWorkflows } from '@/lib/hooks';
import { buildTemplate, TEMPLATES, type TemplateKind } from '@/lib/workflow-templates';

const TEMPLATE_ICON = { sequential: ListOrdered, parallel: GitMerge, conditional: GitBranch };

export default function WorkflowsPage() {
  const { data: me } = useMe();
  const { data: agentsAndFlows = [] } = useAgents();
  const { data: workflows = [] } = useWorkflows();
  const agents = agentsAndFlows.filter((a) => a.kind === 'agent');
  const canBuild = !!me?.permissions.buildWorkflows;
  const router = useRouter();
  const qc = useQueryClient();
  const [trying, setTrying] = useState<AgentInfo | null>(null);
  const [busy, setBusy] = useState(false);

  const create = async (name: string, graph?: WorkflowGraph) => {
    setBusy(true);
    try {
      const w = await api<Workflow>('/workflows', { method: 'POST', json: { name, graph } });
      qc.invalidateQueries({ queryKey: ['workflows'] });
      router.push(`/workflows/${w.id}`);
    } finally {
      setBusy(false);
    }
  };

  const blank: WorkflowGraph = {
    nodes: [
      { id: 'start', type: 'start', position: { x: 0, y: 120 } },
      { id: 'end', type: 'end', position: { x: 600, y: 120 } },
    ],
    edges: [],
  };

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-6xl space-y-10 px-6 py-8">
        <PageHeader title="Workflows" subtitle="Combine the agents you've built in Snowflake: chain them, run them in parallel, or branch on a review.">
          {canBuild && (
            <Button variant="primary" disabled={busy} onClick={() => create('Untitled workflow', blank)}>
              <Plus className="h-4 w-4" /> New workflow
            </Button>
          )}
        </PageHeader>

        <section>
          <h2 className="mb-3 text-sm font-semibold">Agents in Snowflake</h2>
          {!agents.length && <p className="text-sm text-ink-3">No agents are visible to your role yet.</p>}
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {agents.map((a) => (
              <div key={a.id} className="flex flex-col rounded-xl border border-line bg-panel p-4">
                <div className="flex items-center gap-2 text-sm font-medium">
                  <Bot className="h-4 w-4 text-ink-3" /> {a.displayName}
                </div>
                {a.description && <p className="mt-1 line-clamp-2 text-xs text-ink-2">{a.description}</p>}
                <p className="mt-1 truncate font-mono text-[10px] text-ink-3">{a.id}</p>
                <div className="mt-3 flex gap-2">
                  {canBuild && (
                    <Button size="sm" onClick={() => setTrying(a)}>
                      <Play className="h-3 w-3" /> Try
                    </Button>
                  )}
                  <Link href={`/?agent=${encodeURIComponent(a.id)}`}>
                    <Button size="sm" variant="ghost">
                      <MessageSquare className="h-3 w-3" /> Chat
                    </Button>
                  </Link>
                </div>
              </div>
            ))}
          </div>
        </section>

        {canBuild && (
          <section>
            <h2 className="mb-3 text-sm font-semibold">Start from a template</h2>
            <div className="grid gap-3 sm:grid-cols-3">
              {TEMPLATES.map((t) => {
                const Icon = TEMPLATE_ICON[t.kind];
                return (
                  <button
                    key={t.kind}
                    disabled={busy || !agents.length}
                    onClick={() => {
                      const tpl = buildTemplate(t.kind as TemplateKind, agents);
                      create(tpl.name, tpl.graph);
                    }}
                    className="rounded-xl border border-line p-4 text-left hover:border-ink-3 hover:bg-panel disabled:opacity-50"
                  >
                    <div className="flex items-center gap-2 text-sm font-medium">
                      <Icon className="h-4 w-4 text-accent" /> {t.name}
                    </div>
                    <p className="mt-1 text-xs text-ink-2">{t.description}</p>
                  </button>
                );
              })}
            </div>
          </section>
        )}

        <section>
          <h2 className="mb-3 text-sm font-semibold">Workflows</h2>
          {!workflows.length && <p className="text-sm text-ink-3">No workflows yet.</p>}
          <div className="divide-y divide-line rounded-xl border border-line empty:hidden">
            {workflows.map((w) => (
              <Link key={w.id} href={`/workflows/${w.id}`} className="flex items-center gap-3 px-4 py-3 hover:bg-panel">
                <WorkflowIcon className="h-4 w-4 text-ink-3" />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium">{w.name}</div>
                  <div className="text-xs text-ink-3">
                    {w.graph.nodes.filter((n) => n.type === 'agent').length} agent steps · by {w.ownerName ?? 'unknown'} · updated {new Date(w.updatedAt).toLocaleString()}
                  </div>
                </div>
                <span className={`rounded-full px-2 py-0.5 text-[11px] ${w.published ? 'bg-accent-soft text-accent' : 'bg-raised text-ink-3'}`}>
                  {w.published ? 'Published' : 'Draft'}
                </span>
              </Link>
            ))}
          </div>
        </section>
      </div>
      {trying && <TryAgent agent={trying} onClose={() => setTrying(null)} />}
    </div>
  );
}
