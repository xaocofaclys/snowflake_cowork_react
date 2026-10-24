'use client';

import clsx from 'clsx';
import { useState } from 'react';
import { AUTO_AGENT_ID, DAYS, describeCron, fromCron, toCron, type AgentInfo, type Automation, type AutomationTargetKind, type SchedulePick } from '@cowork/shared';
import { api } from '@/lib/api';
import { Button, Modal, inputCls } from './ui';

/** Create/edit form for automations; also opened pre-filled from chat ("Automate this", proposals). */
export function AutomationEditor({ initial, agents, onClose, onSaved }: { initial: Partial<Automation>; agents: AgentInfo[]; onClose: () => void; onSaved: (a: Automation) => void }) {
  const realAgents = agents.filter((a) => a.kind === 'agent');
  const workflows = agents.filter((a) => a.kind === 'workflow');
  const [name, setName] = useState(initial.name ?? '');
  const [prompt, setPrompt] = useState(initial.prompt ?? '');
  const [kind, setKind] = useState<AutomationTargetKind>(initial.target?.kind ?? 'research');
  const [agentId, setAgentId] = useState(initial.target?.agentId ?? AUTO_AGENT_ID);
  const [pick, setPick] = useState<SchedulePick>(initial.schedule ? fromCron(initial.schedule.cron) : { freq: 'weekdays', time: '08:00', day: 1, cron: '0 8 * * 1-5' });
  const [emailOn, setEmailOn] = useState(initial.email?.enabled ?? false);
  const [emails, setEmails] = useState((initial.email?.to ?? []).join(', '));
  const [error, setError] = useState<string>();
  const [saving, setSaving] = useState(false);

  const options = kind === 'workflow' ? workflows : realAgents;
  const allowAuto = kind !== 'workflow' && realAgents.length > 1;

  const submit = async () => {
    setSaving(true);
    setError(undefined);
    const body = {
      name,
      prompt,
      target: { kind, agentId },
      schedule: { cron: toCron(pick), timezone: 'Asia/Kolkata' },
      email: { enabled: emailOn, to: emails.split(',').map((e) => e.trim()).filter(Boolean) },
      enabled: initial.enabled ?? true,
    };
    try {
      const saved = initial.id
        ? await api<Automation>(`/automations/${initial.id}`, { method: 'PATCH', json: body })
        : await api<Automation>('/automations', { method: 'POST', json: body });
      onSaved(saved);
      onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const label = 'block text-xs font-medium text-ink-2';
  return (
    <Modal open onClose={onClose} title={initial.id ? 'Edit automation' : 'New automation'}>
      <div className="max-h-[70vh] space-y-4 overflow-y-auto pr-1">
        <label className={label}>
          Name
          <input className={`${inputCls} mt-1`} value={name} onChange={(e) => setName(e.target.value)} placeholder="Monday field brief" />
        </label>

        <div className={label}>
          What runs
          <div className="mt-1 grid grid-cols-3 gap-1 rounded-lg bg-raised p-1">
            {(['research', 'agent', 'workflow'] as const).map((k) => (
              <button
                key={k}
                type="button"
                onClick={() => {
                  setKind(k);
                  setAgentId(k === 'workflow' ? (workflows[0]?.id ?? '') : AUTO_AGENT_ID);
                }}
                className={clsx('rounded-md py-1 text-xs', kind === k ? 'bg-bg font-medium shadow-sm' : 'text-ink-3')}
              >
                {k === 'research' ? 'Deep research' : k === 'agent' ? 'Agent' : 'Workflow'}
              </button>
            ))}
          </div>
        </div>

        <label className={label}>
          {kind === 'workflow' ? 'Workflow' : 'Agent'}
          <select className={`${inputCls} mt-1`} value={agentId} onChange={(e) => setAgentId(e.target.value)}>
            {allowAuto && <option value={AUTO_AGENT_ID}>Auto: pick the right agent(s)</option>}
            {options.map((a) => (
              <option key={a.id} value={a.id}>
                {a.displayName}
              </option>
            ))}
          </select>
          {kind === 'workflow' && !workflows.length && <span className="mt-1 block text-danger">Publish a workflow first.</span>}
        </label>

        <label className={label}>
          {kind === 'research' ? 'Research question' : 'Message'}
          <textarea rows={3} className={`${inputCls} mt-1`} value={prompt} onChange={(e) => setPrompt(e.target.value)} placeholder="Summarize last week's HCP interactions and NBA follow-through by region" />
        </label>

        <div className={label}>
          Schedule (IST)
          <div className="mt-1 flex flex-wrap gap-2">
            <select className={`${inputCls} w-36`} value={pick.freq} onChange={(e) => setPick({ ...pick, freq: e.target.value as SchedulePick['freq'] })}>
              <option value="daily">Every day</option>
              <option value="weekdays">Weekdays</option>
              <option value="weekly">Weekly</option>
              <option value="custom">Custom cron</option>
            </select>
            {pick.freq === 'weekly' && (
              <select className={`${inputCls} w-36`} value={pick.day} onChange={(e) => setPick({ ...pick, day: Number(e.target.value) })}>
                {DAYS.map((d, i) => (
                  <option key={d} value={i}>
                    {d}
                  </option>
                ))}
              </select>
            )}
            {pick.freq === 'custom' ? (
              <input className={`${inputCls} w-44 font-mono`} value={pick.cron} onChange={(e) => setPick({ ...pick, cron: e.target.value })} placeholder="0 8 * * 1" />
            ) : (
              <input type="time" className={`${inputCls} w-32`} value={pick.time} onChange={(e) => setPick({ ...pick, time: e.target.value })} />
            )}
          </div>
          <span className="mt-1 block font-normal text-ink-3">{describeCron(toCron(pick))}. At most once every 15 minutes.</span>
        </div>

        <div className={label}>
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={emailOn} onChange={(e) => setEmailOn(e.target.checked)} /> Email the result
          </label>
          {emailOn && (
            <>
              <input className={`${inputCls} mt-1`} value={emails} onChange={(e) => setEmails(e.target.value)} placeholder="you@company.com, colleague@company.com" />
              <span className="mt-1 block font-normal text-ink-3">Snowflake only delivers to verified email addresses of users in this account.</span>
            </>
          )}
        </div>

        {error && <p className="text-xs text-danger">{error}</p>}
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" disabled={saving || !name.trim() || !prompt.trim() || !agentId} onClick={submit}>
            Save
          </Button>
        </div>
      </div>
    </Modal>
  );
}

