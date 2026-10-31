'use client';

import { useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import {
  Bookmark,
  CalendarClock,
  ChevronsUpDown,
  House,
  LogOut,
  Monitor,
  Moon,
  MoreHorizontal,
  PanelLeftClose,
  Pencil,
  Pin,
  PinOff,
  Plus,
  Search,
  Settings,
  Sun,
  Trash2,
  Wand2,
  Workflow,
} from 'lucide-react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { Thread } from '@cowork/shared';
import { api } from '@/lib/api';
import { useMe, useThreads } from '@/lib/hooks';
import { useTheme } from '@/lib/theme';
import { useUi } from '@/lib/ui-store';
import { Logo } from './Logo';
import { IconButton } from './ui';

function bucket(t: Thread): string {
  if (t.pinned) return 'Pinned';
  const days = (Date.now() - new Date(t.updatedAt).getTime()) / 86400_000;
  if (days < 1) return 'Today';
  if (days < 7) return 'Previous 7 days';
  if (days < 30) return 'Previous 30 days';
  return 'Older';
}

export function Sidebar({ onCollapse, onNavigate }: { onCollapse?: () => void; onNavigate?: () => void }) {
  const { data: me } = useMe();
  const { data: threads = [] } = useThreads();
  const [q, setQ] = useState('');
  const [menu, setMenu] = useState(false);
  const pathname = usePathname();
  const router = useRouter();
  const qc = useQueryClient();
  const { mode, setMode } = useTheme();
  const setPalette = useUi((s) => s.setPalette);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const h = (e: MouseEvent) => menuRef.current && !menuRef.current.contains(e.target as Node) && setMenu(false);
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, []);

  const groups = useMemo(() => {
    const filtered = threads.filter((t) => t.title.toLowerCase().includes(q.toLowerCase()));
    const out = new Map<string, Thread[]>();
    for (const t of filtered) out.set(bucket(t), [...(out.get(bucket(t)) ?? []), t]);
    return [...out.entries()];
  }, [threads, q]);

  const nav = [
    { href: '/', label: 'Home', icon: House, exact: true },
    { href: '/artifacts', label: 'Artifacts', icon: Bookmark },
    { href: '/workflows', label: 'Workflows', icon: Workflow },
    { href: '/automations', label: 'Automations', icon: CalendarClock },
    { href: '/skills', label: 'Skills', icon: Wand2 },
  ];
  const isMac = typeof navigator !== 'undefined' && /Mac/.test(navigator.platform);
  const name = me?.user.displayName ?? me?.user.name ?? '';

  return (
    <aside className="no-print flex h-full w-[264px] shrink-0 flex-col border-r border-line bg-sidebar">
      <div className="flex items-center justify-between px-4 pb-3 pt-4">
        <Link href="/" onClick={onNavigate} aria-label="Home">
          <Logo />
        </Link>
        {onCollapse && (
          <IconButton label="Collapse sidebar" onClick={onCollapse}>
            <PanelLeftClose className="h-4 w-4" />
          </IconButton>
        )}
      </div>
      <div className="space-y-1.5 px-3">
        <Link
          href="/"
          onClick={onNavigate}
          className="bg-brand flex h-10 items-center justify-center gap-2 rounded-xl text-sm font-medium text-white shadow-soft transition hover:opacity-95"
        >
          <Plus className="h-4 w-4" /> New chat
        </Link>
        <button
          onClick={() => setPalette(true)}
          className="flex h-9 w-full items-center gap-2 rounded-xl border border-line bg-bg px-3 text-sm text-ink-3 transition hover:border-ink-3/40 hover:text-ink-2"
        >
          <Search className="h-3.5 w-3.5" />
          <span className="flex-1 text-left">Search or jump to…</span>
          <kbd className="rounded-md border border-line bg-sidebar px-1.5 py-0.5 font-sans text-[10px]">{isMac ? '⌘' : 'Ctrl'} K</kbd>
        </button>
      </div>
      <nav className="mt-3 space-y-0.5 px-3">
        {nav.map((n) => {
          const active = n.exact ? pathname === n.href : pathname.startsWith(n.href);
          return (
            <Link
              key={n.href}
              href={n.href}
              onClick={onNavigate}
              className={clsx(
                'group relative flex h-9 items-center gap-2.5 rounded-lg px-2.5 text-sm transition',
                active ? 'bg-bg font-medium text-ink shadow-soft' : 'text-ink-2 hover:bg-raised hover:text-ink',
              )}
            >
              {active && <span className="bg-brand absolute left-0 top-2 h-5 w-[3px] rounded-r-full" />}
              <n.icon className={clsx('h-4 w-4', active ? 'text-accent' : 'text-ink-3 group-hover:text-ink-2')} /> {n.label}
            </Link>
          );
        })}
      </nav>
      <div className="mx-3 mt-4 flex items-center gap-2 border-t border-line pt-3">
        <span className="flex-1 text-[11px] font-semibold uppercase tracking-wider text-ink-3">Chats</span>
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Filter"
          aria-label="Filter chats"
          className="h-6 w-24 rounded-md bg-transparent px-1.5 text-xs outline-none placeholder:text-ink-3 focus:bg-bg"
        />
      </div>
      <div className="flex-1 overflow-y-auto px-3 pb-2">
        {groups.map(([label, items]) => (
          <div key={label} className="mt-2">
            <div className="px-2 pb-1 pt-1 text-[11px] text-ink-3">{label}</div>
            {items.map((t) => (
              <ThreadItem
                key={t.id}
                thread={t}
                active={pathname === `/c/${t.id}`}
                onNavigate={onNavigate}
                onChanged={() => qc.invalidateQueries({ queryKey: ['threads'] })}
                onDeleted={() => {
                  qc.invalidateQueries({ queryKey: ['threads'] });
                  if (pathname === `/c/${t.id}`) router.push('/');
                }}
              />
            ))}
          </div>
        ))}
        {!threads.length && <p className="px-2 pt-3 text-xs leading-relaxed text-ink-3">Your conversations will appear here. Start with a question on the Home page.</p>}
      </div>
      <div ref={menuRef} className="relative border-t border-line p-3">
        {menu && (
          <div className="animate-fade-up absolute bottom-full left-3 right-3 mb-2 rounded-xl border border-line bg-bg p-1 text-sm shadow-lift">
            <Link href="/settings" onClick={() => (setMenu(false), onNavigate?.())} className="flex items-center gap-2 rounded-lg px-2.5 py-2 hover:bg-raised">
              <Settings className="h-4 w-4 text-ink-3" /> Settings
            </Link>
            <div className="flex items-center gap-1 rounded-lg px-2.5 py-1.5">
              <span className="flex-1 text-ink-2">Theme</span>
              {([['light', Sun], ['dark', Moon], ['system', Monitor]] as const).map(([m, Icon]) => (
                <button
                  key={m}
                  aria-label={`${m} theme`}
                  onClick={() => setMode(m)}
                  className={clsx('rounded-md p-1.5', mode === m ? 'bg-accent-soft text-accent' : 'text-ink-3 hover:bg-raised')}
                >
                  <Icon className="h-3.5 w-3.5" />
                </button>
              ))}
            </div>
            {me?.mode.authMode !== 'spcs' && (
              <button
                onClick={async () => {
                  await api('/auth/logout', { method: 'POST' });
                  location.href = '/login';
                }}
                className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left hover:bg-raised"
              >
                <LogOut className="h-4 w-4 text-ink-3" /> Sign out
              </button>
            )}
          </div>
        )}
        <button onClick={() => setMenu((m) => !m)} className="flex w-full items-center gap-2.5 rounded-xl p-1.5 text-left transition hover:bg-raised">
          <span className="bg-brand flex h-8 w-8 items-center justify-center rounded-full text-xs font-semibold text-white">{(name || '?').slice(0, 1).toUpperCase()}</span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-medium">{name}</span>
            <span className="block truncate text-[11px] text-ink-3">
              {me?.user.role} · {me?.user.warehouse}
            </span>
          </span>
          <ChevronsUpDown className="h-3.5 w-3.5 text-ink-3" />
        </button>
      </div>
    </aside>
  );
}

