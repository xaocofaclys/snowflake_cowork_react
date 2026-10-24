'use client';

import clsx from 'clsx';
import { ArrowUp, Mic, Plus, Square, Telescope, Wand2, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { Skill } from '@cowork/shared';

/** Expands "/skill rest of text" using the skill's prompt ({{input}} is replaced by the rest). */
export function expandSkill(text: string, skills: Skill[]): string {
  const m = text.match(/^\/([a-z0-9-]+)\s*([\s\S]*)$/);
  const skill = m && skills.find((s) => s.name === m[1]);
  if (!skill) return text;
  const rest = m![2].trim();
  return skill.prompt.includes('{{input}}') ? skill.prompt.replaceAll('{{input}}', rest) : rest ? `${skill.prompt}\n\n${rest}` : skill.prompt;
}

export function Composer({
  onSend,
  onStop,
  streaming,
  skills,
  left,
  placeholder = 'Ask anything about your data…',
  autoFocus,
  research,
  onResearchChange,
  initialText = '',
}: {
  onSend: (text: string) => void;
  onStop: () => void;
  streaming: boolean;
  skills: Skill[];
  left?: ReactNode;
  placeholder?: string;
  autoFocus?: boolean;
  /** Deep research toggle (shown in the + menu when provided). */
  research?: boolean;
  onResearchChange?: (on: boolean) => void;
  initialText?: string;
}) {
  const [text, setText] = useState(initialText);
  const [sel, setSel] = useState(0);
  const [listening, setListening] = useState(false);
  const [menu, setMenu] = useState(false);
  const ta = useRef<HTMLTextAreaElement>(null);
  const recog = useRef<{ stop: () => void } | null>(null);

  useEffect(() => {
    const el = ta.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 220)}px`;
  }, [text]);

  const slash = text.match(/^\/([a-z0-9-]*)$/);
  const matches = useMemo(() => (slash ? skills.filter((s) => s.name.startsWith(slash[1])).slice(0, 6) : []), [slash, skills]);

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
        <div className="absolute bottom-full left-0 z-20 mb-2 w-80 rounded-xl border border-line bg-bg p-1 shadow-lg">
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
      <div className="rounded-2xl border border-line bg-bg shadow-sm focus-within:border-ink-3">
        <textarea
          ref={ta}
          rows={1}
          autoFocus={autoFocus}
          value={text}
          placeholder={placeholder}
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
          className="block max-h-56 w-full resize-none bg-transparent px-4 pb-1 pt-3.5 text-[15px] outline-none placeholder:text-ink-3"
        />
        <div className="flex items-center gap-1 px-2 pb-2">
          {onResearchChange && (
            <div className="relative">
              <button
                type="button"
                aria-label="More options"
                onClick={() => setMenu((m) => !m)}
                className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-ink-3 hover:bg-raised"
              >
                <Plus className="h-4 w-4" />
              </button>
              {menu && (
                <div className="absolute bottom-full left-0 z-30 mb-2 w-72 rounded-xl border border-line bg-bg p-1 shadow-lg">
                  <button
                    type="button"
                    onClick={() => {
                      onResearchChange(!research);
                      setMenu(false);
                    }}
                    className="flex w-full items-start gap-2 rounded-lg px-3 py-2 text-left hover:bg-raised"
                  >
                    <Telescope className="mt-0.5 h-4 w-4 text-accent" />
                    <div>
                      <div className="text-sm font-medium">Deep research {research ? '(on)' : ''}</div>
                      <div className="text-xs text-ink-3">Plans sub-questions, researches them in parallel and writes a cited report</div>
                    </div>
                  </button>
                </div>
              )}
            </div>
          )}
          {research && onResearchChange && (
            <span className="inline-flex h-7 items-center gap-1 rounded-full bg-accent-soft pl-2.5 pr-1 text-xs font-medium text-accent">
              <Telescope className="h-3.5 w-3.5" /> Deep research
              <button type="button" aria-label="Turn off deep research" onClick={() => onResearchChange(false)} className="rounded-full p-0.5 hover:bg-accent/10">
                <X className="h-3 w-3" />
              </button>
            </span>
          )}
          {left}
          <div className="ml-auto flex items-center gap-1">
            <button
              type="button"
              onClick={voice}
              aria-label="Voice input"
              title="Voice input"
              className={clsx('inline-flex h-8 w-8 items-center justify-center rounded-lg hover:bg-raised', listening ? 'text-danger' : 'text-ink-3')}
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
                className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-accent text-accent-ink disabled:opacity-30"
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
