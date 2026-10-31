/**
 * Route plans from the field-rep day planner agent (FR_PLAN_ROUTE / FR_ADJUST_PLAN).
 * The procedures and the agent's ```json route_plan block don't share one exact shape,
 * so parsing is tolerant: keys are matched case-insensitively with a few aliases.
 */

export interface RoutePoint {
  lat: number;
  lon: number;
}

export interface RouteStop extends RoutePoint {
  /** A, B, C… in visiting order. */
  stop: string;
  hcpId: string;
  hcpName: string;
  specialty?: string;
  tier?: string;
  area?: string;
  clinic?: string;
  /** HH:MM */
  arrive: string;
  depart: string;
  travelKm?: number;
  travelMin?: number;
  timeOnSiteMin?: number;
  objective?: string;
  focusProduct?: string;
  priority?: string;
  availStart?: string;
  availEnd?: string;
  legMapUrl?: string;
}

export interface UnscheduledVisit {
  hcpId: string;
  hcpName: string;
  reason?: string;
  lat?: number;
  lon?: number;
  tier?: string;
}

export interface TimeWindow {
  from: string;
  to: string;
  label?: string;
}

export interface RoutePlan {
  repId?: string;
  repName?: string;
  firstName?: string;
  /** YYYY-MM-DD */
  planDate: string;
  start?: RoutePoint & { name: string; leaveAt?: string };
  stops: RouteStop[];
  unscheduled: UnscheduledVisit[];
  freeWindows: TimeWindow[];
  breaks: TimeWindow[];
  hardStop?: string;
  totals: { visits: number; km: number; driveMin: number; finishAt?: string };
  mapUrl?: string;
  /** What the last adjustments changed, when the procedure reports it. */
  changes?: string[];
}

/** One rep from FR_REPS. */
export interface FieldRep {
  repId: string;
  name: string;
  territory?: string;
  startLocation?: string;
  lat?: number;
  lon?: number;
  shiftStart?: string;
  shiftEnd?: string;
  snowflakeUser?: string;
}

/** A doctor in the rep's territory (FR_HCPS), shown on the map so it can be added. */
export interface TerritoryHcp extends RoutePoint {
  hcpId: string;
  hcpName: string;
  specialty?: string;
  tier?: string;
  area?: string;
  clinic?: string;
  availStart?: string;
  availEnd?: string;
}

export type PlanAction = 'PUSH' | 'REMOVE' | 'ADD' | 'PIN' | 'HARD_STOP' | 'START_TIME' | 'BREAK' | 'DWELL' | 'RESET';
export const PLAN_ACTIONS: PlanAction[] = ['PUSH', 'REMOVE', 'ADD', 'PIN', 'HARD_STOP', 'START_TIME', 'BREAK', 'DWELL', 'RESET'];

// ---------- parsing ----------

type Obj = Record<string, unknown>;

const isObj = (v: unknown): v is Obj => !!v && typeof v === 'object' && !Array.isArray(v);

function lowerKeys(v: unknown, depth = 0): unknown {
  if (depth > 6) return v;
  if (Array.isArray(v)) return v.map((x) => lowerKeys(x, depth + 1));
  if (!isObj(v)) return v;
  const out: Obj = {};
  for (const [k, x] of Object.entries(v)) out[k.toLowerCase()] = lowerKeys(x, depth + 1);
  return out;
}

function maybeJson(v: unknown): unknown {
  if (typeof v !== 'string') return v;
  const s = v.trim();
  if (!s.startsWith('{') && !s.startsWith('[')) return v;
  try {
    return JSON.parse(s);
  } catch {
    return v;
  }
}

function get(o: Obj | undefined, ...keys: string[]): unknown {
  if (!o) return undefined;
  for (const k of keys) {
    const v = o[k];
    if (v !== undefined && v !== null && v !== '') return v;
  }
  return undefined;
}

const str = (v: unknown) => (v === undefined || v === null ? undefined : String(v));
function num(v: unknown): number | undefined {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v.replace(/[^\d.-]/g, '')) : NaN;
  return Number.isFinite(n) ? n : undefined;
}

