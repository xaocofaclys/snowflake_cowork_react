import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import {
  AUTO_AGENT_ID,
  BlockBuilder,
  buildTileSpec,
  isWorkflowAgentId,
  layoutTiles,
  resolveTile,
  type AgentInfo,
  type Artifact,
  type BlockOf,
  type Dashboard,
  type DashboardFilter,
  type StreamEvent,
  type TableData,
  type TileChart,
  type TileDesign,
} from '@cowork/shared';
import { ArtifactsService } from '../artifacts/artifacts.service';
import { newId, nowIso } from '../common/ids';
import { env } from '../config/env';
import { CortexService } from '../cortex/cortex.service';
import { LlmService } from '../llm/llm.service';
import type { SfCredential } from '../snowflake/snowflake.client';
import { DocStore } from '../store/doc-store';

const BUILD = /\b(build|create|make|design|generate|set up|put together)\b[^.?!]{0,60}\bdashboard\b|\bdashboard\b[^.?!]{0,40}\b(for|of|showing|to track|to report|to monitor|on)\b/i;
const EDIT_VERB = /\b(add|remove|delete|drop|change|make|switch|turn|replace|rename|show|swap|include|split|break)\b/i;
const EDIT_NOUN = /\b(chart|tile|kpi|card|graph|table|filter|dashboard|donut|pie|line|bar|metric|it|that)\b/i;
const CHARTS: TileChart[] = ['line', 'area', 'bar', 'hbar', 'stacked', 'donut', 'scatter'];
const CONCURRENCY = 3;

interface Design {
  title: string;
  subtitle?: string;
  filters: DashboardFilter[];
  tiles: TileDesign[];
}

export interface BuildOptions {
  userId: string;
  cred?: SfCredential;
  request: string;
  agentId: string;
  emit: (ev: StreamEvent) => void;
  signal?: AbortSignal;
  threadId?: string;
}

type EditOp =
  | { op: 'add'; tile: Partial<TileDesign> }
  | { op: 'remove'; id: string }
  | { op: 'update'; id: string; title?: string; chart?: TileChart; aggregate?: TileDesign['aggregate'] }
  | { op: 'retitle'; title: string };

/**
 * Builds and edits dashboards from chat. Each tile is one agent question; results are stored as
 * artifacts with resolved roles so the dashboard can filter and cross-filter in the browser.
 */
@Injectable()
export class DashboardBuilderService {
  private readonly log = new Logger(DashboardBuilderService.name);

  constructor(
    private readonly cortex: CortexService,
    private readonly llm: LlmService,
    private readonly artifacts: ArtifactsService,
    private readonly store: DocStore,
  ) {}

  static looksLikeBuild(text: string) {
    return BUILD.test(text);
  }

  static looksLikeEdit(text: string) {
    return EDIT_VERB.test(text) && EDIT_NOUN.test(text);
  }

  // ---------------------------------------------------------------- build

  async build(o: BuildOptions): Promise<Dashboard> {
    o.emit({ type: 'status', status: 'planning', message: 'Designing the dashboard' });
    const agents = await this.scope(o);
    const design = await this.design(o.request, agents, o.cred);
    o.emit({ type: 'status', status: 'building', message: `Building ${design.tiles.length} tiles` });

    const built = await this.runTiles(design.tiles, design.filters, o);
    const ok = built.filter((b) => b.artifact);
    if (!ok.length) throw new Error('None of the tiles could be built. The agents may not cover these metrics.');

    const layout = layoutTiles(ok.map((b) => ({ id: b.artifact!.id, kind: b.design.kind, width: b.design.width })));
    const now = nowIso();
    const dashboard: Dashboard = {
      id: newId('dsh'),
      userId: o.userId,
      title: design.title,
      description: design.subtitle,
      question: o.request,
      agentId: o.agentId,
      filters: design.filters.filter((f) => ok.some((b) => b.artifact!.tile?.filterColumns[f.key])),
      threadId: o.threadId,
      items: layout.map((l) => ({ artifactId: l.id, x: l.x, y: l.y, w: l.w, h: l.h })),
      sharedWith: [],
      createdAt: now,
      updatedAt: now,
    };
    await this.store.insert('DASHBOARDS', dashboard);

    const failed = built.filter((b) => !b.artifact);
    const kinds = (k: string) => ok.filter((b) => b.design.kind === k).length;
    o.emit({
      type: 'text',
      index: 0,
      text: [
        `Built **${dashboard.title}**: ${kinds('kpi')} KPI cards, ${kinds('chart')} charts${kinds('table') ? `, ${kinds('table')} table` : ''}.`,
        dashboard.filters?.length ? `Filters: ${dashboard.filters.map((f) => f.label).join(', ')}. Click any bar or slice to cross-filter.` : '',
        failed.length ? `Couldn't build: ${failed.map((f) => `*${f.design.title}* (${f.error})`).join('; ')}.` : '',
        'Ask me to change it, e.g. "add a chart of …", "make the trend a bar chart", "remove …".',
      ]
        .filter(Boolean)
        .join('\n\n'),
    });
    o.emit({ type: 'artifact', artifactId: dashboard.id, title: dashboard.title, kind: 'dashboard' });
    return dashboard;
  }