function ThreadItem({ thread, active, onChanged, onDeleted, onNavigate }: { thread: Thread; active: boolean; onChanged: () => void; onDeleted: () => void; onNavigate?: () => void }) {
  const [menu, setMenu] = useState(false);
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(thread.title);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const h = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setMenu(false);
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, []);

  const patch = async (p: Partial<Thread>) => {
    await api(`/threads/${thread.id}`, { method: 'PATCH', json: p });
    onChanged();
  };

  if (editing) {
    return (
      <input
        autoFocus
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        onBlur={() => {
          setEditing(false);
          if (title.trim() && title !== thread.title) patch({ title: title.trim() });
        }}
        onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
        className="h-8 w-full rounded-lg border border-accent bg-bg px-2 text-sm outline-none"
      />
    );
  }

  return (
    <div ref={ref} className={clsx('group relative flex items-center rounded-lg transition', active ? 'bg-bg text-ink shadow-soft' : 'text-ink-2 hover:bg-raised hover:text-ink')}>
      <Link href={`/c/${thread.id}`} onClick={onNavigate} className="h-8 flex-1 truncate px-2 text-[13px] leading-8">
        {thread.title}
      </Link>
      <button
        aria-label="Chat options"
        onClick={() => setMenu((m) => !m)}
        className={clsx('mr-1 rounded p-1 text-ink-3 hover:text-ink', menu ? 'opacity-100' : 'opacity-0 group-hover:opacity-100')}
      >
        <MoreHorizontal className="h-4 w-4" />
      </button>
      {menu && (
        <div className="absolute right-0 top-full z-30 mt-1 w-40 rounded-lg border border-line bg-bg p-1 text-sm shadow-lg">
          <MenuItem icon={Pencil} label="Rename" onClick={() => (setMenu(false), setEditing(true))} />
          <MenuItem icon={thread.pinned ? PinOff : Pin} label={thread.pinned ? 'Unpin' : 'Pin'} onClick={() => (setMenu(false), patch({ pinned: !thread.pinned }))} />
          <MenuItem
            icon={Trash2}
            label="Delete"
            danger
            onClick={async () => {
              setMenu(false);
              if (!confirm('Delete this chat?')) return;
              await api(`/threads/${thread.id}`, { method: 'DELETE' });
              onDeleted();
            }}
          />
        </div>
      )}
    </div>
  );
}

function MenuItem({ icon: Icon, label, onClick, danger }: { icon: typeof Pin; label: string; onClick: () => void; danger?: boolean }) {
  return (
    <button onClick={onClick} className={clsx('flex w-full items-center gap-2 rounded-md px-2 py-1.5 hover:bg-raised', danger && 'text-danger')}>
      <Icon className="h-3.5 w-3.5" /> {label}
    </button>
  );
}
