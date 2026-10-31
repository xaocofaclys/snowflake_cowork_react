import type { AutomationProposal } from './models';
/**
 * Normalized stream events. The API converts raw Cortex Agents SSE events
 * (response.text.delta, response.chart, response.table, ...) into these and
 * forwards them to the browser, so both sides speak one vocabulary.
 */

export interface Column {
  name: string;
  /** Snowflake type name, lowercased: fixed, real, text, date, timestamp_ntz, boolean, ... */
  type: string;
}

export interface TableData {
  columns: Column[];
  rows: unknown[][];
}

export interface Annotation {
  type: string;
  index?: number;
  title?: string;
  url?: string;
  text?: string;
  docId?: string;
}

export type StreamEvent =
  | { type: 'status'; status: string; message: string }
  | { type: 'thinking_delta'; index: number; text: string }
  | { type: 'thinking'; index: number; text: string }
  | { type: 'text_delta'; index: number; text: string }
  | { type: 'text'; index: number; text: string; annotations?: Annotation[] }
  | { type: 'annotation'; index: number; annotation: Annotation }
  | {
      type: 'tool_use';
      index: number;
      toolUseId: string;
      toolType: string;
      name: string;
      input: unknown;
    }
  | {
      type: 'tool_result';
      index: number;
      toolUseId: string;
      toolType: string;
      name: string;
      status: string;
      sql?: string;
      sqlExplanation?: string;
      text?: string;
    }
  | { type: 'tool_status'; toolUseId: string; status: string; message: string }
  | {
      type: 'table';
      index: number;
      toolUseId: string;
      queryId?: string;
      title?: string;
      table: TableData;
    }
  | {
      type: 'chart';
      index: number;
      toolUseId: string;
      spec: Record<string, unknown>;
      /** true when the API synthesized the chart because Cortex returned only a table */
      generated?: boolean;
    }
  | { type: 'map'; index: number; toolUseId: string; spec: Record<string, unknown> }
  | { type: 'warning'; message: string; code?: string }
  | { type: 'error'; message: string; code?: string }
  | { type: 'metadata'; role: 'user' | 'assistant'; messageId: number; runId?: string }
  /** Workflow runs: per-node progress; inner agent events are wrapped in node_event. */
  | { type: 'node_start'; nodeId: string; run: number; label: string; kind: string; input?: string }
  | { type: 'node_event'; nodeId: string; run: number; event: StreamEvent }
  | {
      type: 'node_end';
      nodeId: string;
      run: number;
      status: 'success' | 'error' | 'skipped';
      output?: string;
      decision?: string;
      error?: string;
    }
  /** App-level events */
  | { type: 'thread'; threadId: string; title?: string }
  | { type: 'memory'; saved: string[] }
  /** A deliverable was saved (e.g. a deep-research report). */
  | { type: 'artifact'; artifactId: string; title: string; kind: string }
  /** The user asked (in chat) to schedule something: a confirmation card, nothing created yet. */
  | { type: 'automation_proposal'; proposal: AutomationProposal }
  /** Suggested next questions for this answer. */
  | { type: 'suggestions'; items: string[] }
  | { type: 'done'; messageId: string };

export type StreamEventType = StreamEvent['type'];
