'use client';

import { buildChartSpec, buildTileSpec, computeKpi, formatKpi, type Artifact, type Dashboard, type TableData } from '@cowork/shared';
import { formatCell } from '@/components/DataTable';
import { vegaConfig } from './vega-theme';

/** Browser print dialog → "Save as PDF". Print CSS in globals.css hides app chrome. */
export function exportPdf() {
  window.print();
}

/** Renders a Vega-Lite spec off-screen to a PNG data URL (for slides). */
export async function specToPng(spec: Record<string, unknown>, width = 960, height = 480): Promise<string> {
  const { default: embed } = await import('vega-embed');
  const host = document.createElement('div');
  host.style.cssText = `position:fixed;left:-10000px;top:0;width:${width}px`;
  document.body.appendChild(host);
  try {
    const s = { ...spec, width, height, autosize: { type: 'fit', contains: 'padding' }, config: { ...vegaConfig(false), background: '#ffffff' } };
    const { view } = await embed(host, s as never, { actions: false, renderer: 'canvas' });
    const url = await view.toImageURL('png', 2);
    view.finalize();
    return url;
  } finally {
    host.remove();
  }
}

/** Markdown → lines of plain text for slides (headings dropped, bullets kept). */
function plainLines(md: string): string[] {
  return md
    .split('\n')
    .map((l) => l.replace(/\*\*|__|`/g, '').replace(/\[([^\]]+)\]\([^)]*\)/g, '$1').trim())
    .filter((l) => l && !l.startsWith('#'));
}

function sections(md: string): { title: string; body: string }[] {
  const out: { title: string; body: string }[] = [];
  let cur: { title: string; body: string } | null = null;
  for (const line of md.split('\n')) {
    const h = line.match(/^##\s+(.*)/);
    if (h) {
      if (cur) out.push(cur);
      cur = { title: h[1].trim(), body: '' };
    } else if (cur) cur.body += `${line}\n`;
  }
  if (cur) out.push(cur);
  return out;
}

const ACCENT = '1F6FD1';
const INK = '0B0B0B';
const MUTED = '52514E';

async function newDeck(title: string, subtitle: string) {
  const { default: PptxGenJS } = await import('pptxgenjs');
  const pptx = new PptxGenJS();
  pptx.layout = 'LAYOUT_WIDE'; // 13.33 x 7.5 in
  pptx.title = title;
  const s = pptx.addSlide();
  s.addShape(pptx.ShapeType.rect, { x: 0, y: 0, w: 0.25, h: 7.5, fill: { color: ACCENT } });
  s.addText(title, { x: 0.8, y: 2.6, w: 11.5, h: 1.2, fontSize: 36, bold: true, color: INK, fontFace: 'Arial' });
  s.addText(subtitle, { x: 0.8, y: 3.8, w: 11.5, h: 0.6, fontSize: 16, color: MUTED, fontFace: 'Arial' });
  return pptx;
}

function addTextSlide(pptx: any, title: string, lines: string[]) {
  const s = pptx.addSlide();
  s.addText(title, { x: 0.6, y: 0.4, w: 12, h: 0.8, fontSize: 26, bold: true, color: INK, fontFace: 'Arial' });
  s.addText(
    lines.slice(0, 14).map((l) => ({ text: l.replace(/^[-*]\s+/, ''), options: { bullet: /^[-*]\s+/.test(l), breakLine: true } })),
    { x: 0.6, y: 1.3, w: 12, h: 5.8, fontSize: 15, color: INK, fontFace: 'Arial', valign: 'top', paraSpaceAfter: 6 },
  );
}

async function addChartSlide(pptx: any, title: string, spec: Record<string, unknown>, caption?: string) {
  const s = pptx.addSlide();
  s.addText(title, { x: 0.6, y: 0.35, w: 12, h: 0.7, fontSize: 22, bold: true, color: INK, fontFace: 'Arial' });
  const png = await specToPng({ ...spec, title: undefined });
  s.addImage({ data: png, x: 0.6, y: 1.2, w: 12.1, h: 5.6 });
  if (caption) s.addText(caption, { x: 0.6, y: 6.9, w: 12, h: 0.4, fontSize: 11, color: MUTED, fontFace: 'Arial' });
}

function addTableSlide(pptx: any, title: string, table: TableData) {
  const s = pptx.addSlide();
  s.addText(title, { x: 0.6, y: 0.35, w: 12, h: 0.7, fontSize: 22, bold: true, color: INK, fontFace: 'Arial' });
  const cols = table.columns.slice(0, 8);
  const rows = [
    cols.map((c) => ({ text: c.name, options: { bold: true, fill: { color: 'F6F6F4' } } })),
    ...table.rows.slice(0, 14).map((r) => cols.map((c, i) => ({ text: formatCell(r[i], c.type) }))),
  ];
  s.addTable(rows, { x: 0.6, y: 1.2, w: 12.1, fontSize: 11, fontFace: 'Arial', color: INK, border: { type: 'solid', color: 'E4E3DF', pt: 0.5 } });
  if (table.rows.length > 14) s.addText(`Showing 14 of ${table.rows.length} rows`, { x: 0.6, y: 6.9, w: 12, h: 0.4, fontSize: 11, color: MUTED });
}

const today = () => new Date().toLocaleDateString('en-IN', { dateStyle: 'medium' });
const fileName = (t: string) => `${t.replace(/[^\w\- ]+/g, '').trim().slice(0, 60) || 'cowork'}.pptx`;

export async function exportReportPptx(a: Artifact) {
  const pptx = await newDeck(a.title, `Deep research · ${today()}`);
  for (const sec of sections(a.text ?? '')) addTextSlide(pptx, sec.title, plainLines(sec.body));
  for (const f of a.findings ?? []) {
    const spec = f.spec ?? (f.table ? buildChartSpec(f.table) : null);
    if (spec) await addChartSlide(pptx, `[${f.n}] ${f.question}`, spec, 'Source: Cortex agent query');
    else if (f.table) addTableSlide(pptx, `[${f.n}] ${f.question}`, f.table);
  }
  await pptx.writeFile({ fileName: fileName(a.title) });
}

export async function exportArtifactPptx(a: Artifact) {
  if (a.type === 'report') return exportReportPptx(a);
  const pptx = await newDeck(a.title, today());
  if (a.spec) await addChartSlide(pptx, a.title, a.spec);
  else if (a.table) addTableSlide(pptx, a.title, a.table);
  if (a.text) addTextSlide(pptx, 'Summary', plainLines(a.text));
  await pptx.writeFile({ fileName: fileName(a.title) });
}

/** Slides follow the screen: KPI cards on one "Key metrics" slide, charts from the currently filtered rows. */
export async function exportDashboardPptx(
  d: Dashboard,
  artifacts: Artifact[],
  tables: Record<string, TableData | undefined> = {},
  range?: { from?: string; to?: string },
) {
  const byId = new Map(artifacts.map((a) => [a.id, a]));
  const pptx = await newDeck(d.title, `${d.description ? `${d.description} · ` : ''}Dashboard · ${today()}`);
  const ordered = [...d.items].sort((x, y) => x.y - y.y || x.x - y.x).map((i) => byId.get(i.artifactId)).filter((a): a is Artifact => !!a);

  const kpis = ordered.filter((a) => a.type === 'kpi' && a.tile);
  if (kpis.length) {
    const s = pptx.addSlide();
    s.addText('Key metrics', { x: 0.6, y: 0.4, w: 12, h: 0.8, fontSize: 26, bold: true, color: INK, fontFace: 'Arial' });
    const per = Math.min(kpis.length, 4);
    const w = 12.1 / per - 0.2;
    kpis.forEach((a, i) => {
      const k = computeKpi(tables[a.id] ?? a.table!, a.tile!, range);
      const x = 0.6 + (i % per) * (w + 0.2);
      const y = 1.5 + Math.floor(i / per) * 2.4;
      s.addShape(pptx.ShapeType.roundRect, { x, y, w, h: 2.1, fill: { color: 'FCFCFB' }, line: { color: 'E4E3DF', width: 1 }, rectRadius: 0.1 });
      s.addText(a.title.toUpperCase(), { x: x + 0.2, y: y + 0.15, w: w - 0.4, h: 0.4, fontSize: 11, color: MUTED, fontFace: 'Arial' });
      s.addText(formatKpi(k.value, a.tile!.format), { x: x + 0.2, y: y + 0.6, w: w - 0.4, h: 0.8, fontSize: 30, bold: true, color: INK, fontFace: 'Arial' });
      if (k.delta !== null) {
        const sign = k.delta > 0 ? '▲ +' : k.delta < 0 ? '▼ ' : '';
        s.addText(`${sign}${(k.delta * 100).toFixed(1)}% ${k.comparison}`, { x: x + 0.2, y: y + 1.45, w: w - 0.4, h: 0.4, fontSize: 11, color: MUTED, fontFace: 'Arial' });
      }
    });
  }

  for (const a of ordered.filter((x) => x.type !== 'kpi')) {
    const table = tables[a.id] ?? a.table;
    const spec = a.tile && table ? buildTileSpec(table, a.tile) : a.spec;
    if (spec && a.type === 'chart') await addChartSlide(pptx, a.title, spec);
    else if (table) addTableSlide(pptx, a.title, table);
    else if (a.text) addTextSlide(pptx, a.title, plainLines(a.text));
  }
  await pptx.writeFile({ fileName: fileName(d.title) });
}
