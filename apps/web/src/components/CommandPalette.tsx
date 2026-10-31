'use client';

import clsx from 'clsx';
import {
  BarChart3,
  Bookmark,
  CalendarClock,
  CornerDownLeft,
  FileText,
  LayoutDashboard,
  MessageSquare,
  Moon,
  Plus,
  Search,
  Settings,
  Sun,
  Telescope,
  Wand2,
  Workflow,
  type LucideIcon,
} from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useArtifacts, useDashboards, useSkills, useThreads, useWorkflows } from '@/lib/hooks';
import { useTheme } from '@/lib/theme';
import { useUi, type ChatMode } from '@/lib/ui-store';

interface Item {
  id: string;
  group: string;
  label: string;
  hint?: string;
  icon: LucideIcon;
  run: () => void;
  keywords?: string;
}

/** Fuzzy-ish score: substring beats word-start beats in-order letters. */
function score(q: string, text: string): number {
  if (!q) return 1;
  const t = text.toLowerCase();
  const i = t.indexOf(q);
  if (i === 0) return 100;
  if (i > 0) return t[i - 1] === ' ' ? 80 : 60;
  let pos = 0;
  for (const ch of q) {
    pos = t.indexOf(ch, pos);
    if (pos < 0) return 0;
    pos++;
  }
  return 20;
}

