'use client';

import { useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import {
  Bookmark,
  LogOut,
  Moon,
  MoreHorizontal,
  PanelLeftClose,
  Pencil,
  Pin,
  PinOff,
  Plus,
  Search,
  Settings,
  Snowflake,
  Sun,
  Trash2,
  Wand2,
} from 'lucide-react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { Thread } from '@cowork/shared';
import { api } from '@/lib/api';
import { useMe, useThreads } from '@/lib/hooks';
import { useTheme } from '@/lib/theme';
import { IconButton } from './ui';

function bucket(t: Thread): string {
  if (t.pinned) return 'Pinned';
  const days = (Date.now() - new Date(t.updatedAt).getTime()) / 86400_000;
  if (days < 1) return 'Today';
  if (days < 7) return 'Previous 7 days';
  if (days < 30) return 'Previous 30 days';
  return 'Older';
}

export function Sidebar({ onCollapse }: { onCollapse: () => void }) {
  const { data: me } = useMe();
  const { data: threads = [] } = useThreads();
  const [q, setQ] = useState('');
  const pathname = usePathname();
  const router = useRouter();
  const qc = useQueryClient();
  const { dark, setMode } = useTheme();

  const groups = useMemo(() => {
    const filtered = threads.filter((t) => t.title.toLowerCase().includes(q.toLowerCase()));
    const out = new Map<string, Thread[]>();
    for (const t of filtered) out.set(bucket(t), [...(out.get(bucket(t)) ?? []), t]);
    return [...out.entries()];
  }, [threads, q]);

  const nav = [
    { href: '/artifacts', label: 'Artifacts', icon: Bookmark },
    { href: '/skills', label: 'Skills', icon: Wand2 },
    { href: '/settings', label: 'Settings', icon: Settings },
  ];

  return (
    <aside className="flex h-full w-64 shrink-0 flex-col border-r border-line bg-sidebar">
      <div className="flex items-center justify-between px-3 pb-2 pt-3">
        <Link href="/" className="flex items-center gap-2 px-1 text-sm font-semibold">
          <Snowflake className="h-5 w-5 text-accent" />
          CoWork
        </Link>
        <IconButton label="Collapse sidebar" onClick={onCollapse}>
          <PanelLeftClose className="h-4 w-4" />
        </IconButton>
      </div>
      <div className="space-y-0.5 px-2">
        <Link href="/" className="flex h-9 items-center gap-2 rounded-lg px-2 text-sm font-medium hover:bg-raised">
          <Plus className="h-4 w-4" /> New chat
        </Link>
        {nav.map((n) => (
          <Link
            key={n.href}
            href={n.href}
            className={clsx('flex h-9 items-center gap-2 rounded-lg px-2 text-sm hover:bg-raised', pathname.startsWith(n.href) ? 'bg-raised font-medium' : 'text-ink-2')}
          >
            <n.icon className="h-4 w-4" /> {n.label}
          </Link>
        ))}
      </div>
      <div className="mx-2 mt-3 flex items-center gap-2 rounded-lg border border-line bg-bg px-2">
        <Search className="h-3.5 w-3.5 text-ink-3" />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search chats" className="h-8 flex-1 bg-transparent text-sm outline-none placeholder:text-ink-3" />
      </div>
      <div className="mt-2 flex-1 overflow-y-auto px-2 pb-2">
        {groups.map(([label, items]) => (
          <div key={label} className="mt-3">
            <div className="px-2 pb-1 text-[11px] font-medium uppercase tracking-wide text-ink-3">{label}</div>
            {items.map((t) => (
              <ThreadItem
                key={t.id}
                thread={t}
                active={pathname === `/c/${t.id}`}
                onChanged={() => qc.invalidateQueries({ queryKey: ['threads'] })}
                onDeleted={() => {
                  qc.invalidateQueries({ queryKey: ['threads'] });
                  if (pathname === `/c/${t.id}`) router.push('/');
                }}
              />
            ))}
          </div>
        ))}
        {!threads.length && <p className="px-2 pt-4 text-xs text-ink-3">Your conversations will appear here.</p>}
      </div>
      <div className="flex items-center gap-2 border-t border-line p-3">
        <div className="flex h-8 w-8 items-center justify-center rounded-full bg-accent text-xs font-semibold text-accent-ink">
          {(me?.user.name ?? '?').slice(0, 1).toUpperCase()}
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium">{me?.user.displayName ?? me?.user.name}</div>
          <div className="truncate text-[11px] text-ink-3">
            {me?.user.role} · {me?.user.warehouse}
          </div>
        </div>
        <IconButton label={dark ? 'Light mode' : 'Dark mode'} onClick={() => setMode(dark ? 'light' : 'dark')}>
          {dark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
        </IconButton>
        {me?.mode.authMode !== 'spcs' && <IconButton
          label="Sign out"
          onClick={async () => {
            await api('/auth/logout', { method: 'POST' });
            location.href = '/login';
          }}
        >
          <LogOut className="h-4 w-4" />
        </IconButton>}
      </div>
    </aside>
  );
}

function ThreadItem({ thread, active, onChanged, onDeleted }: { thread: Thread; active: boolean; onChanged: () => void; onDeleted: () => void }) {
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
    <div ref={ref} className={clsx('group relative flex items-center rounded-lg', active ? 'bg-raised' : 'hover:bg-raised')}>
      <Link href={`/c/${thread.id}`} className="h-8 flex-1 truncate px-2 text-sm leading-8">
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
