'use client';

import clsx from 'clsx';
import { ArrowUp, LayoutDashboard, MessageSquareText, Mic, Square, Telescope, Wand2 } from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { Skill } from '@cowork/shared';
import { useUi, type ChatMode } from '@/lib/ui-store';

/** Expands "/skill rest of text" using the skill's prompt ({{input}} is replaced by the rest). */
export function expandSkill(text: string, skills: Skill[]): string {
  const m = text.match(/^\/([a-z0-9-]+)\s*([\s\S]*)$/);
  const skill = m && skills.find((s) => s.name === m[1]);
  if (!skill) return text;
  const rest = m![2].trim();
  return skill.prompt.includes('{{input}}') ? skill.prompt.replaceAll('{{input}}', rest) : rest ? `${skill.prompt}\n\n${rest}` : skill.prompt;
}

const MODES: { key: ChatMode; label: string; icon: typeof Telescope; hint: string; placeholder: string }[] = [
  { key: 'chat', label: 'Ask', icon: MessageSquareText, hint: 'Ask a question about your data', placeholder: 'Ask anything about your data…' },
  { key: 'research', label: 'Deep research', icon: Telescope, hint: 'Plans sub-questions, researches them in parallel, writes a cited report', placeholder: 'What should be researched? e.g. Why did follow-through drop in the South?' },
  { key: 'dashboard', label: 'Dashboard', icon: LayoutDashboard, hint: 'Builds a live, filterable dashboard', placeholder: 'Describe the dashboard: metrics, breakdowns, filters…' },
];

