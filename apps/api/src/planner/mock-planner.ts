import { fromMin, stopLetter, toMin, type FieldRep, type PlanAction, type RoutePlan, type RouteStop, type TerritoryHcp, type TimeWindow, type UnscheduledVisit } from '@cowork/shared';
import { MOCK_ASSIGNMENTS, MOCK_HCPS, MOCK_PRODUCTS, MOCK_REPS } from './mock-data';

/**
 * Offline stand-in for FR_PLAN_ROUTE / FR_ADJUST_PLAN (CORTEX_MOCK mode), with the same
 * estimates: straight-line distance × 1.4 at ~20 km/h, time on site by tier, clinic hours.
 */

export const MOCK_FIRST_DATE = '2026-10-31';
const DWELL: Record<string, number> = { A: 25, B: 20, C: 15 };

interface Override {
  action: PlanAction;
  hcpId?: string;
  param?: string;
}
const overrides = new Map<string, Override[]>();

export const mockReps = (): FieldRep[] => MOCK_REPS.map((r) => ({ ...r }));

export function mockTerritory(repId: string): TerritoryHcp[] {
  return MOCK_HCPS.filter((h) => h[10] === repId).map(([hcpId, hcpName, specialty, tier, clinic, area, lat, lon, availStart, availEnd]) => ({
    hcpId,
    hcpName,
    specialty,
    tier,
    clinic,
    area,
    lat,
    lon,
    availStart,
    availEnd,
  }));
}

function km(a: { lat: number; lon: number }, b: { lat: number; lon: number }) {
  const r = (d: number) => (d * Math.PI) / 180;
  const h = Math.sin(r(b.lat - a.lat) / 2) ** 2 + Math.cos(r(a.lat)) * Math.cos(r(b.lat)) * Math.sin(r(b.lon - a.lon) / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(h)) * 1.4;
}

function assignments(repId: string, date: string) {
  const day = Math.round((Date.parse(date) - Date.parse(MOCK_FIRST_DATE)) / 86400_000);
  if (repId === 'R001') return MOCK_ASSIGNMENTS[((day % 5) + 5) % 5] ?? [];
  // Other reps: rotate through their territory, six a day.
  const mine = mockTerritory(repId);
  const offset = (((day % 5) + 5) % 5) * 3;
  return Array.from({ length: Math.min(6, mine.length) }, (_, i) => {
    const h = mine[(offset + i) % mine.length];
    return [h.hcpId, i < 2 ? 'High' : 'Medium', ['P01', 'P02', 'P03', 'P04'][i % 4], 'Detailing - new indication'] as [string, string, string, string];
  });
}

const addDays = (date: string, n: number) => new Date(Date.parse(date) + n * 86400_000).toISOString().slice(0, 10);

export function mockAdjust(repId: string, date: string, o: Override): RoutePlan {
  const key = `${repId}:${date}`;
  if (o.action === 'RESET') overrides.delete(key);
  else {
    const list = (overrides.get(key) ?? []).filter((x) => !(x.action === o.action && (x.hcpId ?? '') === (o.hcpId ?? '') && !['BREAK'].includes(o.action)));
    // A doctor has one fate per day: the latest of add / remove / push wins.
    const fate: PlanAction[] = ['ADD', 'REMOVE', 'PUSH'];
    overrides.set(key, [...(fate.includes(o.action) ? list.filter((x) => !(fate.includes(x.action) && x.hcpId === o.hcpId)) : list), o]);
    if (o.action === 'PUSH' && o.hcpId) {
      const to = o.param && /^\d{4}-\d{2}-\d{2}$/.test(o.param) ? o.param : addDays(date, 1);
      const tk = `${repId}:${to}`;
      overrides.set(tk, [...(overrides.get(tk) ?? []).filter((x) => x.hcpId !== o.hcpId), { action: 'ADD', hcpId: o.hcpId }]);
    }
  }
  return mockPlan(repId, date);
}