/** ⌘K / Ctrl+K: jump to anything and run app actions from the keyboard. */
export function CommandPalette() {
  const open = useUi((s) => s.palette);
  const setOpen = useUi((s) => s.setPalette);
  const setDraft = useUi((s) => s.setDraft);
  const router = useRouter();
  const { dark, setMode } = useTheme();
  const { data: threads = [] } = useThreads();
  const { data: artifacts = [] } = useArtifacts();
  const { data: dashboards = [] } = useDashboards();
  const { data: workflows = [] } = useWorkflows();
  const { data: skills = [] } = useSkills();
  const [q, setQ] = useState('');
  const [sel, setSel] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setOpen(!useUi.getState().palette);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [setOpen]);

  useEffect(() => {
    if (open) {
      setQ('');
      setSel(0);
      setTimeout(() => input.current?.focus(), 10);
    }
  }, [open]);

  const go = (href: string) => () => router.push(href);
  const startMode = (mode: ChatMode, text = '') => () => {
    router.push('/');
    setTimeout(() => setDraft(text, mode), 50);
  };

  const items: Item[] = useMemo(
    () => [
      { id: 'a-new', group: 'Actions', label: 'New chat', icon: Plus, run: go('/'), keywords: 'ask question' },
      { id: 'a-research', group: 'Actions', label: 'Start a deep research', icon: Telescope, run: startMode('research'), keywords: 'report analysis' },
      { id: 'a-dash', group: 'Actions', label: 'Build a dashboard', icon: LayoutDashboard, run: startMode('dashboard'), keywords: 'kpi power bi' },
      { id: 'a-auto', group: 'Actions', label: 'New automation', hint: 'Schedule a report', icon: CalendarClock, run: go('/automations'), keywords: 'schedule email' },
      { id: 'a-wf', group: 'Actions', label: 'Open workflows', icon: Workflow, run: go('/workflows'), keywords: 'combine agents' },
      { id: 'a-art', group: 'Actions', label: 'Open artifacts', icon: Bookmark, run: go('/artifacts') },
      { id: 'a-set', group: 'Actions', label: 'Settings', icon: Settings, run: go('/settings'), keywords: 'preferences memory accent' },
      { id: 'a-theme', group: 'Actions', label: dark ? 'Switch to light mode' : 'Switch to dark mode', icon: dark ? Sun : Moon, run: () => setMode(dark ? 'light' : 'dark'), keywords: 'theme' },
      ...dashboards.map((d) => ({ id: `d-${d.id}`, group: 'Dashboards', label: d.title, icon: LayoutDashboard, run: go(`/dashboards/${d.id}`) })),
      ...artifacts.map((a) => ({
        id: `r-${a.id}`,
        group: a.type === 'report' ? 'Reports' : 'Artifacts',
        label: a.title,
        hint: a.type,
        icon: a.type === 'report' ? FileText : BarChart3,
        run: go(`/artifacts/${a.id}`),
      })),
      ...threads.map((t) => ({ id: `t-${t.id}`, group: 'Chats', label: t.title, icon: MessageSquare, run: go(`/c/${t.id}`) })),
      ...workflows.map((w) => ({ id: `w-${w.id}`, group: 'Workflows', label: w.name, hint: w.published ? 'published' : 'draft', icon: Workflow, run: go(`/workflows/${w.id}`) })),
      ...skills.map((s) => ({ id: `s-${s.id}`, group: 'Skills', label: `/${s.name}`, hint: s.description, icon: Wand2, run: startMode('chat', `/${s.name} `) })),
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [dark, dashboards, artifacts, threads, workflows, skills],
  );

  const results = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const scored = items
      .map((it) => ({ it, s: Math.max(score(needle, it.label), score(needle, it.keywords ?? '') * 0.8) }))
      .filter((x) => x.s > 0);
    if (needle) scored.sort((a, b) => b.s - a.s);
    // Without a query: actions plus a few recent items per group.
    const capped = needle ? scored.slice(0, 40) : scored.filter((x, i, arr) => x.it.group === 'Actions' || arr.filter((y) => y.it.group === x.it.group).indexOf(x) < 4);
    return capped.map((x) => x.it);
  }, [items, q]);

  useEffect(() => setSel(0), [q]);
  useEffect(() => {
    list.current?.querySelector(`[data-idx="${sel}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [sel]);

  if (!open) return null;
  const run = (it?: Item) => {
    if (!it) return;
    setOpen(false);
    it.run();
  };
  let lastGroup = '';

  return (
    <div className="fixed inset-0 z-[60] flex items-start justify-center bg-black/30 px-4 pt-[12vh] backdrop-blur-[2px]" onMouseDown={() => setOpen(false)}>
      <div
        role="dialog"
        aria-label="Command palette"
        onMouseDown={(e) => e.stopPropagation()}
        className="animate-fade-up w-full max-w-xl overflow-hidden rounded-2xl border border-line bg-bg shadow-lift"
      >
        <div className="flex items-center gap-3 border-b border-line px-4">
          <Search className="h-4 w-4 text-ink-3" />
          <input
            ref={input}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') (e.preventDefault(), setSel((s) => Math.min(s + 1, results.length - 1)));
              else if (e.key === 'ArrowUp') (e.preventDefault(), setSel((s) => Math.max(s - 1, 0)));
              else if (e.key === 'Enter') (e.preventDefault(), run(results[sel]));
              else if (e.key === 'Escape') setOpen(false);
            }}
            placeholder="Search chats, dashboards, reports… or type a command"
            className="h-14 flex-1 bg-transparent text-[15px] outline-none placeholder:text-ink-3"
          />
          <kbd className="rounded-md border border-line px-1.5 py-0.5 text-[10px] text-ink-3">esc</kbd>
        </div>
        <div ref={list} className="max-h-[56vh] overflow-y-auto p-2">
          {!results.length && <p className="px-3 py-8 text-center text-sm text-ink-3">No matches for “{q}”</p>}
          {results.map((it, i) => {
            const header = it.group !== lastGroup ? it.group : null;
            lastGroup = it.group;
            return (
              <div key={it.id}>
                {header && <div className="px-3 pb-1 pt-3 text-[11px] font-semibold uppercase tracking-wider text-ink-3 first:pt-1">{header}</div>}
                <button
                  data-idx={i}
                  onMouseMove={() => setSel(i)}
                  onClick={() => run(it)}
                  className={clsx('flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm', i === sel ? 'bg-accent-soft text-ink' : 'text-ink-2')}
                >
                  <it.icon className={clsx('h-4 w-4 shrink-0', i === sel ? 'text-accent' : 'text-ink-3')} />
                  <span className="min-w-0 flex-1 truncate">{it.label}</span>
                  {it.hint && <span className="max-w-[40%] truncate text-xs text-ink-3">{it.hint}</span>}
                  {i === sel && <CornerDownLeft className="h-3.5 w-3.5 text-ink-3" />}
                </button>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
