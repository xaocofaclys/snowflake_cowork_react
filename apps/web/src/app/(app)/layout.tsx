'use client';

import { PanelLeftOpen } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useEffect, useState, type ReactNode } from 'react';
import { Sidebar } from '@/components/Sidebar';
import { IconButton, Spinner } from '@/components/ui';
import { useMe } from '@/lib/hooks';

export default function AppLayout({ children }: { children: ReactNode }) {
  const { data: me, isLoading, error } = useMe();
  const router = useRouter();
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    if (error) router.replace('/login');
  }, [error, router]);

  if (isLoading || !me) {
    return (
      <div className="flex h-screen items-center justify-center text-ink-3">
        <Spinner />
      </div>
    );
  }

  return (
    <div className="flex h-screen overflow-hidden">
      {!collapsed && <Sidebar onCollapse={() => setCollapsed(true)} />}
      <main className="relative min-w-0 flex-1">
        {collapsed && (
          <IconButton label="Open sidebar" onClick={() => setCollapsed(false)} className="absolute left-3 top-3 z-10">
            <PanelLeftOpen className="h-4 w-4" />
          </IconButton>
        )}
        {children}
      </main>
    </div>
  );
}
