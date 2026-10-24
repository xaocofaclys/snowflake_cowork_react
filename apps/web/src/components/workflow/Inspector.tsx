'use client';

import { Trash2 } from 'lucide-react';
import { useRef } from 'react';
import type { AgentInfo, ConditionNode, WorkflowNode } from '@cowork/shared';
import { Button, inputCls } from '../ui';

const label = 'block text-[11px] font-medium text-ink-2';

/** Edits the selected node. `others` are the remaining nodes, offered as {{nodes.<id>.output}} variables. */
export function Inspector({
  node,
  others,
  agents,
  readOnly,
  onChange,
  onRenameBranch,
  onDelete,
}: {
  node: WorkflowNode;
  others: WorkflowNode[];
  agents: AgentInfo[];
  readOnly: boolean;
  onChange: (patch: Partial<WorkflowNode>) => void;
  onRenameBranch: (from: string, to: string) => void;
  onDelete: () => void;
}) {
  return (
    <fieldset disabled={readOnly} className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold capitalize">{node.type} step</h3>
        {node.type !== 'start' && !readOnly && (
          <Button size="sm" variant="ghost" onClick={onDelete}>
            <Trash2 className="h-3.5 w-3.5" /> Delete
          </Button>
        )}
      </div>
      <p className="font-mono text-[10px] text-ink-3">id: {node.id}</p>

      {node.type !== 'start' && (
        <label className={label}>
          Label
          <input className={`${inputCls} mt-1`} value={node.label ?? ''} onChange={(e) => onChange({ label: e.target.value })} />
        </label>
      )}

      {node.type === 'start' && <p className="text-xs text-ink-2">The user's message enters the workflow here and is available everywhere as {'{{input}}'}.</p>}

      {node.type === 'agent' && (
        <>
          <label className={label}>
            Agent
            <select className={`${inputCls} mt-1`} value={node.agentId} onChange={(e) => onChange({ agentId: e.target.value })}>
              <option value="">Select an agent…</option>
              {agents.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.displayName}
                </option>
              ))}
            </select>
          </label>
          <TemplateField
            title="Message sent to the agent"
            value={node.inputTemplate}
            others={others}
            onChange={(v) => onChange({ inputTemplate: v })}
          />
        </>
      )}

      {node.type === 'condition' && <ConditionFields node={node} others={others} onChange={onChange} onRenameBranch={onRenameBranch} />}

      {node.type === 'join' && (
        <p className="text-xs text-ink-2">
          Waits until every incoming branch has finished, then passes their outputs on as one text with a heading per branch. Branches skipped by a
          condition don't block it.
        </p>
      )}

      {node.type === 'end' && (
        <TemplateField
          title="Final answer"
          value={node.outputTemplate ?? '{{previous.output}}'}
          others={others}
          onChange={(v) => onChange({ outputTemplate: v })}
        />
      )}
    </fieldset>
  );
}

