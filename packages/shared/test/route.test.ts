import { describe, expect, it } from 'vitest';
import { diffPlans, extractRoutePlanBlock, hhmm, parseRoutePlan, planTimeline, stripRoutePlanBlock } from '../src/route';

const procOutput = JSON.stringify({
  REP_ID: 'R001',
  FIRST_NAME: 'Shubham',
  PLAN_DATE: '2026-10-31',
  START_LOCATION: 'Koramangala Office',
  START_LAT: 12.9352,
  START_LON: 77.6245,
  LEAVE_START_LOCATION_AT: '10:57',
  STOPS: [
    { STOP: 'A', HCP_ID: 'H004', HCP_NAME: 'Dr. Meera Shetty', TIER: 'B', LAT: '12.97034', LON: '77.64148', ARRIVE: '11:00:00', DEPART: '11:20:00', TRAVEL_KM: 6.2, TRAVEL_MIN: 19, TIME_ON_SITE_MIN: 20 },
    { STOP: 'B', HCP_ID: 'H008', HCP_NAME: 'Dr. Mohan Bhat', TIER: 'A', LAT: 12.95, LON: 77.6, ARRIVE: '12:30', DEPART: '12:55', TRAVEL_KM: 4, TRAVEL_MIN: 12, TIME_ON_SITE_MIN: 25 },
  ],
  UNSCHEDULED: [{ HCP_ID: 'H056', HCP_NAME: 'Dr. X', REASON: 'Clinic closes at 13:00' }],
  FREE_WINDOWS: [{ START: '11:20', END: '12:18' }],
  MAP: { FULL_ROUTE_URL: 'https://www.google.com/maps/dir/a/b' },
});

describe('route plans', () => {
  it('parses procedure output with upper-case keys, wrapped in result', () => {
    const p = parseRoutePlan({ result: procOutput })!;
    expect(p.stops.map((s) => s.hcpId)).toEqual(['H004', 'H008']);
    expect(p.stops[0]).toMatchObject({ arrive: '11:00', depart: '11:20', lat: 12.97034, travelKm: 6.2 });
    expect(p.start).toMatchObject({ name: 'Koramangala Office', leaveAt: '10:57' });
    expect(p.totals).toMatchObject({ visits: 2, km: 10.2, driveMin: 31, finishAt: '12:55' });
    expect(p.unscheduled[0].reason).toContain('13:00');
    expect(p.freeWindows).toEqual([{ from: '11:20', to: '12:18', label: undefined }]);
    expect(p.mapUrl).toContain('google.com');
  });

  it('reads the agent block, taking coordinates from GeoJSON when stops lack them', () => {
    const text = 'Hey Shubham…\n```json route_plan\n' + JSON.stringify({
      plan_date: '2026-10-31',
      stops: [{ stop: 'A', hcp_id: 'H004', hcp_name: 'Dr. Meera Shetty', arrive: '11:00', depart: '11:20' }],
      geojson: { type: 'FeatureCollection', features: [{ type: 'Feature', geometry: { type: 'Point', coordinates: [77.64, 12.97] }, properties: { hcp_id: 'H004' } }] },
    }) + '\n```';
    const p = extractRoutePlanBlock(text)!;
    expect(p.stops[0]).toMatchObject({ lat: 12.97, lon: 77.64 });
    expect(stripRoutePlanBlock(text)).toBe('Hey Shubham…');
    expect(stripRoutePlanBlock('Hey\n```json route_plan\n{"plan_da')).toBe('Hey');
  });

  it('normalizes times', () => {
    expect(hhmm('3:05 pm')).toBe('15:05');
    expect(hhmm('2026-10-31 09:30:00')).toBe('09:30');
    expect(hhmm('nope')).toBeUndefined();
  });

  it('builds a day timeline with drives, visits, waits and free time', () => {
    const p = parseRoutePlan(procOutput)!;
    const t = planTimeline(p);
    expect(t.start).toBe(10 * 60 + 57);
    expect(t.segments.map((s) => s.kind)).toEqual(['drive', 'visit', 'free', 'drive', 'visit']);
  });

  it('diffs plans by HCP', () => {
    const a = parseRoutePlan(procOutput)!;
    const b = { ...a, stops: [{ ...a.stops[1], stop: 'A' }] };
    const d = diffPlans(a, b);
    expect(d.changed).toEqual({ H008: 'moved' });
    expect(d.removed.map((s) => s.hcpId)).toEqual(['H004']);
  });
});

describe('real FR_PLAN_ROUTE output', () => {
  // Captured from DEV_REACT_COWORK.AGENTS.FR_PLAN_ROUTE('R001', NULL, NULL) on 2026-10-31.
  const raw = JSON.stringify(require('./fixtures/fr_plan_route.json'));

  it('maps every field the page uses', () => {
    const p = parseRoutePlan({ FR_PLAN_ROUTE: raw })!;
    // The office isn't a field: it's where the route LineString starts.
    expect(p.start).toEqual({ name: 'Koramangala Office', lat: 12.9352, lon: 77.6245, leaveAt: '10:57' });
    expect(p.totals).toEqual({ visits: 6, km: 22, driveMin: 66, finishAt: '16:20' });
    expect(p.stops[0]).toMatchObject({ stop: 'A', hcpId: 'H008', availStart: '11:00', availEnd: '14:00', travelKm: 0.9, focusProduct: 'Cardiozen' });
    expect(p.freeWindows.length).toBe(2);
    expect(p.mapUrl).toContain('google.com/maps/dir');
    expect(p.changes).toEqual([]);
  });
});
