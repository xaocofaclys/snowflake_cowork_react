import { describe, expect, it } from 'vitest';
import { BlockBuilder, blocksToText } from '../src/blocks';

describe('BlockBuilder', () => {
  it('folds deltas, tools, tables and charts into ordered blocks', () => {
    const b = new BlockBuilder();
    b.add({ type: 'status', status: 'planning', message: 'Planning' });
    b.add({ type: 'tool_use', index: 1, toolUseId: 't1', toolType: 'cortex_analyst_text_to_sql', name: 'a', input: {} });
    b.add({ type: 'tool_result', index: 2, toolUseId: 't1', toolType: 'cortex_analyst_text_to_sql', name: 'a', status: 'success', sql: 'SELECT 1' });
    b.add({ type: 'table', index: 3, toolUseId: 't1', table: { columns: [], rows: [] } });
    b.add({ type: 'text_delta', index: 4, text: 'Hello ' });
    b.add({ type: 'text_delta', index: 4, text: 'world' });
    b.add({ type: 'metadata', role: 'assistant', messageId: 42 });
    expect(b.blocks.map((x) => x.type)).toEqual(['steps', 'tool', 'table', 'text']);
    expect(blocksToText(b.blocks)).toBe('Hello world');
    expect((b.blocks[2] as any).sql).toBe('SELECT 1');
    expect(b.assistantMessageId).toBe(42);
    expect(b.tablesWithoutCharts()).toHaveLength(1);

    b.add({ type: 'chart', index: 5, toolUseId: 't1', spec: { mark: 'bar' } });
    expect(b.tablesWithoutCharts()).toHaveLength(0);
  });

  it('is idempotent when the final response replays streamed content', () => {
    const b = new BlockBuilder();
    b.add({ type: 'text_delta', index: 0, text: 'Hi' });
    b.add({ type: 'text', index: 0, text: 'Hi' });
    b.add({ type: 'table', index: 1, toolUseId: 't', table: { columns: [], rows: [] } });
    b.add({ type: 'table', index: 1, toolUseId: 't', table: { columns: [], rows: [] } });
    expect(b.blocks).toHaveLength(2);
  });
});