/** "11:00", "11:00:00", "2026-10-31 11:00:00", "11:00 AM" → "11:00". */
export function hhmm(v: unknown): string | undefined {
  if (v === undefined || v === null) return undefined;
  const s = String(v);
  const m = s.match(/(\d{1,2}):(\d{2})(?::\d{2})?\s*([ap]\.?m\.?)?/i);
  if (!m) return undefined;
  let h = Number(m[1]);
  const pm = m[3]?.toLowerCase().startsWith('p');
  if (m[3] && pm && h < 12) h += 12;
  if (m[3] && !pm && h === 12) h = 0;
  return `${String(h).padStart(2, '0')}:${m[2]}`;
}

export const toMin = (t?: string) => {
  const s = hhmm(t);
  if (!s) return NaN;
  const [h, m] = s.split(':').map(Number);
  return h * 60 + m;
};

export const fromMin = (m: number) => {
  const x = Math.max(0, Math.round(m));
  return `${String(Math.floor(x / 60) % 24).padStart(2, '0')}:${String(x % 60).padStart(2, '0')}`;
};

export const stopLetter = (i: number) => (i < 26 ? String.fromCharCode(65 + i) : `${String.fromCharCode(65 + Math.floor(i / 26) - 1)}${String.fromCharCode(65 + (i % 26))}`);

/** Finds the object holding a `stops` array (the plan may be wrapped in result/plan/data). */
function findPlanObject(v: unknown, depth = 0): Obj | undefined {
  const x = maybeJson(v);
  if (depth > 4) return undefined;
  if (Array.isArray(x)) {
    for (const item of x) {
      const f = findPlanObject(item, depth + 1);
      if (f) return f;
    }
    return undefined;
  }
  if (!isObj(x)) return undefined;
  const stopsKey = Object.keys(x).find((k) => k.toLowerCase() === 'stops');
  if (stopsKey && Array.isArray(maybeJson(x[stopsKey]))) return { ...x, [stopsKey]: maybeJson(x[stopsKey]) };
  for (const val of Object.values(x)) {
    const f = findPlanObject(val, depth + 1);
    if (f) return f;
  }
  return undefined;
}

/** Stop coordinates from Point features; `origin` is where the route LineString begins (the office). */
function geoPoints(geojson: unknown): Map<string, RoutePoint> & { origin?: RoutePoint } {
  const out: Map<string, RoutePoint> & { origin?: RoutePoint } = new Map<string, RoutePoint>();
  const g = lowerKeys(maybeJson(geojson));
  const feats = isObj(g) && Array.isArray(g.features) ? g.features : [];
  for (const f of feats) {
    if (!isObj(f) || !isObj(f.geometry) || !Array.isArray(f.geometry.coordinates)) continue;
    const first = f.geometry.coordinates[0];
    if (f.geometry.type === 'LineString' && Array.isArray(first) && !out.origin) out.origin = { lon: Number(first[0]), lat: Number(first[1]) };
    if (f.geometry.type !== 'Point') continue;
    const [lon, lat] = f.geometry.coordinates.map(Number);
    const p = isObj(f.properties) ? f.properties : {};
    for (const k of [str(get(p, 'hcp_id', 'id')), str(get(p, 'stop', 'label'))]) if (k) out.set(k, { lat, lon });
  }
  return out;
}

function windows(v: unknown): TimeWindow[] {
  const arr = maybeJson(v);
  if (!Array.isArray(arr)) return [];
  return arr
    .map((w) => {
      if (typeof w === 'string') {
        const [a, b] = w.split(/\s*[-–]\s*/);
        return { from: hhmm(a), to: hhmm(b) };
      }
      const o = isObj(w) ? w : {};
      return { from: hhmm(get(o, 'from', 'start', 'start_time', 'window_start')), to: hhmm(get(o, 'to', 'end', 'end_time', 'window_end')), label: str(get(o, 'label', 'note', 'suggestion')) };
    })
    .filter((w): w is TimeWindow => !!w.from && !!w.to);
}

