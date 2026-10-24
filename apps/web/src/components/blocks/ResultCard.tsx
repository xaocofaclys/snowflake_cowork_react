'use client';

import clsx from 'clsx';
import { BarChart3, Bookmark, Check, Copy, Database, Download, Maximize2, Sparkles, Table2 } from 'lucide-react';
import { useMemo, useRef, useState } from 'react';
import {
  buildChartSpec,
  CHART_TYPES,
  retypeSpec,
  specChartType,
  suggestChartType,
  type BlockOf,
  type ChartType,
} from '@cowork/shared';
import { DataTable, download } from '../DataTable';
import { SaveArtifactDialog } from '../SaveArtifactDialog';
import { IconButton, Modal, Spinner } from '../ui';
import { VegaChart, type ChartHandle } from '../VegaChart';

export interface ResultGroup {
  toolUseId: string;
  tool?: BlockOf<'tool'>;
  tables: BlockOf<'table'>[];
  charts: BlockOf<'chart'>[];
}

export interface ResultContext {
  threadId?: string;
  messageId?: string;
  agentId?: string;
  question?: string;
}

type Tab = 'chart' | 'table' | 'sql';

const TOOL_LABELS: Record<string, string> = {
  cortex_analyst_text_to_sql: 'Cortex Analyst',
  cortex_search: 'Cortex Search',
  data_to_chart: 'Chart',
  generic: 'Custom tool',
};

/**
 * One tool invocation's output: chart, result table and SQL in tabs.
 * Charts come from Cortex (`response.chart`), from the API fallback, or are
 * built here on demand from the table.
 */
