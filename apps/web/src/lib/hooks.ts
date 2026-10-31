'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { AgentInfo, Artifact, Automation, AutomationRun, Dashboard, Me, Memory, Message, Pin, Skill, Thread, UserSettings, Workflow } from '@cowork/shared';
import { api } from './api';

export const useMe = () => useQuery({ queryKey: ['me'], queryFn: () => api<Me>('/auth/me'), retry: false });

export const useAgents = () =>
  useQuery({ queryKey: ['agents'], queryFn: () => api<AgentInfo[]>('/agents'), staleTime: 5 * 60_000 });

export const useThreads = () => useQuery({ queryKey: ['threads'], queryFn: () => api<Thread[]>('/threads') });

export const useThread = (id?: string) =>
  useQuery({
    queryKey: ['thread', id],
    queryFn: () => api<{ thread: Thread; messages: Message[] }>(`/threads/${id}`),
    enabled: !!id,
  });

export const useArtifacts = () => useQuery({ queryKey: ['artifacts'], queryFn: () => api<Artifact[]>('/artifacts') });

export const useArtifact = (id: string) =>
  useQuery({ queryKey: ['artifact', id], queryFn: () => api<Artifact>(`/artifacts/${id}`) });

export const useMemories = () => useQuery({ queryKey: ['memories'], queryFn: () => api<Memory[]>('/memories') });

export const useSkills = () => useQuery({ queryKey: ['skills'], queryFn: () => api<Skill[]>('/skills') });

export function useUpdateSettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (patch: Partial<UserSettings>) => api<UserSettings>('/auth/settings', { method: 'PATCH', json: patch }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['me'] }),
  });
}

export function useSaveArtifact() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (a: Partial<Artifact>) => api<Artifact>('/artifacts', { method: 'POST', json: a }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['artifacts'] }),
  });
}

export const useWorkflows = () => useQuery({ queryKey: ['workflows'], queryFn: () => api<Workflow[]>('/workflows') });

export const useWorkflow = (id: string) =>
  useQuery({ queryKey: ['workflow', id], queryFn: () => api<Workflow>(`/workflows/${id}`) });

export const useDashboards = () => useQuery({ queryKey: ['dashboards'], queryFn: () => api<Dashboard[]>('/dashboards') });

export const useDashboard = (id: string) =>
  useQuery({ queryKey: ['dashboard', id], queryFn: () => api<{ dashboard: Dashboard; artifacts: Artifact[] }>(`/dashboards/${id}`) });

export const useAutomations = () =>
  useQuery({ queryKey: ['automations'], queryFn: () => api<Automation[]>('/automations'), refetchInterval: 30_000 });

export const useAutomationRuns = (id?: string) =>
  useQuery({ queryKey: ['automation-runs', id], queryFn: () => api<AutomationRun[]>(`/automations/${id}/runs`), enabled: !!id, refetchInterval: 15_000 });

const DEFAULT_PREFS: UserSettings = { memoryEnabled: true, autoChart: true, responseStyle: 'balanced', numberFormat: 'international', currency: 'USD', accent: 'snow', pins: [] };

/** The signed-in user's preferences (number format, currency, pins, …) with defaults. */
export function usePrefs(): UserSettings {
  const { data } = useMe();
  return data?.settings ?? DEFAULT_PREFS;
}

export function useTogglePin() {
  const prefs = usePrefs();
  const update = useUpdateSettings();
  const pins = prefs.pins ?? [];
  return {
    isPinned: (id: string) => pins.some((p) => p.id === id),
    toggle: (pin: Pin) => update.mutate({ pins: pins.some((p) => p.id === pin.id) ? pins.filter((p) => p.id !== pin.id) : [pin, ...pins] }),
  };
}
