'use client';

import { Bot, ChevronRight, Database } from 'lucide-react';
import { useState } from 'react';
import { buildChartSpec, type Artifact, type ResearchFinding } from '@cowork/shared';
import { DataTable } from './DataTable';
import { Markdown } from './Markdown';
import { VegaChart } from './VegaChart';

/** [2] → link to the finding it cites. */
function linkCitations(md: string) {
  return md.replace(/\[(\d{1,2})\](?!\()/g, (_, n) => `[\\[${n}\\]](#finding-${n})`);
}

/** A deep-research report: the written analysis, then every finding it cites with its data. */
export function ReportView({ artifact }: { artifact: Artifact }) {
  return (
    <div className="space-y-8">
      {artifact.question && (
        <p className="rounded-lg bg-raised px-3 py-2 text-sm text-ink-2">
          <span className="font-medium text-ink">Question:</span> {artifact.question}
        </p>
      )}
      <article className="report-body">
        <Markdown text={linkCitations(artifact.text ?? '')} />
      </article>
      {!!artifact.findings?.length && (
        <section className="print-break">
          <h2 className="mb-3 text-lg font-semibold">Sources</h2>
          <div className="space-y-4">
            {artifact.findings.map((f) => (
              <Finding key={f.n} f={f} />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

function Finding({ f }: { f: ResearchFinding }) {
  const [showText, setShowText] = useState(false);
  const spec = f.spec ?? (f.table ? buildChartSpec(f.table) : null);
  return (
    <div id={`finding-${f.n}`} className="print-avoid scroll-mt-6 rounded-xl border border-line bg-panel p-4">
      <div className="flex items-start gap-2">
        <span className="rounded-md bg-accent-soft px-1.5 py-0.5 text-xs font-semibold text-accent">[{f.n}]</span>
        <div className="min-w-0 flex-1">
          <div className="text-sm font-medium">{f.question}</div>
          <div className="mt-0.5 flex items-center gap-1 text-[11px] text-ink-3">
            <Bot className="h-3 w-3" /> {f.agentId.split('.').pop()}
          </div>
        </div>
      </div>
      {f.error && <p className="mt-2 text-xs text-danger">This step failed: {f.error}</p>}
      {spec && (
        <div className="mt-3 rounded-lg bg-bg p-2">
          <VegaChart spec={{ ...spec, title: undefined }} height={240} />
        </div>
      )}
      {!spec && f.table && (
        <div className="mt-3">
          <DataTable table={f.table} maxHeight={260} />
        </div>
      )}
      {f.text && (
        <div className="no-print mt-2">
          <button onClick={() => setShowText((s) => !s)} className="inline-flex items-center gap-1 text-xs text-ink-3 hover:text-ink">
            <ChevronRight className={`h-3 w-3 transition-transform ${showText ? 'rotate-90' : ''}`} /> Agent's answer
          </button>
          {showText && (
            <div className="mt-1 border-l-2 border-line pl-3 text-sm">
              <Markdown text={f.text} />
            </div>
          )}
        </div>
      )}
      {f.sql && (
        <details className="no-print mt-1 text-xs">
          <summary className="inline-flex cursor-pointer items-center gap-1 text-ink-3 hover:text-ink">
            <Database className="h-3 w-3" /> SQL
          </summary>
          <pre className="mt-1 overflow-x-auto rounded-lg bg-raised p-2 font-mono text-[11px]">{f.sql}</pre>
        </details>
      )}
    </div>
  );
}