export function ResultCard({ group, ctx, streaming }: { group: ResultGroup; ctx: ResultContext; streaming?: boolean }) {
  const table = group.tables[0];
  const agentChart = group.charts[0];
  const sql = group.tool?.sql ?? table?.sql ?? agentChart?.sql;

  const baseSpec = useMemo(
    () => agentChart?.spec ?? (table ? buildChartSpec(table.table) : null),
    [agentChart?.spec, table],
  );
  const [chartType, setChartType] = useState<ChartType | null>(null);
  const spec = useMemo(
    () => (baseSpec && chartType && chartType !== specChartType(baseSpec) ? retypeSpec(baseSpec, chartType) : baseSpec),
    [baseSpec, chartType],
  );
  const canChart = !!spec && (!!agentChart || (table ? suggestChartType(table.table) !== null : false));
  const [tab, setTab] = useState<Tab | null>(null);
  const active: Tab = tab ?? (canChart ? 'chart' : table ? 'table' : 'sql');
  const [expanded, setExpanded] = useState(false);
  const [saving, setSaving] = useState<null | 'chart' | 'table'>(null);
  const [copied, setCopied] = useState(false);
  const chartRef = useRef<ChartHandle | null>(null);

  const running = group.tool?.status === 'running' && streaming;
  if (!table && !agentChart && !sql) {
    return group.tool ? <ToolRow tool={group.tool} running={running} /> : null;
  }

  const title = (spec?.title as string | undefined) ?? ctx.question ?? 'Result';
  const currentType = spec ? specChartType(spec) : null;

  return (
    <div className="my-3 overflow-hidden rounded-xl border border-line bg-panel">
      <div className="flex items-center gap-1 border-b border-line px-2 py-1.5">
        <div className="mr-2 flex items-center gap-1.5 pl-1 text-xs text-ink-3">
          {running ? <Spinner className="h-3.5 w-3.5" /> : <Database className="h-3.5 w-3.5" />}
          {TOOL_LABELS[group.tool?.toolType ?? ''] ?? group.tool?.name ?? 'Query'}
        </div>
        {canChart && <TabBtn on={active === 'chart'} onClick={() => setTab('chart')} icon={<BarChart3 className="h-3.5 w-3.5" />} label="Chart" />}
        {table && <TabBtn on={active === 'table'} onClick={() => setTab('table')} icon={<Table2 className="h-3.5 w-3.5" />} label="Table" />}
        {sql && <TabBtn on={active === 'sql'} onClick={() => setTab('sql')} icon={<Database className="h-3.5 w-3.5" />} label="SQL" />}
        <div className="ml-auto flex items-center gap-0.5">
          {active === 'chart' && spec && (
            <>
              {agentChart?.generated && (
                <span className="mr-1 inline-flex items-center gap-1 rounded-full bg-accent-soft px-2 py-0.5 text-[11px] text-accent" title="Cortex returned only a table; the app generated this chart">
                  <Sparkles className="h-3 w-3" /> Auto-charted
                </span>
              )}
              <select
                aria-label="Chart type"
                value={currentType ?? ''}
                onChange={(e) => setChartType(e.target.value as ChartType)}
                className="h-7 rounded-md border border-line bg-bg px-1.5 text-xs text-ink-2"
              >
                {CHART_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {t[0].toUpperCase() + t.slice(1)}
                  </option>
                ))}
              </select>
              <IconButton label="Download PNG" onClick={async () => chartRef.current && download('chart.png', await chartRef.current.toImageURL('png'))}>
                <Download className="h-3.5 w-3.5" />
              </IconButton>
              <IconButton label="Expand" onClick={() => setExpanded(true)}>
                <Maximize2 className="h-3.5 w-3.5" />
              </IconButton>
            </>
          )}
          {active === 'sql' && sql && (
            <IconButton
              label="Copy SQL"
              onClick={() => {
                navigator.clipboard.writeText(sql);
                setCopied(true);
                setTimeout(() => setCopied(false), 1500);
              }}
            >
              {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
            </IconButton>
          )}
          {(active === 'chart' || active === 'table') && table && !streaming && (
            <IconButton label="Save as artifact" onClick={() => setSaving(active === 'chart' ? 'chart' : 'table')}>
              <Bookmark className="h-3.5 w-3.5" />
            </IconButton>
          )}
        </div>
      </div>

      <div className="p-3">
        {active === 'chart' && spec && <VegaChart spec={spec} onReady={(h) => (chartRef.current = h)} />}
        {active === 'table' && table && <DataTable table={table.table} />}
        {active === 'sql' && sql && (
          <div>
            {group.tool?.sqlExplanation && <p className="mb-2 text-xs text-ink-2">{group.tool.sqlExplanation}</p>}
            <pre className="overflow-x-auto rounded-lg bg-raised p-3 font-mono text-xs leading-relaxed">{sql}</pre>
          </div>
        )}
      </div>

      <Modal open={expanded} onClose={() => setExpanded(false)} title={title} wide>
        {spec && <VegaChart spec={spec} height={520} />}
      </Modal>
      {saving && (
        <SaveArtifactDialog
          open
          onClose={() => setSaving(null)}
          draft={{
            type: saving,
            title,
            spec: saving === 'chart' ? (spec ?? undefined) : undefined,
            table: table?.table,
            sql,
            queryId: table?.queryId,
            agentId: ctx.agentId,
            threadId: ctx.threadId,
            messageId: ctx.messageId,
          }}
        />
      )}
    </div>
  );
}

function TabBtn({ on, onClick, icon, label }: { on: boolean; onClick: () => void; icon: React.ReactNode; label: string }) {
  return (
    <button
      onClick={onClick}
      className={clsx(
        'inline-flex h-7 items-center gap-1 rounded-md px-2 text-xs font-medium',
        on ? 'bg-bg text-ink shadow-sm ring-1 ring-line' : 'text-ink-3 hover:text-ink',
      )}
    >
      {icon}
      {label}
    </button>
  );
}

function ToolRow({ tool, running }: { tool: BlockOf<'tool'>; running?: boolean }) {
  return (
    <div className="my-2 inline-flex items-center gap-2 rounded-lg border border-line bg-panel px-3 py-1.5 text-xs text-ink-2">
      {running ? <Spinner className="h-3.5 w-3.5" /> : <Check className="h-3.5 w-3.5 text-ink-3" />}
      {TOOL_LABELS[tool.toolType] ?? tool.name}
    </div>
  );
}