  private async scope(o: { cred?: SfCredential; userId: string; agentId: string }): Promise<AgentInfo[]> {
    const visible = (await this.cortex.listAgents(o.cred, `${o.userId}:dashboard`)).filter((a) => a.kind === 'agent');
    const pinned = o.agentId && o.agentId !== AUTO_AGENT_ID && !isWorkflowAgentId(o.agentId);
    const agents = pinned ? visible.filter((a) => a.id === o.agentId) : visible;
    if (!agents.length) throw new Error('No agents are available to build the dashboard');
    return agents;
  }

  private async design(request: string, agents: AgentInfo[], cred?: SfCredential): Promise<Design> {
    const catalog = agents.map((a) => ({ agentId: a.id, name: a.displayName, description: a.description ?? '', exampleQuestions: a.sampleQuestions.slice(0, 4) }));
    const d = await this.llm.completeJson<Partial<Design> & { tiles?: Partial<TileDesign>[] }>(
      `You design executive BI dashboards (Power BI style) that are filled by data agents answering questions with SQL.
Request: """${request}"""
Agents (use only these agentId values; judge coverage from descriptions/examples):
${JSON.stringify(catalog, null, 2)}

Design:
- 3 to 5 KPI tiles (kind "kpi"): headline metrics. aggregate: "sum" for counts/amounts, "mean" for rates/averages. format: number|currency|percent.
- 3 to 6 chart tiles (kind "chart"): chart one of line|area|bar|hbar|stacked|donut|scatter. line/area for trends over time (x = the time column, e.g. "month"); bar for comparing ≤10 categories; hbar for rankings; donut for share of a whole (≤6 slices); stacked when a second dimension splits bars (color). x, y, color are short column-name hints (e.g. "region", "revenue"). width: half or full.
- At most 1 table tile (kind "table") for a ranked detail list.
- 1 to 3 filters shared by tiles: a "date" filter if the data is time-based, plus 1-2 "dimension" filters (e.g. region, rep, segment) that most tiles can be split by. key: snake_case, hints: likely column names.
- Every question must be self-contained and answerable by its agent.

Return ONLY JSON:
{"title": "...", "subtitle": "...", "filters": [{"key": "...", "label": "...", "kind": "date|dimension", "hints": ["..."]}],
 "tiles": [{"kind": "kpi|chart|table", "title": "...", "question": "...", "agentId": "...", "chart": "...", "x": "...", "y": "...", "color": "...", "aggregate": "sum|mean", "format": "number|currency|percent", "width": "half|full"}]}`,
      cred,
      env.RESEARCH_MODEL,
    );
    const ids = new Set(agents.map((a) => a.id));
    const tiles = (d?.tiles ?? [])
      .filter((t) => t?.question && t?.title && ['kpi', 'chart', 'table'].includes(t.kind as string))
      .slice(0, 12)
      .map((t, i) => this.normalizeTile(t, agents[0].id, ids, i));
    if (tiles.length) {
      return {
        title: d?.title?.trim() || this.titleFrom(request),
        subtitle: d?.subtitle?.trim(),
        filters: (d?.filters ?? []).filter((f) => f?.key && f?.label).slice(0, 3).map((f) => ({ key: f.key, label: f.label, kind: f.kind === 'date' ? 'date' : 'dimension', hints: f.hints?.length ? f.hints : [f.key] })),
        tiles,
      };
    }
    this.log.warn('Dashboard designer unavailable; using fallback design');
    return this.fallbackDesign(request, agents[0].id);
  }

