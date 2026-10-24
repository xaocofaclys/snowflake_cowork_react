'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { AgentInfo, Artifact, Me, Memory, Message, Skill, Thread, UserSettings } from '@cowork/shared';
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
