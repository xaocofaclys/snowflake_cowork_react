import { describe, expect, it } from 'vitest';
import { BlockBuilder } from '@cowork/shared';
import { mockAgentStream } from '../src/cortex/mock-cortex';
import { normalizeCortexEvent } from '../src/cortex/normalize';
import { parseSse } from '../src/cortex/sse';

async function* fromString(s: string, chunk = 7) {
  const enc = new TextEncoder();
  for (let i = 0; i < s.length; i += chunk) yield enc.encode(s.slice(i, i + chunk));
}

describe('parseSse', () => {
  it('handles records split across chunks and multi-line data', async () => {
    const recs = [];
    for await (const r of parseSse(fromString('event: a\ndata: {"x":\ndata: 1}\n\n: comment\nevent: b\ndata: {}\n\n'))) recs.push(r);
    expect(recs).toEqual([
      { event: 'a', data: '{"x":\n1}' },
      { event: 'b', data: '{}' },
    ]);
  });
});

describe('normalizeCortexEvent', () => {
  it('parses response.chart specs (Vega-Lite serialized as a string)', () => {
    const [ev] = normalizeCortexEvent('response.chart', JSON.stringify({ content_index: 3, tool_use_id: 't', chart_spec: '{"mark":"bar","encoding":{}}' }));
    expect(ev).toMatchObject({ type: 'chart', toolUseId: 't' });
    expect((ev as any).spec.mark).toBe('bar');
    expect((ev as any).spec.width).toBe('container');
  });

  it('parses response.table result sets with numeric coercion', () => {
    const [ev] = normalizeCortexEvent(
      'response.table',
      JSON.stringify({
        tool_use_id: 't',
        query_id: 'q',
        result_set: { resultSetMetaData: { rowType: [{ name: 'R', type: 'TEXT' }, { name: 'N', type: 'FIXED' }] }, data: [['a', '12']] },
      }),
    );
    expect((ev as any).table).toEqual({ columns: [{ name: 'R', type: 'text' }, { name: 'N', type: 'fixed' }], rows: [['a', 12]] });
  });

  it('extracts SQL from analyst tool results', () => {
    const [ev] = normalizeCortexEvent(
      'response.tool_result',
      JSON.stringify({ tool_use_id: 't', type: 'cortex_analyst_text_to_sql', name: 'x', status: 'success', content: [{ type: 'json', json: { sql: 'SELECT 1' } }] }),
    );
    expect((ev as any).sql).toBe('SELECT 1');
  });

  it('maps metadata message ids for thread continuation', () => {
    const [ev] = normalizeCortexEvent('metadata', JSON.stringify({ metadata: { role: 'assistant', message_id: 77, run_id: 'r' } }));
    expect(ev).toEqual({ type: 'metadata', role: 'assistant', messageId: 77, runId: 'r' });
  });

  it('ignores unknown events and bad JSON', () => {
    expect(normalizeCortexEvent('response.something_new', '{}')).toEqual([]);
    expect(normalizeCortexEvent('response.text.delta', 'not json')).toEqual([]);
  });
});

describe('mock agent end-to-end through the real parser', () => {
  it('produces a table and chart for a trend question', async () => {
    const b = new BlockBuilder();
    for await (const r of parseSse(mockAgentStream('monthly revenue'))) for (const ev of normalizeCortexEvent(r.event, r.data)) b.add(ev);
    const types = b.blocks.map((x) => x.type);
    expect(types).toContain('table');
    expect(types).toContain('chart');
    expect(types).toContain('text');
    expect(b.assistantMessageId).toBeGreaterThan(0);
  }, 20_000);

  it('returns a table without a chart for customers (exercises the fallback)', async () => {
    const b = new BlockBuilder();
    for await (const r of parseSse(mockAgentStream('top customers'))) for (const ev of normalizeCortexEvent(r.event, r.data)) b.add(ev);
    expect(b.tablesWithoutCharts()).toHaveLength(1);
  }, 20_000);
});