  private normalizeTile(t: Partial<TileDesign>, fallbackAgent: string, ids: Set<string>, i: number): TileDesign {
    return {
      id: `t${i + 1}`,
      kind: t.kind as TileDesign['kind'],
      title: t.title!.trim().slice(0, 80),
      question: t.question!.trim(),
      agentId: t.agentId && ids.has(t.agentId) ? t.agentId : fallbackAgent,
      chart: CHARTS.includes(t.chart as TileChart) ? t.chart : t.kind === 'chart' ? 'bar' : undefined,
      x: t.x,
      y: t.y,
      color: t.color || undefined,
      aggregate: t.aggregate === 'mean' ? 'mean' : 'sum',
      format: t.format === 'currency' || t.format === 'percent' ? t.format : 'number',
      width: t.width === 'full' ? 'full' : t.width === 'third' ? 'third' : 'half',
    };
  }

  private titleFrom(request: string) {
    const t = request.replace(/^(please\s+)?(build|create|make|design|generate)\s+(me\s+)?(a|an)?\s*/i, '').replace(/\s+/g, ' ').trim();
    const title = t.charAt(0).toUpperCase() + t.slice(1);
    return title.length > 60 ? `${title.slice(0, 57)}…` : title || 'Dashboard';
  }

  private fallbackDesign(request: string, agentId: string): Design {
    const topic = this.titleFrom(request).replace(/^dashboard\s+(for|of|on)\s+/i, '');
    const t = (p: Partial<TileDesign>, i: number): TileDesign => this.normalizeTile({ agentId, ...p }, agentId, new Set([agentId]), i);
    return {
      title: this.titleFrom(request),
      filters: [
        { key: 'date', label: 'Date', kind: 'date', hints: ['month', 'date'] },
        { key: 'region', label: 'Region', kind: 'dimension', hints: ['region'] },
      ],
      tiles: [
        t({ kind: 'kpi', title: 'Total revenue', question: `${topic}: total revenue`, y: 'revenue', aggregate: 'sum', format: 'currency' }, 0),
        t({ kind: 'kpi', title: 'Avg revenue / month', question: `${topic}: average monthly revenue`, y: 'revenue', aggregate: 'mean', format: 'currency' }, 1),
        t({ kind: 'kpi', title: 'Orders', question: `${topic}: number of orders`, y: 'orders', aggregate: 'sum', format: 'number' }, 2),
        t({ kind: 'chart', title: 'Monthly trend', question: `${topic}: monthly revenue trend`, chart: 'line', x: 'month', y: 'revenue', width: 'full' }, 3),
        t({ kind: 'chart', title: 'By region', question: `${topic}: revenue by region`, chart: 'bar', x: 'region', y: 'revenue' }, 4),
        t({ kind: 'chart', title: 'Share by region', question: `${topic}: share of revenue by region`, chart: 'donut', x: 'region', y: 'revenue' }, 5),
      ],
    };
  }

  /** The question sent to the agent: the tile's question plus shape instructions so the data stays filterable. */
  private agentQuestion(t: TileDesign, filters: DashboardFilter[]): string {
    const dims = filters.filter((f) => f.kind === 'dimension').map((f) => f.label.toLowerCase());
    const hasDate = filters.some((f) => f.kind === 'date');
    if (t.kind === 'kpi') {
      return `${t.question}\nReturn a monthly time series for the most recent 12 months: one row per month${dims.length ? ` and per ${dims.join(' and ')}` : ''}, with columns MONTH${dims.length ? `, ${dims.map((d) => d.toUpperCase().replace(/\W+/g, '_')).join(', ')}` : ''} and VALUE. No chart needed.`;
    }
    if (t.kind === 'table') return `${t.question}\nReturn the result as a table with at most 50 rows.`;
    const groups = [t.x, t.color, ...dims, ...(hasDate && t.chart !== 'line' && t.chart !== 'area' ? ['month'] : [])].filter(Boolean) as string[];
    return `${t.question}\nGroup the result by ${[...new Set(groups)].join(', ')} and return the grouped rows${t.y ? ` with ${t.y}` : ''}. No chart needed.`;
  }

  private async runTiles(designs: TileDesign[], filters: DashboardFilter[], o: BuildOptions) {
    const out: { design: TileDesign; artifact?: Artifact; error?: string }[] = new Array(designs.length);
    let next = 0;
    await Promise.all(
      Array.from({ length: Math.min(CONCURRENCY, designs.length) }, async () => {
        while (next < designs.length) {
          const i = next++;
          out[i] = await this.runTile(designs[i], filters, o);
        }
      }),
    );
    return out;
  }

