import type { ContentBlock } from './blocks';
import type { TableData } from './events';

export interface User {
  id: string;
  name: string;
  displayName?: string;
  role?: string;
  warehouse?: string;
}

export interface AgentInfo {
  /** Fully qualified: DB.SCHEMA.NAME */
  id: string;
  database: string;
  schema: string;
  name: string;
  displayName: string;
  description?: string;
  sampleQuestions: string[];
  kind: 'agent' | 'workflow';
}

export interface Thread {
  id: string;
  userId: string;
  title: string;
  agentId: string;
  cortexThreadId?: number;
  /** Cortex assistant message_id to pass as parent_message_id on the next turn */
  lastCortexMessageId?: number;
  pinned?: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface Message {
  id: string;
  threadId: string;
  role: 'user' | 'assistant';
  content: ContentBlock[];
  feedback?: 'up' | 'down' | null;
  feedbackNote?: string;
  createdAt: string;
}

export type ArtifactType = 'chart' | 'table' | 'answer';

export interface Artifact {
  id: string;
  userId: string;
  type: ArtifactType;
  title: string;
  description?: string;
  spec?: Record<string, unknown>;
  table?: TableData;
  text?: string;
  sql?: string;
  queryId?: string;
  agentId?: string;
  threadId?: string;
  messageId?: string;
  sharedWith?: string[];
  refreshedAt?: string;
  createdAt: string;
  updatedAt: string;
}

export type MemoryCategory = 'preference' | 'fact' | 'role' | 'goal' | 'other';

export interface Memory {
  id: string;
  userId: string;
  text: string;
  category: MemoryCategory;
  source: 'auto' | 'manual';
  threadId?: string;
  embedding?: number[];
  createdAt: string;
  updatedAt: string;
}

export interface Skill {
  id: string;
  userId: string;
  /** invoked as /name */
  name: string;
  description?: string;
  prompt: string;
  agentId?: string;
  createdAt: string;
  updatedAt: string;
}

export interface UserSettings {
  memoryEnabled: boolean;
  defaultAgentId?: string;
  autoChart: boolean;
}

export interface Me {
  user: User;
  settings: UserSettings;
  mode: { cortexMock: boolean; authMode: 'oauth' | 'dev' | 'spcs' };
}
