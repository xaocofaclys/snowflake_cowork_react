'use client';

import { useQueryClient } from '@tanstack/react-query';
import { CalendarClock, Check, Mail } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import type { Automation, AutomationProposal } from '@cowork/shared';
import { api } from '@/lib/api';
import { useAgents } from '@/lib/hooks';
import { AutomationEditor } from './AutomationEditor';
import { Button } from './ui';

export function proposalToDraft(p: AutomationProposal): Partial<Automation> {
  return { name: p.name, prompt: p.prompt, target: p.target, schedule: p.schedule, email: p.email, enabled: true };
}

/** Confirmation card for an automation requested in chat. Nothing exists until "Create". */
export function AutomationProposalCard({ proposal }: { proposal: AutomationProposal }) {
  const { data: agents = [] } = useAgents();
  const [created, setCreated] = useState<Automation>();
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const qc = useQueryClient();
  const done = (a: Automation) => {
    setCreated(a);
    qc.invalidateQueries({ queryKey: ['automations'] });
  };

  return (
    <div className="my-3 rounded-xl border border-accent/40 bg-accent-soft/40 p-4">
      <div className="flex items-start gap-3">
        <CalendarClock className="mt-0.5 h-5 w-5 shrink-0 text-accent" />
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold">{proposal.name}</div>
          <div className="mt-0.5 text-xs text-ink-2">{proposal.summary}</div>
          <div className="mt-2 rounded-lg bg-bg px-3 py-2 text-sm text-ink-2">“{proposal.prompt}”</div>
          {!proposal.email.enabled && (
            <div className="mt-2 flex items-center gap-1 text-xs text-ink-3">
              <Mail className="h-3 w-3" /> No email recipients yet. Use “Edit first” to add yours.
            </div>
          )}
        </div>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2 pl-8">
        {created ? (
          <>
            <span className="inline-flex items-center gap-1 text-sm text-accent">
              <Check className="h-4 w-4" /> Automation created
            </span>
            <Link href="/automations" className="text-sm text-accent underline">
              View automations
            </Link>
          </>
        ) : (
          <>
            <Button
              size="sm"
              variant="primary"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                setError(undefined);
                try {
                  done(await api<Automation>('/automations', { method: 'POST', json: proposalToDraft(proposal) }));
                } catch (e) {
                  setError((e as Error).message);
                } finally {
                  setBusy(false);
                }
              }}
            >
              Create automation
            </Button>
            <Button size="sm" onClick={() => setEditing(true)}>
              Edit first
            </Button>
          </>
        )}
        {error && <span className="text-xs text-danger">{error}</span>}
      </div>
      {editing && <AutomationEditor initial={proposalToDraft(proposal)} agents={agents} onClose={() => setEditing(false)} onSaved={done} />}
    </div>
  );
}