  private async runTile(design: TileDesign, filters: DashboardFilter[], o: BuildOptions): Promise<{ design: TileDesign; artifact?: Artifact; error?: string }> {
    const nodeId = `tile_${design.id}_${Date.now().toString(36)}`;
    const question = this.agentQuestion(design, filters);
    o.emit({ type: 'node_start', nodeId, run: 1, label: design.title, kind: 'tile', input: question });
    const builder = new BlockBuilder();
    try {
      for await (const ev of this.cortex.run(o.cred, { agentId: design.agentId, text: question, signal: o.signal })) {
        builder.add(ev);
        o.emit({ type: 'node_event', nodeId, run: 1, event: ev });
      }
      const blocks = builder.finalize();
      const table = blocks.find((b): b is BlockOf<'table'> => b.type === 'table');
      const err = blocks.find((b): b is BlockOf<'error'> => b.type === 'error');
      if (!table || !table.table.rows.length) throw new Error(err?.message ?? 'the agent returned no data');
      const artifact = await this.saveTile(o.userId, design, filters, table.table, table.sql ?? blocks.find((b): b is BlockOf<'tool'> => b.type === 'tool' && !!b.sql)?.sql, table.queryId, question);
      o.emit({ type: 'node_end', nodeId, run: 1, status: 'success', output: `${table.table.rows.length} rows` });
      return { design, artifact };
    } catch (e) {
      const error = (e as Error).message;
      o.emit({ type: 'node_end', nodeId, run: 1, status: 'error', error });
      return { design, error };
    }
  }

  private saveTile(userId: string, design: TileDesign, filters: DashboardFilter[], table: TableData, sql: string | undefined, queryId: string | undefined, question: string) {
    const tile = resolveTile(design, table, filters);
    return this.artifacts.createFor(userId, {
      type: design.kind === 'kpi' ? 'kpi' : design.kind === 'table' ? 'table' : 'chart',
      title: design.title,
      table,
      spec: design.kind === 'chart' ? (buildTileSpec(table, tile) ?? undefined) : undefined,
      sql,
      queryId,
      question,
      agentId: design.agentId,
      design,
      tile,
    });
  }

  // ---------------------------------------------------------------- edit

  /** Applies a chat instruction to the thread's dashboard. Returns null if it isn't an edit request. */
  async edit(o: BuildOptions & { dashboardId: string }): Promise<Dashboard | null> {
    const d = await this.store.get<Dashboard>('DASHBOARDS', o.dashboardId);
    if (!d || d.userId !== o.userId) throw new NotFoundException('Dashboard not found');
    const tiles = (await Promise.all(d.items.map((i) => this.store.get<Artifact>('ARTIFACTS', i.artifactId)))).filter((a): a is Artifact => !!a);
    const agents = await this.scope({ ...o, agentId: d.agentId ?? o.agentId });
    const ops = (await this.planEdit(o.request, d, tiles, agents, o.cred)) ?? this.ruleEdit(o.request, tiles);
    if (!ops.length) return null;

    o.emit({ type: 'status', status: 'editing', message: 'Updating the dashboard' });
    const filters = d.filters ?? [];
    let items = [...d.items];
    let title = d.title;
    const done: string[] = [];
    for (const op of ops) {
      if (op.op === 'retitle' && op.title) {
        title = op.title.slice(0, 120);
        done.push(`renamed the dashboard to *${title}*`);
      } else if (op.op === 'remove') {
        const t = tiles.find((x) => x.id === op.id);
        if (!t) continue;
        items = items.filter((i) => i.artifactId !== op.id);
        await this.store.delete('ARTIFACTS', op.id);
        done.push(`removed *${t.title}*`);
      } else if (op.op === 'update') {
        const t = tiles.find((x) => x.id === op.id);
        if (!t?.design || !t.table) continue;
        const design: TileDesign = { ...t.design, ...(op.title ? { title: op.title } : {}), ...(op.chart ? { chart: op.chart } : {}), ...(op.aggregate ? { aggregate: op.aggregate } : {}) };
        const tile = resolveTile(design, t.table, filters);
        await this.store.patch<Artifact>('ARTIFACTS', t.id, { title: design.title, design, tile, spec: design.kind === 'chart' ? (buildTileSpec(t.table, tile) ?? undefined) : undefined });
        done.push(`updated *${design.title}*${op.chart ? ` to a ${op.chart} chart` : ''}`);
      } else if (op.op === 'add' && op.tile?.question) {
        const design = this.normalizeTile({ kind: 'chart', title: op.tile.question.slice(0, 60), ...op.tile }, agents[0].id, new Set(agents.map((a) => a.id)), items.length + 1);
        const res = await this.runTile(design, filters, { ...o, agentId: d.agentId ?? o.agentId });
        if (!res.artifact) {
          done.push(`couldn't add *${design.title}* (${res.error})`);
          continue;
        }
        const bottom = items.reduce((m, i) => Math.max(m, i.y + i.h), 0);
        const w = design.kind === 'kpi' ? 3 : design.width === 'full' || design.kind === 'table' ? 12 : 6;
        items.push({ artifactId: res.artifact.id, x: 0, y: bottom, w, h: design.kind === 'kpi' ? 4 : 9 });
        done.push(`added *${design.title}*`);
      }
    }
    const updated = (await this.store.patch<Dashboard>('DASHBOARDS', d.id, { title, items }))!;
    o.emit({ type: 'text', index: 0, text: done.length ? `Done: ${done.join('; ')}.` : 'I couldn\'t match that to a tile on the dashboard.' });
    o.emit({ type: 'artifact', artifactId: d.id, title, kind: 'dashboard' });
    return updated;
  }