/** Normalizes FR_PLAN_ROUTE / FR_ADJUST_PLAN output or the agent's route_plan block. */
export function parseRoutePlan(raw: unknown): RoutePlan | null {
  const found = findPlanObject(raw);
  if (!found) return null;
  const o = lowerKeys(found) as Obj;
  const map = isObj(maybeJson(o.map)) ? (lowerKeys(maybeJson(o.map)) as Obj) : undefined;
  const pts = geoPoints(get(o, 'geojson') ?? get(map, 'geojson'));
  const rep = isObj(o.rep) ? o.rep : undefined;
  const summary = isObj(o.summary) ? o.summary : isObj(o.totals) ? o.totals : undefined;

  const stops: RouteStop[] = [];
  (maybeJson(o.stops) as unknown[]).forEach((s, i) => {
    if (!isObj(s)) return;
    const hcpId = str(get(s, 'hcp_id', 'id')) ?? `stop-${i}`;
    const rawStop = get(s, 'stop', 'stop_letter', 'letter', 'label', 'seq', 'sequence', 'position');
    const letter = typeof rawStop === 'number' || /^\d+$/.test(String(rawStop ?? '')) ? stopLetter(Number(rawStop) - 1) : (str(rawStop) ?? stopLetter(i));
    const p = pts.get(hcpId) ?? pts.get(letter);
    const lat = num(get(s, 'lat', 'latitude')) ?? p?.lat;
    const lon = num(get(s, 'lon', 'lng', 'longitude')) ?? p?.lon;
    if (lat === undefined || lon === undefined) return;
    stops.push({
      stop: letter,
      hcpId,
      hcpName: str(get(s, 'hcp_name', 'name', 'doctor')) ?? hcpId,
      specialty: str(get(s, 'specialty')),
      tier: str(get(s, 'tier')),
      area: str(get(s, 'area')),
      clinic: str(get(s, 'clinic_name', 'clinic')),
      lat,
      lon,
      arrive: hhmm(get(s, 'arrive', 'arrival', 'arrive_at', 'arrival_time', 'eta')) ?? '',
      depart: hhmm(get(s, 'depart', 'departure', 'depart_at', 'departure_time')) ?? '',
      travelKm: num(get(s, 'travel_km', 'drive_km', 'distance_km', 'km')),
      travelMin: num(get(s, 'travel_min', 'drive_min', 'drive_minutes', 'travel_minutes')),
      timeOnSiteMin: num(get(s, 'time_on_site_min', 'dwell_min', 'on_site_min', 'visit_min', 'time_on_site')),
      objective: str(get(s, 'objective', 'why')),
      focusProduct: str(get(s, 'focus_product_name', 'focus_product', 'product_name', 'product')),
      priority: str(get(s, 'priority')),
      availStart: hhmm(get(s, 'avail_start', 'clinic_open', 'open')) ?? hhmm(str(get(s, 'clinic_hours', 'hours'))?.split(/\s*[-–]\s*/)[0]),
      availEnd: hhmm(get(s, 'avail_end', 'clinic_close', 'close')) ?? hhmm(str(get(s, 'clinic_hours', 'hours'))?.split(/\s*[-–]\s*/)[1]),
      legMapUrl: str(get(s, 'leg_map_url', 'map_url', 'osm_url')),
    });
  });

  const unscheduled = ((maybeJson(get(o, 'unscheduled', 'not_scheduled', 'couldnt_fit', 'could_not_fit', 'dropped')) as unknown[]) ?? [])
    .filter(isObj)
    .map((u) => ({
      hcpId: str(get(u, 'hcp_id', 'id')) ?? '',
      hcpName: str(get(u, 'hcp_name', 'name', 'doctor')) ?? str(get(u, 'hcp_id')) ?? 'Visit',
      reason: str(get(u, 'reason', 'why')),
      lat: num(get(u, 'lat', 'latitude')),
      lon: num(get(u, 'lon', 'lng', 'longitude')),
      tier: str(get(u, 'tier')),
    }));

  const startRaw = get(o, 'start_location', 'start', 'office');
  const startObj = isObj(startRaw) ? startRaw : undefined;
  const startLat = num(get(o, 'start_lat') ?? get(startObj, 'lat', 'latitude') ?? get(rep, 'start_lat')) ?? pts.origin?.lat;
  const startLon = num(get(o, 'start_lon') ?? get(startObj, 'lon', 'lng', 'longitude') ?? get(rep, 'start_lon')) ?? pts.origin?.lon;
  const startName = (startObj ? str(get(startObj, 'name', 'label')) : str(startRaw)) ?? str(get(rep, 'start_location')) ?? 'Start';
  const leaveAt = hhmm(get(o, 'leave_start_location_at', 'leave_at', 'leave_office_at', 'start_time', 'departure_time') ?? get(startObj, 'leave_at'));

  const sumKm = stops.reduce((s, x) => s + (x.travelKm ?? 0), 0);
  const sumMin = stops.reduce((s, x) => s + (x.travelMin ?? 0), 0);
  const repName = str(get(o, 'rep_name') ?? get(rep, 'rep_name', 'name'));
  const changes = maybeJson(get(o, 'changes', 'applied_adjustments', 'applied_overrides', 'overrides', 'adjustments'));

  return {
    repId: str(get(o, 'rep_id') ?? get(rep, 'rep_id', 'id')),
    repName,
    firstName: str(get(o, 'first_name') ?? get(rep, 'first_name')) ?? repName?.split(' ')[0],
    planDate: str(get(o, 'plan_date', 'date'))?.slice(0, 10) ?? '',
    start: startLat !== undefined && startLon !== undefined ? { name: startName, lat: startLat, lon: startLon, leaveAt } : undefined,
    stops,
    unscheduled,
    freeWindows: windows(get(o, 'free_windows', 'free_time', 'gaps')),
    breaks: windows(get(o, 'breaks', 'blocked', 'blocks')),
    hardStop: hhmm(get(o, 'hard_stop', 'hard_stop_at', 'end_by')),
    totals: {
      visits: stops.length,
      km: num(get(o, 'total_km', 'total_travel_km', 'total_drive_km') ?? get(summary, 'total_km', 'total_travel_km', 'drive_km', 'km')) ?? Math.round(sumKm * 10) / 10,
      driveMin: num(get(o, 'total_travel_min', 'total_drive_min', 'total_min') ?? get(summary, 'total_travel_min', 'total_drive_min', 'drive_min')) ?? sumMin,
      finishAt: hhmm(get(o, 'finish_at', 'finish_time', 'end_time', 'day_end') ?? get(summary, 'finish_at', 'finish_time', 'end_time')) ?? stops[stops.length - 1]?.depart,
    },
    mapUrl: str(get(o, 'full_route_url', 'map_url') ?? get(map, 'full_route_url', 'url')),
    changes: Array.isArray(changes) ? changes.map((c) => (typeof c === 'string' ? c : describeOverride(c))).filter(Boolean) : undefined,
  };
}

