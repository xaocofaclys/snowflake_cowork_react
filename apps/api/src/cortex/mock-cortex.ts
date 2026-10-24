/**
 * Offline stand-in for the Cortex Agents Run API (CORTEX_MOCK=true).
 * It emits raw SSE in the real wire format, so the production parser,
 * normalizer, chart fallback and UI are all exercised without Snowflake.
 */

const REGIONS = ['AFRICA', 'AMERICA', 'ASIA', 'EUROPE', 'MIDDLE EAST'];
const NATIONS = [
  'ALGERIA', 'ARGENTINA', 'BRAZIL', 'CANADA', 'EGYPT', 'ETHIOPIA', 'FRANCE', 'GERMANY', 'INDIA', 'INDONESIA',
  'IRAN', 'IRAQ', 'JAPAN', 'JORDAN', 'KENYA', 'MOROCCO', 'MOZAMBIQUE', 'PERU', 'CHINA', 'ROMANIA',
  'SAUDI ARABIA', 'VIETNAM', 'RUSSIA', 'UNITED KINGDOM', 'UNITED STATES',
];

interface Scenario {
  sql: string;
  explanation: string;
  columns: { name: string; type: string }[];
  rows: unknown[][];
  /** Whether the mock agent returns a chart itself (false exercises the API's chart fallback). */
  agentChart: boolean;
  chartSpec?: Record<string, unknown>;
  answer: string;
}

function seeded(seed: number) {
  let s = seed;
  return () => ((s = (s * 9301 + 49297) % 233280) / 233280);
}

function scenario(question: string): Scenario | null {
  const q = question.toLowerCase();
  const rnd = seeded(q.length * 7 + 13);
  if (/month|trend|over time|monthly/.test(q)) {
    const rows = Array.from({ length: 12 }, (_, m) => [
      `1997-${String(m + 1).padStart(2, '0')}-01`,
      Math.round(2_600_000_000 + rnd() * 400_000_000 + Math.sin(m / 2) * 150_000_000),
    ]);
    return {
      sql: `SELECT DATE_TRUNC('month', o_orderdate) AS order_month,\n       SUM(l_extendedprice * (1 - l_discount)) AS revenue\nFROM snowflake_sample_data.tpch_sf1.orders\nJOIN snowflake_sample_data.tpch_sf1.lineitem ON l_orderkey = o_orderkey\nWHERE YEAR(o_orderdate) = 1997\nGROUP BY 1 ORDER BY 1`,
      explanation: 'Sums net revenue (extended price less discount) per order month for 1997.',
      columns: [
        { name: 'ORDER_MONTH', type: 'date' },
        { name: 'REVENUE', type: 'fixed' },
      ],
      rows,
      agentChart: true,
      chartSpec: {
        $schema: 'https://vega.github.io/schema/vega-lite/v5.json',
        title: 'Monthly revenue, 1997',
        mark: { type: 'line', point: true, tooltip: true },
        encoding: {
          x: { field: 'ORDER_MONTH', type: 'temporal', title: 'Month' },
          y: { field: 'REVENUE', type: 'quantitative', title: 'Revenue' },
        },
        data: { values: rows.map(([d, r]) => ({ ORDER_MONTH: d, REVENUE: r })) },
      },
      answer:
        'Revenue in 1997 stayed in a narrow band of roughly **$2.6–3.0B per month**. The peak came in the spring, followed by a mild dip mid-year and a recovery into Q4.',
    };
  }
  if (/region/.test(q)) {
    const rows = REGIONS.map((r) => [r, Math.round(6_000_000_000 + rnd() * 1_500_000_000), Math.round(40_000 + rnd() * 9_000)]);
    return {
      sql: `SELECT r_name AS region, SUM(l_extendedprice * (1 - l_discount)) AS revenue, COUNT(DISTINCT o_orderkey) AS orders\nFROM ... GROUP BY 1 ORDER BY revenue DESC`,
      explanation: 'Joins orders through customer and nation to region and sums net revenue.',
      columns: [
        { name: 'REGION', type: 'text' },
        { name: 'REVENUE', type: 'fixed' },
        { name: 'ORDERS', type: 'fixed' },
      ],
      rows,
      agentChart: true,
      chartSpec: {
        $schema: 'https://vega.github.io/schema/vega-lite/v5.json',
        title: 'Revenue by region',
        mark: { type: 'bar', tooltip: true },
        encoding: {
          x: { field: 'REGION', type: 'nominal', sort: '-y' },
          y: { field: 'REVENUE', type: 'quantitative' },
        },
        data: { values: rows.map(([a, b, c]) => ({ REGION: a, REVENUE: b, ORDERS: c })) },
      },
      answer: 'All five regions contribute comparable revenue. The gap between the largest and smallest is under 25%.',
    };
  }
  if (/nation|country/.test(q)) {
    const rows = NATIONS.map((n) => [n, Math.round(1_000_000_000 + rnd() * 800_000_000)]);
    return {
      sql: `SELECT n_name AS nation, SUM(l_extendedprice * (1 - l_discount)) AS revenue FROM ... GROUP BY 1`,
      explanation: 'Net revenue per customer nation.',
      columns: [
        { name: 'NATION', type: 'text' },
        { name: 'REVENUE', type: 'fixed' },
      ],
      rows,
      agentChart: false,
      answer: 'Here is net revenue by nation across all 25 TPC-H nations.',
    };
  }
  if (/customer|top/.test(q)) {
    const rows = Array.from({ length: 10 }, (_, k) => [
      `Customer#0000${String(1000 + Math.floor(rnd() * 8999))}`,
      Math.round(6_000_000 - k * 350_000 - rnd() * 100_000),
      Math.round(30 + rnd() * 15),
    ]);
    return {
      sql: `SELECT c_name AS customer, SUM(o_totalprice) AS total_spend, COUNT(*) AS orders\nFROM ... GROUP BY 1 ORDER BY 2 DESC LIMIT 10`,
      explanation: 'Ranks customers by the total price of all their orders.',
      columns: [
        { name: 'CUSTOMER', type: 'text' },
        { name: 'TOTAL_SPEND', type: 'fixed' },
        { name: 'ORDERS', type: 'fixed' },
      ],
      rows,
      agentChart: false,
      answer: 'These are the top 10 customers by total order value. The leader is about 1.5× the tenth.',
    };
  }
  return null;
}

