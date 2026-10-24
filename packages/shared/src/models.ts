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
  /** For workflows: who built it. */
  owner?: string;
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

export type ArtifactType = 'chart' | 'table' | 'answer' | 'report';

/** "Agent" id meaning: let the app choose the agent(s) for each task. */
export const AUTO_AGENT_ID = 'auto';

/** One researched sub-question of a deep-research report; cited as [n]. */
export interface ResearchFinding {
  n: number;
  question: string;
  agentId: string;
  text: string;
  sql?: string;
  table?: TableData;
  spec?: Record<string, unknown>;
  error?: string;
}

export interface Artifact {
  id: string;
  userId: string;
  type: ArtifactType;
  title: string;
  description?: string;
  spec?: Record<string, unknown>;
  table?: TableData;
  text?: string;
  /** answer: the full message blocks; report: the findings behind each [n] citation. */
  blocks?: ContentBlock[];
  findings?: ResearchFinding[];
  question?: string;
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

export interface Permissions {
  /** Create, edit, publish and delete workflows. Running published workflows is open to everyone. */
  buildWorkflows: boolean;
}

export interface Me {
  user: User;
  settings: UserSettings;
  permissions: Permissions;
  mode: { cortexMock: boolean; authMode: 'oauth' | 'dev' | 'spcs' };
}

export interface DashboardItem {
  artifactId: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Dashboard {
  id: string;
  userId: string;
  title: string;
  description?: string;
  items: DashboardItem[];
  sharedWith?: string[];
  createdAt: string;
  updatedAt: string;
}

export type AutomationTargetKind = 'agent' | 'workflow' | 'research';

export interface Automation {
  id: string;
  userId: string;
  ownerName?: string;
  name: string;
  prompt: string;
  target: { kind: AutomationTargetKind; agentId: string };
  /** 5-field cron, evaluated in `timezone`. */
  schedule: { cron: string; timezone: string };
  email?: { enabled: boolean; to: string[] };
  enabled: boolean;
  nextRunAt?: string;
  lastRunAt?: string;
  lastStatus?: AutomationRunStatus;
  createdAt: string;
  updatedAt: string;
}

export type AutomationRunStatus = 'running' | 'success' | 'error' | 'missed';

export interface AutomationRun {
  id: string;
  userId: string;
  automationId: string;
  status: AutomationRunStatus;
  trigger: 'schedule' | 'manual';
  startedAt: string;
  finishedAt?: string;
  artifactId?: string;
  emailed?: boolean;
  error?: string;
  createdAt: string;
  updatedAt: string;
}

/** What the chat proposes when someone asks to schedule something; created only after confirmation. */
export interface AutomationProposal {
  name: string;
  prompt: string;
  target: Automation['target'];
  schedule: Automation['schedule'];
  email: { enabled: boolean; to: string[] };
  summary: string;
}
