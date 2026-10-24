import type { Annotation, StreamEvent, TableData } from '@cowork/shared';
import { normalizeSpec } from '@cowork/shared';

/** Converts a Snowflake SQL-API style result_set into TableData. */
export function resultSetToTable(rs: any): TableData {
  const rowType: any[] = rs?.resultSetMetaData?.rowType ?? rs?.result_set_meta_data?.row_type ?? [];
  const columns = rowType.map((c) => ({ name: String(c.name), type: String(c.type ?? 'text').toLowerCase() }));
  const rows: unknown[][] = (rs?.data ?? []).map((r: unknown[]) =>
    r.map((v, i) => {
      const t = columns[i]?.type;
      if (v === null || v === undefined) return null;
      if (t === 'fixed' || t === 'real' || t === 'number') return Number(v);
      return v;
    }),
  );
  return { columns, rows };
}

function parseSpec(raw: unknown): Record<string, unknown> | null {
  if (!raw) return null;
  try {
    const spec = typeof raw === 'string' ? JSON.parse(raw) : raw;
    return spec && typeof spec === 'object' ? (spec as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function annotation(a: any): Annotation {
  return {
    type: a?.type ?? 'citation',
    index: a?.index,
    title: a?.doc_title ?? a?.title,
    url: a?.url ?? a?.doc_url,
    text: a?.text,
    docId: a?.doc_id,
  };
}

/** Pulls the generated SQL and explanation out of a tool_result's content. */
function toolResultSql(content: any[]): { sql?: string; sqlExplanation?: string; text?: string } {
  for (const c of content ?? []) {
    const j = c?.json ?? (c?.type === 'json' ? c : undefined);
    if (j && (j.sql || j.text)) return { sql: j.sql, sqlExplanation: j.sql_explanation ?? j.explanation, text: j.text };
  }
  return {};
}

function chartEvent(index: number, d: any): StreamEvent[] {
  const spec = parseSpec(d.chart_spec);
  return spec ? [{ type: 'chart', index, toolUseId: d.tool_use_id ?? `chart_${index}`, spec: normalizeSpec(spec) }] : [];
}

function tableEvent(index: number, d: any): StreamEvent[] {
  return [
    {
      type: 'table',
      index,
      toolUseId: d.tool_use_id ?? `table_${index}`,
      queryId: d.query_id,
      title: d.title,
      table: resultSetToTable(d.result_set),
    },
  ];
}

/**
 * Maps one Cortex Agents SSE record to zero or more normalized events.
 * The final `response` event carries the whole message; replaying it is
 * harmless because BlockBuilder upserts by content index / tool id.
 */
export function normalizeCortexEvent(event: string, raw: string): StreamEvent[] {
  let d: any;
  try {
    d = JSON.parse(raw);
  } catch {
    return [];
  }
  const i = d.content_index ?? 0;
  switch (event) {
    case 'response.status':
      return [{ type: 'status', status: d.status, message: d.message }];
    case 'response.thinking.delta':
      return [{ type: 'thinking_delta', index: i, text: d.text ?? '' }];
    case 'response.thinking':
      return [{ type: 'thinking', index: i, text: d.text ?? '' }];
    case 'response.text.delta':
      return [{ type: 'text_delta', index: i, text: d.text ?? '' }];
    case 'response.text':
      return [{ type: 'text', index: i, text: d.text ?? '', annotations: (d.annotations ?? []).map(annotation) }];
    case 'response.text.annotation':
      return [{ type: 'annotation', index: i, annotation: annotation(d.annotation) }];
    case 'response.tool_use':
      return [{ type: 'tool_use', index: i, toolUseId: d.tool_use_id, toolType: d.type, name: d.name, input: d.input }];
    case 'response.tool_result':
      return [
        {
          type: 'tool_result',
          index: i,
          toolUseId: d.tool_use_id,
          toolType: d.type,
          name: d.name,
          status: d.status,
          ...toolResultSql(d.content),
        },
      ];
    case 'response.tool_result.status':
      return [{ type: 'status', status: d.status, message: d.message }];
    case 'response.table':
      return tableEvent(i, d);
    case 'response.chart':
      return chartEvent(i, d);
    case 'response.map': {
      const spec = parseSpec(d.map_spec);
      return spec ? [{ type: 'map', index: i, toolUseId: d.tool_use_id, spec }] : [];
    }
    case 'response.warning':
      return [{ type: 'warning', message: d.message, code: d.code }];
    case 'error':
      return [{ type: 'error', message: d.message ?? 'Agent error', code: d.code }];
    case 'metadata': {
      const m = d.metadata ?? d;
      return m.message_id !== undefined
        ? [{ type: 'metadata', role: m.role, messageId: Number(m.message_id), runId: m.run_id }]
        : [];
    }
    case 'response':
      return (d.content ?? []).flatMap((c: any, idx: number) => finalContent(c, idx));
    default:
      return [];
  }
}

function finalContent(c: any, idx: number): StreamEvent[] {
  switch (c?.type) {
    case 'text':
      return [{ type: 'text', index: idx, text: c.text ?? '', annotations: (c.annotations ?? []).map(annotation) }];
    case 'thinking':
      return [{ type: 'thinking', index: idx, text: c.thinking?.text ?? c.text ?? '' }];
    case 'tool_use': {
      const t = c.tool_use ?? c;
      return [{ type: 'tool_use', index: idx, toolUseId: t.tool_use_id, toolType: t.type, name: t.name, input: t.input }];
    }
    case 'tool_result': {
      const t = c.tool_result ?? c;
      return [
        {
          type: 'tool_result',
          index: idx,
          toolUseId: t.tool_use_id,
          toolType: t.type,
          name: t.name,
          status: t.status,
          ...toolResultSql(t.content),
        },
      ];
    }
    case 'table':
      return tableEvent(idx, c.table ?? c);
    case 'chart':
      return chartEvent(idx, c.chart ?? c);
    default:
      return [];
  }
}
