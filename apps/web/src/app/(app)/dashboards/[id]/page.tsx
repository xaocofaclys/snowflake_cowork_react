'use client';

import { use } from 'react';
import { DashboardView } from '@/components/dashboard/DashboardView';
import { Spinner } from '@/components/ui';
import { useDashboard } from '@/lib/hooks';

export default function DashboardPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { data, isLoading, error } = useDashboard(id);
  if (isLoading) return <Spinner className="mx-auto mt-20" />;
  if (error || !data) return <p className="p-8 text-sm text-danger">{(error as Error)?.message ?? 'Dashboard not found'}</p>;
  return <DashboardView key={data.dashboard.id} dashboard={data.dashboard} initialArtifacts={data.artifacts} />;
}