let mockThread = 1000;
let mockMessage = 5000;

export function mockThreadId(): number {
  return ++mockThread;
}

const enc = new TextEncoder();
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function sse(event: string, data: unknown): Uint8Array {
  return enc.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

/** Splits text into word-ish chunks for the typewriter effect. */
function chunks(text: string): string[] {
  return text.match(/\S+\s*|\s+/g) ?? [text];
}

export async function* mockAgentStream(question: string, signal?: AbortSignal): AsyncGenerator<Uint8Array> {
  const userMsg = ++mockMessage;
  const asstMsg = ++mockMessage;
  const runId = `mock-${asstMsg}`;
  const s = scenario(question.replace(/<user_context>[\s\S]*?<\/user_context>/, ''));
  let idx = 0;
  const step = async (ms: number) => {
    await sleep(ms);
    if (signal?.aborted) throw new Error('aborted');
  };

  yield sse('metadata', { metadata: { role: 'user', message_id: userMsg, run_id: runId } });
  yield sse('response.status', { status: 'planning', message: 'Planning the next steps' });
  await step(250);
  for (const t of chunks('The user wants an analysis of TPC-H sales data. I should query the semantic view and chart the result.')) {
    yield sse('response.thinking.delta', { content_index: idx, text: t });
    await step(15);
  }
  idx++;

  if (!s) {
    const text =
      "I'm a demo text-to-SQL agent running in **mock mode**. Try asking:\n\n- *Show monthly revenue for 1997*\n- *Revenue by region*\n- *Top 10 customers by spend* (table only, so the app generates the chart)\n- *Revenue by nation*";
    for (const t of chunks(text)) {
      yield sse('response.text.delta', { content_index: idx, text: t });
      await step(20);
    }
  } else {
    const toolId = `toolu_${asstMsg}`;
    yield sse('response.tool_use', {
      content_index: idx++,
      tool_use_id: toolId,
      type: 'cortex_analyst_text_to_sql',
      name: 'tpch_analyst',
      input: { query: question },
    });
    yield sse('response.status', { status: 'executing_tool', message: 'Generating SQL with Cortex Analyst' });
    await step(500);
    yield sse('response.status', { status: 'executing_tool', message: 'Executing SQL' });
    await step(400);
    yield sse('response.tool_result', {
      content_index: idx++,
      tool_use_id: toolId,
      type: 'cortex_analyst_text_to_sql',
      name: 'tpch_analyst',
      status: 'success',
      content: [{ type: 'json', json: { sql: s.sql, sql_explanation: s.explanation, query_id: `01mock-${asstMsg}` } }],
    });
    yield sse('response.table', {
      content_index: idx++,
      tool_use_id: toolId,
      query_id: `01mock-${asstMsg}`,
      title: null,
      result_set: {
        statementHandle: `01mock-${asstMsg}`,
        resultSetMetaData: { numRows: s.rows.length, rowType: s.columns },
        data: s.rows.map((r) => r.map((v) => (v === null ? null : String(v)))),
      },
    });
    if (s.agentChart && s.chartSpec) {
      yield sse('response.status', { status: 'executing_tool', message: 'Generating chart' });
      await step(300);
      yield sse('response.chart', {
        content_index: idx++,
        tool_use_id: toolId,
        chart_spec: JSON.stringify(s.chartSpec),
      });
    }
    yield sse('response.status', { status: 'proceeding_to_answer', message: 'Forming the answer' });
    for (const t of chunks(s.answer)) {
      yield sse('response.text.delta', { content_index: idx, text: t });
      await step(25);
    }
  }
  yield sse('metadata', { metadata: { role: 'assistant', message_id: asstMsg, run_id: runId } });
  yield sse('response', { role: 'assistant', content: [], status: 'completed' });
}

/** Mock re-execution of an artifact's SQL: same shape, nudged numbers. */
export function mockRerun(columns: { name: string; type: string }[], rows: unknown[][]): unknown[][] {
  return rows.map((r) =>
    r.map((v, i) =>
      /fixed|real|number/.test(columns[i]?.type ?? '') && typeof v === 'number'
        ? Math.round(v * (0.95 + Math.random() * 0.1))
        : v,
    ),
  );
}

export const MOCK_AGENTS = [
  {
    database: 'COWORK_DEMO',
    schema: 'AGENTS',
    name: 'SALES_ANALYST',
    displayName: 'Sales Analyst',
    description: 'Text-to-SQL over TPC-H orders, customers and regions.',
    sampleQuestions: [
      'Show monthly revenue for 1997',
      'Revenue by region',
      'Top 10 customers by spend',
      'Revenue by nation',
    ],
  },
];
