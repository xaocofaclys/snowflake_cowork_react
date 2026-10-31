'use client';

import { Menu, PanelLeftOpen, Plus } from 'lucide-react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState, type ReactNode } from 'react';
import { CommandPalette } from '@/components/CommandPalette';
import { LogoMark } from '@/components/Logo';
import { Sidebar } from '@/components/Sidebar';
import { IconButton } from '@/components/ui';
import { Welcome } from '@/components/Welcome';
import { useMe } from '@/lib/hooks';
import { useUi } from '@/lib/ui-store';

export default function AppLayout({ children }: { children: ReactNode }) {
  const { data: me, isLoading, error } = useMe();
  const router = useRouter();
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(false);
  const drawer = useUi((s) => s.drawer);
  const setDrawer = useUi((s) => s.setDrawer);

  useEffect(() => {
    if (error) router.replace('/login');
  }, [error, router]);

  // The user's accent follows their settings (cached locally so the next load paints in it).
  const accent = me?.settings.accent ?? 'snow';
  useEffect(() => {
    document.documentElement.dataset.accent = accent;
    try {
      localStorage.setItem('accent', accent);
    } catch {
      /* storage unavailable */
    }
  }, [accent]);

  useEffect(() => setDrawer(false), [pathname, setDrawer]);

  if (isLoading || !me) {
    return (
      <div className="flex h-screen flex-col items-center justify-center gap-4">
        <LogoMark size={40} className="animate-pulse" />
      </div>
    );
  }

  return (
    <div className="flex h-screen overflow-hidden bg-bg">
      {/* Desktop sidebar */}
      {!collapsed && (
        <div className="hidden md:flex">
          <Sidebar onCollapse={() => setCollapsed(true)} />
        </div>
      )}
      {/* Mobile drawer */}
      {drawer && (
        <div className="fixed inset-0 z-50 flex md:hidden">
          <div className="animate-fade-up h-full">
            <Sidebar onNavigate={() => setDrawer(false)} />
          </div>
          <button aria-label="Close menu" className="flex-1 bg-black/40" onClick={() => setDrawer(false)} />
        </div>
      )}
      <main className="relative flex min-w-0 flex-1 flex-col">
        {/* Mobile top bar */}
        <div className="no-print flex h-12 shrink-0 items-center gap-2 border-b border-line px-3 md:hidden">
          <IconButton label="Open menu" onClick={() => setDrawer(true)}>
            <Menu className="h-4 w-4" />
          </IconButton>
          <LogoMark size={20} />
          <Link href="/" className="ml-auto" aria-label="New chat">
            <IconButton label="New chat">
              <Plus className="h-4 w-4" />
            </IconButton>
          </Link>
        </div>
        {collapsed && (
          <IconButton label="Open sidebar" onClick={() => setCollapsed(false)} className="absolute left-3 top-3 z-10 hidden md:inline-flex">
            <PanelLeftOpen className="h-4 w-4" />
          </IconButton>
        )}
        <div className="min-h-0 flex-1">{children}</div>
      </main>
      <CommandPalette />
      <Welcome />
    </div>
  );
}
