'use client';

import { useQueryClient } from '@tanstack/react-query';
import { Pencil, Plus, Trash2, Wand2 } from 'lucide-react';
import { useState } from 'react';
import type { Skill } from '@cowork/shared';
import { PageHeader } from '@/components/PageHeader';
import { Button, IconButton, Modal, inputCls } from '@/components/ui';
import { api } from '@/lib/api';
import { useSkills } from '@/lib/hooks';

export default function SkillsPage() {
  const { data: skills = [] } = useSkills();
  const [editing, setEditing] = useState<Partial<Skill> | null>(null);
  const qc = useQueryClient();

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-4xl px-6 py-8">
        <PageHeader title="Skills" subtitle="Reusable workflows you run by typing / in the chat box. Use {{input}} for whatever you type after the command.">
          <Button variant="primary" onClick={() => setEditing({})}>
            <Plus className="h-4 w-4" /> New skill
          </Button>
        </PageHeader>
        {!skills.length && (
          <div className="mt-16 flex flex-col items-center gap-2 text-center text-ink-3">
            <Wand2 className="h-8 w-8" />
            <p className="text-sm">No skills yet. Example: /weekly-review, "Summarize revenue by region for the last 7 days vs the prior week, as a chart."</p>
          </div>
        )}
        <div className="divide-y divide-line rounded-xl border border-line">
          {skills.map((s) => (
            <div key={s.id} className="flex items-start gap-3 p-4">
              <Wand2 className="mt-0.5 h-4 w-4 text-ink-3" />
              <div className="min-w-0 flex-1">
                <div className="font-mono text-sm font-medium">/{s.name}</div>
                {s.description && <div className="text-sm text-ink-2">{s.description}</div>}
                <div className="mt-1 line-clamp-2 text-xs text-ink-3">{s.prompt}</div>
              </div>
              <IconButton label="Edit" onClick={() => setEditing(s)}>
                <Pencil className="h-3.5 w-3.5" />
              </IconButton>
              <IconButton
                label="Delete"
                onClick={async () => {
                  if (!confirm(`Delete /${s.name}?`)) return;
                  await api(`/skills/${s.id}`, { method: 'DELETE' });
                  qc.invalidateQueries({ queryKey: ['skills'] });
                }}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </IconButton>
            </div>
          ))}
        </div>
      </div>
      {editing && <SkillEditor skill={editing} onClose={() => setEditing(null)} />}
    </div>
  );
}

function SkillEditor({ skill, onClose }: { skill: Partial<Skill>; onClose: () => void }) {
  const [name, setName] = useState(skill.name ?? '');
  const [description, setDescription] = useState(skill.description ?? '');
  const [prompt, setPrompt] = useState(skill.prompt ?? '');
  const [error, setError] = useState<string>();
  const qc = useQueryClient();

  const save = async () => {
    try {
      const json = { name, description, prompt };
      if (skill.id) await api(`/skills/${skill.id}`, { method: 'PATCH', json });
      else await api('/skills', { method: 'POST', json });
      qc.invalidateQueries({ queryKey: ['skills'] });
      onClose();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <Modal open onClose={onClose} title={skill.id ? 'Edit skill' : 'New skill'}>
      <div className="space-y-3">
        <label className="block text-xs font-medium text-ink-2">
          Command
          <div className="mt-1 flex items-center rounded-lg border border-line focus-within:border-accent">
            <span className="pl-3 font-mono text-sm text-ink-3">/</span>
            <input className="w-full bg-transparent px-1 py-2 font-mono text-sm outline-none" value={name} onChange={(e) => setName(e.target.value)} placeholder="weekly-review" />
          </div>
        </label>
        <label className="block text-xs font-medium text-ink-2">
          Description
          <input className={`${inputCls} mt-1`} value={description} onChange={(e) => setDescription(e.target.value)} />
        </label>
        <label className="block text-xs font-medium text-ink-2">
          Prompt
          <textarea rows={6} className={`${inputCls} mt-1`} value={prompt} onChange={(e) => setPrompt(e.target.value)} placeholder="Compare revenue for {{input}} against the previous period and chart it." />
        </label>
        {error && <p className="text-xs text-danger">{error}</p>}
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" disabled={!name.trim() || !prompt.trim()} onClick={save}>
            Save
          </Button>
        </div>
      </div>
    </Modal>
  );
}