  private async planEdit(instruction: string, d: Dashboard, tiles: Artifact[], agents: AgentInfo[], cred?: SfCredential): Promise<EditOp[] | null> {
    const res = await this.llm.completeJson<{ ops?: EditOp[] }>(
      `A user is editing a BI dashboard through chat. Turn their message into edit operations.
Dashboard: "${d.title}"
Tiles: ${JSON.stringify(tiles.map((t) => ({ id: t.id, kind: t.design?.kind ?? t.type, title: t.title, chart: t.design?.chart, question: t.design?.question })))}
Agents for new tiles: ${JSON.stringify(agents.map((a) => ({ agentId: a.id, name: a.displayName, description: a.description ?? '' })))}
User message: """${instruction}"""

Operations:
- {"op":"add","tile":{"kind":"kpi|chart|table","title":"...","question":"<self-contained question for the agent>","agentId":"...","chart":"line|area|bar|hbar|stacked|donut|scatter","x":"...","y":"...","color":"...","aggregate":"sum|mean","format":"number|currency|percent","width":"half|full"}}
- {"op":"remove","id":"<tile id>"}
- {"op":"update","id":"<tile id>","title":"...","chart":"..."}   (presentation only; to change the data, remove and add)
- {"op":"retitle","title":"..."}
If the message is not a request to change this dashboard (e.g. a question about the data), return {"ops": []}.
Return ONLY JSON: {"ops": [...]}`,
      cred,
      env.RESEARCH_MODEL,
    );
    return res ? (res.ops ?? []) : null;
  }

  /** Offline fallback for common edits. */
  private ruleEdit(text: string, tiles: Artifact[]): EditOp[] {
    const t = text.toLowerCase();
    // Best tile for the message: full title first, then most whole words in common.
    const words = new Set(t.match(/[a-z0-9]+/g) ?? []);
    const score = (x: Artifact) => {
      const title = x.title.toLowerCase();
      if (t.includes(title)) return 100;
      return (title.match(/[a-z0-9]+/g) ?? []).filter((w) => w.length > 2 && words.has(w)).length;
    };
    const match = tiles.map((x) => ({ x, s: score(x) })).filter((m) => m.s > 0).sort((a, b) => b.s - a.s).map((m) => m.x);
    const chart = CHARTS.find((c) => new RegExp(`\\b${c === 'hbar' ? 'horizontal bar' : c === 'donut' ? '(donut|pie)' : c}\\b`).test(t));
    if (/\b(remove|delete|drop)\b/.test(t) && match[0]) return [{ op: 'remove', id: match[0].id }];
    if (/\b(make|turn|switch|change|show)\b/.test(t) && chart && match[0]) return [{ op: 'update', id: match[0].id, chart }];
    const add = text.match(/\badd (?:a |an )?(?:(kpi|card|table|chart|graph)\s+)?(?:of|for|showing|with)?\s*(.+)/i);
    if (add) {
      const kind = add[1] === 'kpi' || add[1] === 'card' ? 'kpi' : add[1] === 'table' ? 'table' : 'chart';
      return [{ op: 'add', tile: { kind, title: add[2].replace(/[.?!]+$/, '').slice(0, 60), question: add[2], chart: chart ?? 'bar' } }];
    }
    return [];
  }
}