export function mockPlan(repId: string, date: string, startTime?: string): RoutePlan {
  const rep = MOCK_REPS.find((r) => r.repId === repId) ?? MOCK_REPS[0];
  const ov = overrides.get(`${repId}:${date}`) ?? [];
  const last = (a: PlanAction) => [...ov].reverse().find((x) => x.action === a);
  const removed = new Set(ov.filter((x) => x.action === 'REMOVE' || x.action === 'PUSH').map((x) => x.hcpId));
  const hcp = new Map(MOCK_HCPS.map((h) => [h[0], h]));

  const visits = [...assignments(rep.repId, date), ...ov.filter((x) => x.action === 'ADD' && x.hcpId).map((x) => [x.hcpId!, 'High', 'P01', 'Added by rep'] as [string, string, string, string])]
    .filter(([id], i, all) => !removed.has(id) && hcp.has(id) && all.findIndex((v) => v[0] === id) === i)
    .map(([id, priority, product, objective]) => {
      const [, name, specialty, tier, clinic, area, lat, lon, availStart, availEnd] = hcp.get(id)!;
      const dwell = Number(ov.find((x) => x.action === 'DWELL' && x.hcpId === id)?.param) || DWELL[tier] || 20;
      return { id, name, specialty, tier, clinic, area, lat, lon, availStart, availEnd, priority, product, objective, dwell };
    });

  const breaks: TimeWindow[] = ov
    .filter((x) => x.action === 'BREAK' && x.param)
    .map((x) => {
      const [from, to] = x.param!.split('-');
      return { from, to, label: 'Break' };
    });
  const hardStop = last('HARD_STOP')?.param;
  const end = toMin(hardStop ?? rep.shiftEnd);
  const startAt = toMin(startTime ?? last('START_TIME')?.param ?? rep.shiftStart);
  const pins = ov.filter((x) => x.action === 'PIN' && x.hcpId).map((x) => ({ id: x.hcpId!, pos: Number(x.param) || 1 }));

  // Greedy: from where we are, go to the visit we can start earliest (clinic hours), nearest first on ties.
  const stops: RouteStop[] = [];
  const unscheduled: UnscheduledVisit[] = [];
  let here = { lat: rep.lat, lon: rep.lon };
  let now = startAt;
  let leaveAt: number | undefined;
  const pending = [...visits];
  const skipBreaks = (t: number, dur: number) => {
    for (const b of breaks) if (t < toMin(b.to) && t + dur > toMin(b.from)) t = toMin(b.to);
    return t;
  };
  while (pending.length) {
    const pinned = pins.find((p) => p.pos === stops.length + 1 && pending.some((v) => v.id === p.id));
    // Pinned doctors wait for their slot (unless they're all that's left).
    const free = pending.filter((v) => !pins.some((p) => p.id === v.id && p.pos > stops.length + 1));
    const scored = (free.length ? free : pending).map((v) => {
      const d = km(here, v);
      const drive = Math.max(2, Math.round((d / 20) * 60));
      const arrive = skipBreaks(Math.max(now + drive, toMin(v.availStart)), v.dwell);
      return { v, d, drive, arrive };
    });
    const pick = pinned ? scored.find((s) => s.v.id === pinned.id)! : scored.sort((a, b) => a.arrive - b.arrive || a.d - b.d)[0];
    pending.splice(pending.indexOf(pick.v), 1);
    const depart = pick.arrive + pick.v.dwell;
    if (depart > toMin(pick.v.availEnd) || depart > end) {
      unscheduled.push({ hcpId: pick.v.id, hcpName: pick.v.name, tier: pick.v.tier, lat: pick.v.lat, lon: pick.v.lon, reason: depart > end ? `Doesn't fit before ${fromMin(end)}` : `Clinic closes at ${pick.v.availEnd}` });
      continue;
    }
    if (leaveAt === undefined) leaveAt = pick.arrive - pick.drive;
    stops.push({
      stop: stopLetter(stops.length),
      hcpId: pick.v.id,
      hcpName: pick.v.name,
      specialty: pick.v.specialty,
      tier: pick.v.tier,
      area: pick.v.area,
      clinic: pick.v.clinic,
      lat: pick.v.lat,
      lon: pick.v.lon,
      arrive: fromMin(pick.arrive),
      depart: fromMin(depart),
      travelKm: Math.round(pick.d * 10) / 10,
      travelMin: pick.drive,
      timeOnSiteMin: pick.v.dwell,
      objective: pick.v.objective,
      focusProduct: MOCK_PRODUCTS[pick.v.product],
      priority: pick.v.priority,
      availStart: pick.v.availStart,
      availEnd: pick.v.availEnd,
      legMapUrl: `https://www.openstreetmap.org/directions?engine=fossgis_osrm_car&route=${here.lat},${here.lon};${pick.v.lat},${pick.v.lon}`,
    });
    here = pick.v;
    now = depart;
  }

  // Idle stretches of 45+ minutes between visits.
  const freeWindows: TimeWindow[] = [];
  stops.forEach((s, i) => {
    const next = stops[i + 1];
    if (!next) return;
    const gapFrom = toMin(s.depart);
    const gapTo = toMin(next.arrive) - (next.travelMin ?? 0);
    if (gapTo - gapFrom >= 45) freeWindows.push({ from: fromMin(gapFrom), to: fromMin(gapTo) });
  });

  const path = [{ lat: rep.lat, lon: rep.lon }, ...stops].map((p) => `${p.lat},${p.lon}`);
  return {
    repId: rep.repId,
    repName: rep.name,
    firstName: rep.name.split(' ')[0],
    planDate: date,
    start: { name: rep.startLocation, lat: rep.lat, lon: rep.lon, leaveAt: leaveAt !== undefined ? fromMin(leaveAt) : undefined },
    stops,
    unscheduled,
    freeWindows,
    breaks,
    hardStop,
    totals: {
      visits: stops.length,
      km: Math.round(stops.reduce((s, x) => s + (x.travelKm ?? 0), 0) * 10) / 10,
      driveMin: stops.reduce((s, x) => s + (x.travelMin ?? 0), 0),
      finishAt: stops[stops.length - 1]?.depart,
    },
    mapUrl: `https://www.google.com/maps/dir/${path.join('/')}`,
    changes: ov.map((x) => [x.action, x.hcpId, x.param].filter(Boolean).join(' ')),
  };
}
