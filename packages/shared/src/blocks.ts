import type { Annotation, StreamEvent, TableData } from './events';

/** Ordered content blocks that make up a persisted assistant message. */
export type ContentBlock =
  | { type: 'steps'; steps: { status: string; message: string }[] }
  | { type: 'thinking'; text: string }
  | { type: 'text'; text: string; annotations?: Annotation[] }
  | {
      type: 'tool';
      toolUseId: string;
      toolType: string;
      name: string;
      input?: unknown;
      status: 'running' | 'success' | 'error' | string;
      sql?: string;
      sqlExplanation?: string;
    }
  | {
      type: 'table';
      id: string;
      toolUseId: string;
      title?: string;
      queryId?: string;
      sql?: string;
      table: TableData;
    }
  | {
      type: 'chart';
      id: string;
      toolUseId: string;
      spec: Record<string, unknown>;
      generated?: boolean;
      sql?: string;
      queryId?: string;
    }
  | { type: 'map'; id: string; toolUseId: string; spec: Record<string, unknown> }
  | { type: 'error'; message: string };

export type BlockOf<T extends ContentBlock['type']> = Extract<ContentBlock, { type: T }>;

/**
 * Folds a stream of events into ordered content blocks. Used by the API to
 * persist messages and by the browser to render the live stream, so a
 * reloaded thread looks exactly like the streamed one.
 */
export class BlockBuilder {
  readonly blocks: ContentBlock[] = [];
  private keyed = new Map<string, ContentBlock>();
  private sqlByTool = new Map<string, { sql?: string; queryId?: string }>();
  private seq = 0;

  get userMessageId(): number | undefined {
    return this._userMessageId;
  }
  get assistantMessageId(): number | undefined {
    return this._assistantMessageId;
  }
  private _userMessageId?: number;
  private _assistantMessageId?: number;

  constructor(initial?: ContentBlock[]) {
    if (initial) this.blocks.push(...initial);
  }

  add(ev: StreamEvent): void {
    switch (ev.type) {
      case 'status': {
        const steps = this.upsert('steps', () => ({ type: 'steps', steps: [] })) as BlockOf<'steps'>;
        const last = steps.steps[steps.steps.length - 1];
        if (!last || last.message !== ev.message) steps.steps.push({ status: ev.status, message: ev.message });
        break;
      }
      case 'thinking_delta': {
        const b = this.upsert(`thinking:${ev.index}`, () => ({ type: 'thinking', text: '' })) as BlockOf<'thinking'>;
        b.text += ev.text;
        break;
      }
      case 'thinking': {
        const b = this.upsert(`thinking:${ev.index}`, () => ({ type: 'thinking', text: '' })) as BlockOf<'thinking'>;
        b.text = ev.text;
        break;
      }
      case 'text_delta': {
        const b = this.upsert(`text:${ev.index}`, () => ({ type: 'text', text: '' })) as BlockOf<'text'>;
        b.text += ev.text;
        break;
      }
      case 'text': {
        const b = this.upsert(`text:${ev.index}`, () => ({ type: 'text', text: '' })) as BlockOf<'text'>;
        b.text = ev.text;
        if (ev.annotations?.length) b.annotations = ev.annotations;
        break;
      }
      case 'annotation': {
        const b = this.upsert(`text:${ev.index}`, () => ({ type: 'text', text: '' })) as BlockOf<'text'>;
        (b.annotations ??= []).push(ev.annotation);
        break;
      }
      case 'tool_use': {
        this.upsert(`tool:${ev.toolUseId}`, () => ({
          type: 'tool',
          toolUseId: ev.toolUseId,
          toolType: ev.toolType,
          name: ev.name,
          input: ev.input,
          status: 'running',
        }));
        break;
      }
      case 'tool_result': {
        const b = this.upsert(`tool:${ev.toolUseId}`, () => ({
          type: 'tool',
          toolUseId: ev.toolUseId,
          toolType: ev.toolType,
          name: ev.name,
          status: 'running',
        })) as BlockOf<'tool'>;
        b.status = ev.status || 'success';
        if (ev.sql) b.sql = ev.sql;
        if (ev.sqlExplanation) b.sqlExplanation = ev.sqlExplanation;
        if (ev.sql) this.sqlByTool.set(ev.toolUseId, { ...this.sqlByTool.get(ev.toolUseId), sql: ev.sql });
        break;
      }
      case 'table': {
        const meta = this.sqlByTool.get(ev.toolUseId) ?? {};
        this.sqlByTool.set(ev.toolUseId, { ...meta, queryId: ev.queryId ?? meta.queryId });
        this.upsert(`table:${ev.toolUseId}:${ev.index}`, () => ({
          type: 'table',
          id: this.nextId('tbl'),
          toolUseId: ev.toolUseId,
          title: ev.title,
          queryId: ev.queryId,
          sql: meta.sql,
          table: ev.table,
        }));
        break;
      }
      case 'chart': {
        const meta = this.sqlByTool.get(ev.toolUseId) ?? {};
        this.upsert(`chart:${ev.toolUseId}:${ev.index}`, () => ({
          type: 'chart',
          id: this.nextId('cht'),
          toolUseId: ev.toolUseId,
          spec: ev.spec,
          generated: ev.generated,
          sql: meta.sql,
          queryId: meta.queryId,
        }));
        break;
      }
      case 'map': {
        this.upsert(`map:${ev.toolUseId}:${ev.index}`, () => ({
          type: 'map',
          id: this.nextId('map'),
          toolUseId: ev.toolUseId,
          spec: ev.spec,
        }));
        break;
      }
      case 'error':
        this.blocks.push({ type: 'error', message: ev.message });
        break;
      case 'metadata':
        if (ev.role === 'user') this._userMessageId = ev.messageId;
        else this._assistantMessageId = ev.messageId;
        break;
      default:
        break;
    }
  }

  /** Tables that never got a chart from the agent (candidates for the chart fallback). */
  tablesWithoutCharts(): BlockOf<'table'>[] {
    const charted = new Set(
      this.blocks.filter((b): b is BlockOf<'chart'> => b.type === 'chart').map((b) => b.toolUseId),
    );
    return this.blocks.filter(
      (b): b is BlockOf<'table'> => b.type === 'table' && !charted.has(b.toolUseId),
    );
  }

  /** Marks tools still flagged as running as finished (stream ended). */
  finalize(): ContentBlock[] {
    for (const b of this.blocks) if (b.type === 'tool' && b.status === 'running') b.status = 'success';
    return this.blocks;
  }

  private upsert(key: string, make: () => ContentBlock): ContentBlock {
    let b = this.keyed.get(key);
    if (!b) {
      b = make();
      this.keyed.set(key, b);
      this.blocks.push(b);
    }
    return b;
  }

  private nextId(prefix: string): string {
    this.seq += 1;
    return `${prefix}_${this.seq}`;
  }
}

/** Plain text of a message, used for titles, memory extraction and workflow hand-offs. */
export function blocksToText(blocks: ContentBlock[]): string {
  return blocks
    .filter((b): b is BlockOf<'text'> => b.type === 'text')
    .map((b) => b.text)
    .join('\n')
    .trim();
}