function describeOverride(c: unknown): string {
  if (!isObj(c)) return '';
  const o = lowerKeys(c) as Obj;
  return [get(o, 'action'), get(o, 'hcp_id', 'hcp_name'), get(o, 'param')].filter(Boolean).join(' ');
}

const BLOCK = /```json\s+route_plan\s*\n([\s\S]*?)```/;

/** The agent ends plan replies with a ```json route_plan block for UIs. */
export function extractRoutePlanBlock(text: string): RoutePlan | null {
  const m = text.match(BLOCK);
  return m ? parseRoutePlan(m[1]) : null;
}

/** Hides the machine-readable block (also while it is still streaming in). */
export function stripRoutePlanBlock(text: string): string {
  const i = text.search(/```json\s+route_plan/);
  return (i >= 0 ? text.slice(0, i) : text).replace(/\s+$/, '');
}

/**
 * The block carries only stop basics; fill the rest from what we already know
 * about each doctor (an earlier plan or the territory list).
 */
export function enrichPlan(plan: RoutePlan, known: { stops?: RouteStop[]; hcps?: TerritoryHcp[]; start?: RoutePlan['start'] }): RoutePlan {
  const byId = new Map<string, Partial<RouteStop>>();
  for (const h of known.hcps ?? []) byId.set(h.hcpId, h);
  for (const s of known.stops ?? []) byId.set(s.hcpId, { ...byId.get(s.hcpId), ...s });
  return {
    ...plan,
    start: plan.start ?? known.start,
    stops: plan.stops.map((s) => {
      const k = byId.get(s.hcpId);
      if (!k) return s;
      const keep = Object.fromEntries(Object.entries(s).filter(([, v]) => v !== undefined && v !== ''));
      return { ...k, ...keep } as RouteStop;
    }),
  };
}

// ---------- day timeline ----------

export interface TimelineSegment {
  kind: 'drive' | 'visit' | 'wait' | 'free' | 'break';
  from: number;
  to: number;
  stopIndex?: number;
  label?: string;
}

/** Minutes-of-day segments for the day strip: drive → visit per stop, breaks, free windows, waiting. */
export function planTimeline(plan: RoutePlan): { segments: TimelineSegment[]; start: number; end: number } {
  const segs: TimelineSegment[] = [];
  plan.stops.forEach((s, i) => {
    const a = toMin(s.arrive);
    const d = toMin(s.depart);
    if (!Number.isFinite(a) || !Number.isFinite(d)) return;
    const drive = s.travelMin ?? 0;
    if (drive > 0) segs.push({ kind: 'drive', from: a - drive, to: a, stopIndex: i });
    segs.push({ kind: 'visit', from: a, to: d, stopIndex: i, label: s.stop });
  });
  for (const b of plan.breaks) segs.push({ kind: 'break', from: toMin(b.from), to: toMin(b.to), label: b.label ?? 'Break' });
  const busy = [...segs];
  for (const f of plan.freeWindows) {
    const from = toMin(f.from);
    const to = toMin(f.to);
    // Free windows the procedure reports can overlap a break; keep only the uncovered part.
    if (!busy.some((b) => b.from <= from && b.to >= to)) segs.push({ kind: 'free', from, to, label: f.label });
  }
  const valid = segs.filter((s) => Number.isFinite(s.from) && Number.isFinite(s.to) && s.to > s.from).sort((a, b) => a.from - b.from);
  const leave = toMin(plan.start?.leaveAt);
  const start = Number.isFinite(leave) ? leave : (valid[0]?.from ?? 9 * 60);
  const end = Math.max(valid.reduce((m, s) => Math.max(m, s.to), start + 60), toMin(plan.hardStop) || 0);
  // Gaps between consecutive activities are time spent waiting (e.g. for a clinic to open).
  const out: TimelineSegment[] = [];
  let cursor = start;
  for (const s of valid) {
    if (s.from > cursor + 1) out.push({ kind: 'wait', from: cursor, to: s.from });
    out.push(s);
    cursor = Math.max(cursor, s.to);
  }
  return { segments: out, start, end };
}

// ---------- diff ----------

export type StopChange = 'added' | 'moved' | 'retimed';

/** What changed between two plans, by HCP: used to highlight stops after an edit. */
export function diffPlans(prev: RoutePlan | null | undefined, next: RoutePlan): { changed: Record<string, StopChange>; removed: RouteStop[] } {
  const changed: Record<string, StopChange> = {};
  if (!prev) return { changed, removed: [] };
  const before = new Map(prev.stops.map((s, i) => [s.hcpId, { s, i }]));
  next.stops.forEach((s, i) => {
    const b = before.get(s.hcpId);
    if (!b) changed[s.hcpId] = 'added';
    else if (b.i !== i) changed[s.hcpId] = 'moved';
    else if (b.s.arrive !== s.arrive || b.s.depart !== s.depart) changed[s.hcpId] = 'retimed';
  });
  const after = new Set(next.stops.map((s) => s.hcpId));
  return { changed, removed: prev.stops.filter((s) => !after.has(s.hcpId)) };
}