function ConditionFields({
  node,
  others,
  onChange,
  onRenameBranch,
}: {
  node: ConditionNode;
  others: WorkflowNode[];
  onChange: (patch: Partial<ConditionNode>) => void;
  onRenameBranch: (from: string, to: string) => void;
}) {
  const rules = node.rules ?? [];
  return (
    <>
      <div className={label}>
        Decide with
        <div className="mt-1 grid grid-cols-2 gap-1 rounded-lg bg-raised p-1">
          {(['classify', 'rule'] as const).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => onChange({ method: m })}
              className={`rounded-md py-1 text-xs ${node.method === m ? 'bg-bg font-medium shadow-sm' : 'text-ink-3'}`}
            >
              {m === 'classify' ? 'AI_CLASSIFY' : 'Keyword rules'}
            </button>
          ))}
        </div>
      </div>

      <div className={label}>
        Branches
        <div className="mt-1 space-y-1">
          {node.branches.map((b) => (
            <div key={b} className="flex gap-1">
              <input
                className={inputCls}
                defaultValue={b}
                onBlur={(e) => {
                  const v = e.target.value.trim();
                  if (v && v !== b && !node.branches.includes(v)) onRenameBranch(b, v);
                  else e.target.value = b;
                }}
              />
              {node.branches.length > 2 && (
                <Button type="button" size="sm" variant="ghost" onClick={() => onChange({ branches: node.branches.filter((x) => x !== b) })}>
                  <Trash2 className="h-3 w-3" />
                </Button>
              )}
            </div>
          ))}
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={() => {
              let n = node.branches.length + 1;
              while (node.branches.includes(`branch${n}`)) n++;
              onChange({ branches: [...node.branches, `branch${n}`] });
            }}
          >
            + Add branch
          </Button>
        </div>
      </div>

      {node.method === 'classify' ? (
        <label className={label}>
          Instructions for AI_CLASSIFY (optional)
          <textarea
            rows={3}
            className={`${inputCls} mt-1`}
            value={node.instructions ?? ''}
            placeholder="e.g. Did the compliance review approve the content?"
            onChange={(e) => onChange({ instructions: e.target.value })}
          />
        </label>
      ) : (
        <div className={label}>
          Keywords per branch (first match wins)
          <div className="mt-1 space-y-1">
            {node.branches.map((b) => (
              <div key={b} className="flex items-center gap-2">
                <span className="w-16 shrink-0 truncate text-xs">{b}</span>
                <input
                  className={inputCls}
                  placeholder="comma-separated, e.g. verdict: pass, approved"
                  value={rules.find((r) => r.branch === b)?.keywords.join(', ') ?? ''}
                  onChange={(e) => {
                    const keywords = e.target.value.split(',').map((k) => k.trim());
                    onChange({ rules: [...rules.filter((r) => r.branch !== b), { branch: b, keywords }] });
                  }}
                />
              </div>
            ))}
          </div>
          <label className={`${label} mt-2`}>
            If nothing matches
            <select className={`${inputCls} mt-1`} value={node.defaultBranch ?? ''} onChange={(e) => onChange({ defaultBranch: e.target.value || undefined })}>
              <option value="">Last branch</option>
              {node.branches.map((b) => (
                <option key={b} value={b}>
                  {b}
                </option>
              ))}
            </select>
          </label>
        </div>
      )}

      <TemplateField title="Text to evaluate" value={node.inputTemplate} others={others} onChange={(v) => onChange({ inputTemplate: v })} />
      <p className="text-[11px] text-ink-3">Drag from a branch's dot on the canvas to the step it should run next. A branch may point back to an earlier step to loop.</p>
    </>
  );
}

function TemplateField({ title, value, others, onChange }: { title: string; value: string; others: WorkflowNode[]; onChange: (v: string) => void }) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const insert = (token: string) => {
    const el = ref.current;
    if (!el) return onChange(value + token);
    const start = el.selectionStart ?? value.length;
    const end = el.selectionEnd ?? value.length;
    onChange(value.slice(0, start) + token + value.slice(end));
    requestAnimationFrame(() => {
      el.focus();
      el.selectionStart = el.selectionEnd = start + token.length;
    });
  };
  const vars = [
    { token: '{{input}}', name: "user's message" },
    { token: '{{previous.output}}', name: 'previous step' },
    ...others.filter((n) => n.type === 'agent').map((n) => ({ token: `{{nodes.${n.id}.output}}`, name: n.label || n.id })),
  ];
  return (
    <div className={label}>
      {title}
      <textarea ref={ref} rows={6} className={`${inputCls} mt-1 font-mono text-xs`} value={value} onChange={(e) => onChange(e.target.value)} />
      <div className="mt-1 flex flex-wrap gap-1">
        {vars.map((v) => (
          <button
            key={v.token}
            type="button"
            title={v.token}
            onClick={() => insert(v.token)}
            className="rounded-md border border-line px-1.5 py-0.5 text-[10px] font-normal text-ink-2 hover:bg-raised"
          >
            + {v.name}
          </button>
        ))}
      </div>
    </div>
  );
}
