'use client';

import { use } from 'react';
import { Spinner } from '@/components/ui';
import { WorkflowEditor } from '@/components/workflow/WorkflowEditor';
import { useWorkflow } from '@/lib/hooks';

export default function WorkflowPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { data, error, isLoading } = useWorkflow(id);
  if (isLoading) return <Spinner className="mx-auto mt-20" />;
  if (error || !data) return <p className="p-8 text-sm text-danger">{(error as Error)?.message ?? 'Workflow not found'}</p>;
  return <WorkflowEditor key={data.id} workflow={data} />;
}
