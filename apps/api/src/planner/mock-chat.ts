import { hhmm, type PlanAction, type RoutePlan, type StreamEvent } from '@cowork/shared';
import { MOCK_HCPS } from './mock-data';
import { mockAdjust, mockPlan } from './mock-planner';
import type { PlannerChatRequest } from './planner.service';

/**
 * CORTEX_MOCK stand-in for the planner agent: understands the common requests
 * ("push Dr X to tomorrow", "hard stop at 3pm", "lunch 1-1:45", "prep me for stop B")
 * and answers in the agent's format, so the page is usable offline.
 */
export async function* mockPlannerReply(b: PlannerChatRequest, signal: AbortSignal): AsyncGenerator<StreamEvent> {
  const t = b.text.toLowerCase();
  const hcp = resolveHcp(b);
  const times = [...b.text.matchAll(/(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/gi)].map((m) => hhmm(`${m[1]}:${m[2] ?? '00'} ${m[3] ?? ''}`.trim())).filter(Boolean) as string[];
  const pm = (x: string) => (Number(x.slice(0, 2)) < 8 ? `${String(Number(x.slice(0, 2)) + 12).padStart(2, '0')}${x.slice(2)}` : x);

  let action: { action: PlanAction; hcpId?: string; param?: string } | undefined;
  let changed = '';
  if (/\b(reset|start over|undo)\b/.test(t)) [action, changed] = [{ action: 'RESET' }, 'Cleared all changes for the day.'];
  else if (/\b(prep|brief|what should i say)\b/.test(t) && hcp) {
    yield { type: 'status', status: 'planning', message: 'Pulling call notes and Rx trends' };
    yield* stream(prep(hcp), signal);
    return;
  } else if (/\b(push|move|postpone)\b/.test(t) && hcp) [action, changed] = [{ action: 'PUSH', hcpId: hcp }, `Moved ${name(hcp)} to tomorrow.`];
  else if (/\b(remove|skip|cancel|drop)\b/.test(t) && hcp) [action, changed] = [{ action: 'REMOVE', hcpId: hcp }, `Removed ${name(hcp)} from today.`];
  else if (/\badd\b/.test(t) && hcp && !/\b(lunch|break|block)\b/.test(t)) [action, changed] = [{ action: 'ADD', hcpId: hcp }, `Added ${name(hcp)} to today.`];
  else if (/\b(first|second|third|fourth)\b/.test(t) && hcp) {
    const pos = ['first', 'second', 'third', 'fourth'].findIndex((w) => t.includes(w)) + 1;
    [action, changed] = [{ action: 'PIN', hcpId: hcp, param: String(pos) }, `${name(hcp)} is now stop ${String.fromCharCode(64 + pos)}.`];
  } else if (/\b(hard stop|finish by|done by|leave by)\b/.test(t) && times[0]) [action, changed] = [{ action: 'HARD_STOP', param: pm(times[0]) }, `Everything now finishes before ${pm(times[0])}.`];
  else if (/\b(lunch|break|block)\b/.test(t) && times[0]) {
    const from = pm(times[0]);
    const to = times[1] ? pm(times[1]) : addMin(from, Number(t.match(/(\d+)\s*min/)?.[1] ?? 45));
    [action, changed] = [{ action: 'BREAK', param: `${from}-${to}` }, `Blocked ${from}–${to}.`];
  } else if (/\b(start|starting|begin)\b/.test(t) && times[0]) [action, changed] = [{ action: 'START_TIME', param: times[0] }, `Re-planned from ${times[0]}.`];
  else if (/\b(spend|minutes|min)\b/.test(t) && hcp && t.match(/(\d+)\s*min/)) {
    const m = t.match(/(\d+)\s*min/)![1];
    [action, changed] = [{ action: 'DWELL', hcpId: hcp, param: m }, `${name(hcp)} now gets ${m} min on site.`];
  }

  yield { type: 'status', status: 'planning', message: action ? 'Saving your change and re-planning' : 'Planning your route' };
  await new Promise((r) => setTimeout(r, 400));
  const plan = action ? mockAdjust(b.repId, b.date, action) : mockPlan(b.repId, b.date);
  yield { type: 'route_plan', plan };
  yield* stream(formatPlan(plan, changed), signal);
}

function resolveHcp(b: PlannerChatRequest): string | undefined {
  const id = b.text.match(/\bH\d{3}\b/i)?.[0].toUpperCase();
  if (id) return id;
  const letter = b.text.match(/\bstop\s+([A-Z])\b/i)?.[1].toUpperCase();
  if (letter) return b.stops?.find((s) => s.stop === letter)?.hcpId;
  const t = b.text.toLowerCase();
  // Match on surname (or full name), preferring doctors already on screen.
  const pool = [...(b.stops ?? []).map((s) => [s.hcpId, s.hcpName] as const), ...MOCK_HCPS.map((h) => [h[0], h[1]] as const)];
  return pool.find(([, n]) => t.includes(n.toLowerCase().replace(/^dr\.?\s*/, '')))?.[0] ?? pool.find(([, n]) => t.includes(n.split(' ').pop()!.toLowerCase()))?.[0];
}

const name = (id: string) => MOCK_HCPS.find((h) => h[0] === id)?.[1] ?? id;
const addMin = (t: string, m: number) => {
  const x = Number(t.slice(0, 2)) * 60 + Number(t.slice(3)) + m;
  return `${String(Math.floor(x / 60)).padStart(2, '0')}:${String(x % 60).padStart(2, '0')}`;
};

function formatPlan(p: RoutePlan, changed: string): string {
  const day = new Date(`${p.planDate}T00:00:00Z`).toLocaleDateString('en-GB', { weekday: 'long', timeZone: 'UTC' });
  const rows = p.stops.map((s) => `| ${s.stop} | ${s.arrive}–${s.depart} | ${s.hcpName} (${s.specialty}, ${s.tier}) | ${s.area} | ${s.travelKm} km / ${s.travelMin} min | ${s.timeOnSiteMin} min | ${s.objective} |`);
  return [
    changed ? `**${changed}**\n` : '',
    `Hey ${p.firstName}, here's how your ${day} should look: ${p.totals.visits} visits, approx. ${p.totals.km} km / ${p.totals.driveMin} min driving, finishing around ${p.totals.finishAt ?? '—'}.\n`,
    p.start?.leaveAt ? `Leave ${p.start.name} at **${p.start.leaveAt}**.\n` : '',
    '| Stop | Time | Doctor | Area | Drive | Time on site | Why |',
    '|---|---|---|---|---|---|---|',
    ...rows,
    p.unscheduled.length ? `\n**Couldn't fit:** ${p.unscheduled.map((u) => `${u.hcpName} (${u.reason})`).join('; ')}. Want me to push them to tomorrow?` : '',
    `\nTry: "Prep me for stop A" · "Add lunch 13:00-13:45" · "Hard stop at 4pm"`,
  ].join('\n');
}

function prep(hcpId: string): string {
  const h = MOCK_HCPS.find((x) => x[0] === hcpId);
  if (!h) return `I couldn't find ${hcpId}.`;
  return [
    `## Prep: ${h[1]} (${h[2]}, Tier ${h[3]})`,
    `- **Snapshot:** ${h[4]}, ${h[5]}. Clinic hours ${h[8]}–${h[9]}.`,
    `- **Last time:** discussed tolerability; asked for patient leaflets. (Offline demo data.)`,
    `- **Rx pulse:** flat over 6 months; competitor share steady.`,
    `- **Talking points:** stay within the product key messages.`,
    `- **Time box:** ${({ A: 25, B: 20, C: 15 } as Record<string, number>)[h[3]] ?? 20} min.`,
  ].join('\n');
}

async function* stream(text: string, signal: AbortSignal): AsyncGenerator<StreamEvent> {
  for (const chunk of text.match(/[\s\S]{1,48}/g) ?? []) {
    if (signal.aborted) return;
    await new Promise((r) => setTimeout(r, 15));
    yield { type: 'text_delta', index: 0, text: chunk };
  }
}
