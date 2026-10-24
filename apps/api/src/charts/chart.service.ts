import { Injectable } from '@nestjs/common';
import { buildChartSpec, normalizeSpec, tableToValues, type TableData } from '@cowork/shared';
import { LlmService } from '../llm/llm.service';
import type { SfCredential } from '../snowflake/snowflake.client';

const MARKS = new Set(['bar', 'line', 'area', 'point', 'arc', 'circle', 'rect', 'tick']);

/**
 * Produces a chart when the agent returned a table but no `response.chart`.
 * Column-type heuristics first (fast, deterministic); a Cortex LLM call only
 * when the heuristic can't decide.
 */
@Injectable()
export class ChartService {
  constructor(private readonly llm: LlmService) {}

  async fallback(table: TableData, question: string, cred?: SfCredential): Promise<Record<string, unknown> | null> {
    if (table.rows.length < 2 || table.columns.length < 2) return null;
    const heuristic = buildChartSpec(table);
    if (heuristic) return heuristic;
    return this.fromLlm(table, question, cred);
  }

  private async fromLlm(table: TableData, question: string, cred?: SfCredential) {
    const cols = table.columns.map((c) => `${c.name} (${c.type})`).join(', ');
    const sample = JSON.stringify(tableToValues({ ...table, rows: table.rows.slice(0, 20) }));
    const spec = await this.llm.completeJson<Record<string, unknown>>(
      `You write Vega-Lite v5 specs. Question: "${question}". Columns: ${cols}. Sample rows: ${sample}.
Return ONLY a JSON Vega-Lite spec with "mark" and "encoding" that best answers the question, using only these column names as fields.
Omit "data". If no chart is meaningful, return {}.`,
      cred,
    );
    if (!spec || !this.valid(spec, table)) return null;
    return normalizeSpec({ ...spec, data: { values: tableToValues(table) } });
  }

  private valid(spec: Record<string, unknown>, table: TableData): boolean {
    const mark = typeof spec.mark === 'string' ? spec.mark : (spec.mark as { type?: string })?.type;
    if (!mark || !MARKS.has(mark) || !spec.encoding) return false;
    const names = new Set(table.columns.map((c) => c.name));
    return Object.values(spec.encoding as Record<string, { field?: string }>).every((ch) => !ch?.field || names.has(ch.field));
  }
}
