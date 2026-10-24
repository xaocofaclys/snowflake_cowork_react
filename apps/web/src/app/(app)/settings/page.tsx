'use client';

import { useQueryClient } from '@tanstack/react-query';
import { Brain, Check, Pencil, Plus, Trash2, X } from 'lucide-react';
import { useState } from 'react';
import type { Memory } from '@cowork/shared';
import { APP_NAME } from '@cowork/shared';
import { PageHeader } from '@/components/PageHeader';
import { Button, IconButton, inputCls } from '@/components/ui';
import { api } from '@/lib/api';
import { useAgents, useMe, useMemories, useUpdateSettings } from '@/lib/hooks';
import { useTheme } from '@/lib/theme';

export default function SettingsPage() {
  const { data: me } = useMe();
  const { data: agents = [] } = useAgents();
  const update = useUpdateSettings();
  const { mode, setMode } = useTheme();
  if (!me) return null;
  const s = me.settings;

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-3xl space-y-8 px-6 py-8">
        <PageHeader title="Settings" />

        <Section title="Profile">
          <Row label="User">{me.user.name}</Row>
          <Row label="Role">{me.user.role}</Row>
          <Row label="Warehouse">{me.user.warehouse}</Row>
          <Row label="Mode">
            {me.mode.authMode === 'oauth' ? 'Snowflake OAuth' : 'Dev login'} · {me.mode.cortexMock ? 'Cortex mock' : 'Cortex live'}
          </Row>
        </Section>

        <Section title="Preferences">
          <Row label="Default agent">
            <select className={`${inputCls} !w-72`} value={s.defaultAgentId ?? ''} onChange={(e) => update.mutate({ defaultAgentId: e.target.value || undefined })}>
              <option value="">First available</option>
              {agents.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.displayName}
                </option>
              ))}
            </select>
          </Row>
          <Row label="Theme">
            <select className={`${inputCls} !w-40`} value={mode} onChange={(e) => setMode(e.target.value as 'light' | 'dark' | 'system')}>
              <option value="system">System</option>
              <option value="light">Light</option>
              <option value="dark">Dark</option>
            </select>
          </Row>
          <Toggle
            label="Auto-chart results"
            hint="When an agent returns a table without a chart, generate one automatically."
            checked={s.autoChart}
            onChange={(v) => update.mutate({ autoChart: v })}
          />
        </Section>

        <div id="memory">
          <Section title="Memory">
            <Toggle
              label="Use memory"
              hint={`${APP_NAME} remembers useful facts and preferences from your chats and uses them in future answers.`}
              checked={s.memoryEnabled}
              onChange={(v) => update.mutate({ memoryEnabled: v })}
            />
            <MemoryList />
          </Section>
        </div>
      </div>
    </div>
  );
}

function MemoryList() {
  const { data: memories = [] } = useMemories();
  const qc = useQueryClient();
  const [adding, setAdding] = useState('');
  const refresh = () => qc.invalidateQueries({ queryKey: ['memories'] });

  return (
    <div className="mt-3">
      <form
        className="mb-3 flex gap-2"
        onSubmit={async (e) => {
          e.preventDefault();
          if (!adding.trim()) return;
          await api('/memories', { method: 'POST', json: { text: adding.trim() } });
          setAdding('');
          refresh();
        }}
      >
        <input className={inputCls} placeholder={`Add something for ${APP_NAME} to remember…`} value={adding} onChange={(e) => setAdding(e.target.value)} />
        <Button type="submit">
          <Plus className="h-4 w-4" /> Add
        </Button>
      </form>
      {!memories.length && (
        <p className="flex items-center gap-2 py-4 text-sm text-ink-3">
          <Brain className="h-4 w-4" /> Nothing remembered yet. Try telling the agent “I prefer bar charts”.
        </p>
      )}
      <div className="divide-y divide-line rounded-xl border border-line empty:hidden">
        {memories.map((m) => (
          <MemoryRow key={m.id} memory={m} onChange={refresh} />
        ))}
      </div>
      {memories.length > 0 && (
        <button
          className="mt-3 text-xs text-danger hover:underline"
          onClick={async () => {
            if (!confirm(`Forget everything ${APP_NAME} remembers about you?`)) return;
            await api('/memories', { method: 'DELETE' });
            refresh();
          }}
        >
          Clear all memories
        </button>
      )}
    </div>
  );
}

function MemoryRow({ memory, onChange }: { memory: Memory; onChange: () => void }) {
  const [edit, setEdit] = useState<string | null>(null);
  return (
    <div className="flex items-center gap-3 px-4 py-2.5">
      {edit !== null ? (
        <input autoFocus className={inputCls} value={edit} onChange={(e) => setEdit(e.target.value)} />
      ) : (
        <div className="min-w-0 flex-1">
          <div className="text-sm">{memory.text}</div>
          <div className="text-[11px] text-ink-3">
            {memory.category} · {memory.source === 'auto' ? 'learned from chat' : 'added by you'} · {new Date(memory.createdAt).toLocaleDateString()}
          </div>
        </div>
      )}
      {edit !== null ? (
        <>
          <IconButton
            label="Save"
            onClick={async () => {
              await api(`/memories/${memory.id}`, { method: 'PATCH', json: { text: edit } });
              setEdit(null);
              onChange();
            }}
          >
            <Check className="h-3.5 w-3.5" />
          </IconButton>
          <IconButton label="Cancel" onClick={() => setEdit(null)}>
            <X className="h-3.5 w-3.5" />
          </IconButton>
        </>
      ) : (
        <>
          <IconButton label="Edit" onClick={() => setEdit(memory.text)}>
            <Pencil className="h-3.5 w-3.5" />
          </IconButton>
          <IconButton
            label="Forget"
            onClick={async () => {
              await api(`/memories/${memory.id}`, { method: 'DELETE' });
              onChange();
            }}
          >
            <Trash2 className="h-3.5 w-3.5" />
          </IconButton>
        </>
      )}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="mb-2 text-sm font-semibold">{title}</h2>
      <div className="rounded-xl border border-line p-4">{children}</div>
    </section>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 py-1.5 text-sm">
      <span className="text-ink-2">{label}</span>
      <span>{children}</span>
    </div>
  );
}

function Toggle({ label, hint, checked, onChange }: { label: string; hint?: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex cursor-pointer items-start justify-between gap-4 py-2">
      <span>
        <span className="block text-sm">{label}</span>
        {hint && <span className="block text-xs text-ink-3">{hint}</span>}
      </span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={`relative mt-0.5 h-5 w-9 shrink-0 rounded-full transition-colors ${checked ? 'bg-accent' : 'bg-line'}`}
      >
        <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-all ${checked ? 'left-[18px]' : 'left-0.5'}`} />
      </button>
    </label>
  );
}
