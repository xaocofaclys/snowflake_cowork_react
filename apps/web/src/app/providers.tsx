'use client';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useEffect, useState, type ReactNode } from 'react';
import { useTheme } from '@/lib/theme';

export function Providers({ children }: { children: ReactNode }) {
  const [qc] = useState(() => new QueryClient({ defaultOptions: { queries: { refetchOnWindowFocus: false, staleTime: 10_000 } } }));
  useEffect(() => useTheme.getState().init(), []);
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}