export function Composer({
  onSend,
  onStop,
  streaming,
  skills,
  left,
  placeholder,
  autoFocus,
  mode = 'chat',
  onModeChange,
  initialText = '',
  size = 'md',
}: {
  onSend: (text: string) => void;
  onStop: () => void;
  streaming: boolean;
  skills: Skill[];
  left?: ReactNode;
  placeholder?: string;
  autoFocus?: boolean;
  mode?: ChatMode;
  onModeChange?: (m: ChatMode) => void;
  initialText?: string;
  size?: 'md' | 'lg';
}) {
  const [text, setText] = useState(initialText);
  const [sel, setSel] = useState(0);
  const [listening, setListening] = useState(false);
  const ta = useRef<HTMLTextAreaElement>(null);
  const recog = useRef<{ stop: () => void } | null>(null);
  const draft = useUi((s) => s.draft);

  // Text pushed from elsewhere (chart click, edit & resend, command palette).
  useEffect(() => {
    if (!draft.nonce) return;
    setText(draft.text);
    if (draft.mode && onModeChange) onModeChange(draft.mode);
    requestAnimationFrame(() => {
      ta.current?.focus();
      ta.current?.setSelectionRange(draft.text.length, draft.text.length);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft.nonce]);

  useEffect(() => {
    const el = ta.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 240)}px`;
  }, [text]);

  const slash = text.match(/^\/([a-z0-9-]*)$/);
  const matches = useMemo(() => (slash ? skills.filter((s) => s.name.startsWith(slash[1])).slice(0, 6) : []), [slash, skills]);
  const current = MODES.find((m) => m.key === mode) ?? MODES[0];

  const submit = () => {
    const t = text.trim();
    if (!t || streaming) return;
    onSend(t);
    setText('');
  };

  const voice = () => {
    const SR = (window as unknown as { SpeechRecognition?: new () => any; webkitSpeechRecognition?: new () => any }).SpeechRecognition ??
      (window as unknown as { webkitSpeechRecognition?: new () => any }).webkitSpeechRecognition;
    if (!SR) return alert('Voice input is not supported in this browser.');
    if (listening) return recog.current?.stop();
    const r = new SR();
    r.interimResults = true;
    r.lang = navigator.language;
    const base = text ? `${text} ` : '';
    r.onresult = (e: any) => setText(base + Array.from(e.results).map((x: any) => x[0].transcript).join(''));
    r.onend = () => setListening(false);
    r.start();
    recog.current = r;
    setListening(true);
  };

  return (
    <div className="relative">
      {matches.length > 0 && (
        <div className="animate-fade-up absolute bottom-full left-0 z-20 mb-2 w-80 rounded-xl border border-line bg-bg p-1 shadow-lift">
          {matches.map((s, i) => (
            <button
              key={s.id}
              onMouseDown={(e) => {
                e.preventDefault();
                setText(`/${s.name} `);
              }}
              className={clsx('flex w-full items-start gap-2 rounded-lg px-3 py-2 text-left', i === sel ? 'bg-raised' : 'hover:bg-raised')}
            >
              <Wand2 className="mt-0.5 h-3.5 w-3.5 text-ink-3" />
              <div className="min-w-0">
                <div className="text-sm font-medium">/{s.name}</div>
                {s.description && <div className="truncate text-xs text-ink-3">{s.description}</div>}
              </div>
            </button>
          ))}
        </div>
      )}
      <div
        className={clsx(
          'rounded-2xl border bg-bg shadow-soft transition focus-within:shadow-lift',
          mode === 'chat' ? 'border-line focus-within:border-ink-3/40' : 'border-accent/50 ring-4 ring-accent/10',
        )}
      >
        <textarea
          ref={ta}
          rows={size === 'lg' ? 2 : 1}
          autoFocus={autoFocus}
          value={text}
          placeholder={placeholder ?? current.placeholder}
          onChange={(e) => {
            setText(e.target.value);
            setSel(0);
          }}
          onKeyDown={(e) => {
            if (matches.length && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
              e.preventDefault();
              setSel((s) => (s + (e.key === 'ArrowDown' ? 1 : matches.length - 1)) % matches.length);
            } else if (matches.length && (e.key === 'Tab' || e.key === 'Enter')) {
              e.preventDefault();
              setText(`/${matches[sel].name} `);
            } else if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              submit();
            }
          }}
          className={clsx(
            'block max-h-60 w-full resize-none bg-transparent px-4 outline-none placeholder:text-ink-3',
            size === 'lg' ? 'pb-2 pt-4 text-base' : 'pb-1 pt-3.5 text-[15px]',
          )}
        />
        <div className="flex flex-wrap items-center gap-1 px-2 pb-2">
          {onModeChange && (
            <div role="radiogroup" aria-label="Mode" className="flex items-center gap-0.5 rounded-xl bg-raised/70 p-0.5">
              {MODES.map((m) => (
                <button
                  key={m.key}
                  role="radio"
                  aria-checked={mode === m.key}
                  type="button"
                  title={m.hint}
                  onClick={() => onModeChange(m.key)}
                  className={clsx(
                    'inline-flex h-7 items-center gap-1.5 rounded-lg px-2.5 text-xs font-medium transition',
                    mode === m.key ? 'bg-bg text-ink shadow-soft' : 'text-ink-3 hover:text-ink-2',
                  )}
                >
                  <m.icon className={clsx('h-3.5 w-3.5', mode === m.key && 'text-accent')} />
                  <span className={clsx(m.key !== 'chat' && 'hidden sm:inline')}>{m.label}</span>
                </button>
              ))}
            </div>
          )}
          {left}
          <div className="ml-auto flex items-center gap-1">
            <button
              type="button"
              onClick={voice}
              aria-label="Voice input"
              title="Voice input"
              className={clsx('inline-flex h-8 w-8 items-center justify-center rounded-lg transition hover:bg-raised', listening ? 'animate-pulse text-danger' : 'text-ink-3')}
            >
              <Mic className="h-4 w-4" />
            </button>
            {streaming ? (
              <button onClick={onStop} aria-label="Stop" className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-ink text-bg">
                <Square className="h-3.5 w-3.5" fill="currentColor" />
              </button>
            ) : (
              <button
                onClick={submit}
                disabled={!text.trim()}
                aria-label="Send"
                className="bg-brand inline-flex h-8 w-8 items-center justify-center rounded-lg text-white shadow-soft transition hover:opacity-95 disabled:opacity-30"
              >
                <ArrowUp className="h-4 w-4" />
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
