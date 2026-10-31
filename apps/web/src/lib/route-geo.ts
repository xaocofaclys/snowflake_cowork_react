'use client';

import { useEffect, useState } from 'react';
import { planTimeline, toMin, type RoutePlan, type RoutePoint } from '@cowork/shared';

export type LatLon = [number, number];

/** Office → A → B …: the waypoints the route visits in order. */
export function waypoints(plan?: RoutePlan): RoutePoint[] {
  if (!plan) return [];
  return [...(plan.start ? [plan.start] : []), ...plan.stops];
}

const cache = new Map<string, LatLon[][]>();

/**
 * Road-following geometry per leg from the public OSRM demo server (free, keyless). Times and
 * distances still come from the planner; this only makes the drawn line follow streets.
 * Falls back to straight lines when OSRM is slow or unreachable.
 */
export function useRoadLegs(plan: RoutePlan | undefined, roads: boolean): { legs: LatLon[][]; source: 'roads' | 'straight' } {
  const pts = waypoints(plan);
  const key = pts.map((p) => `${p.lon.toFixed(5)},${p.lat.toFixed(5)}`).join(';');
  const straight = pts.slice(1).map((p, i): LatLon[] => [[pts[i].lat, pts[i].lon], [p.lat, p.lon]]);
  const [state, setState] = useState<{ key: string; legs: LatLon[][] } | null>(null);

  useEffect(() => {
    if (!roads || pts.length < 2) return;
    const hit = cache.get(key);
    if (hit) return setState({ key, legs: hit });
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 6000);
    fetch(`https://router.project-osrm.org/route/v1/driving/${key}?overview=false&steps=true&geometries=geojson`, { signal: ctl.signal })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((j) => {
        const legs: LatLon[][] = (j.routes?.[0]?.legs ?? []).map((leg: { steps: { geometry: { coordinates: [number, number][] } }[] }) =>
          leg.steps.flatMap((s) => s.geometry.coordinates.map(([lon, lat]): LatLon => [lat, lon])),
        );
        if (legs.length === pts.length - 1 && legs.every((l) => l.length > 1)) {
          cache.set(key, legs);
          setState({ key, legs });
        }
      })
      .catch(() => undefined)
      .finally(() => clearTimeout(timer));
    return () => {
      clearTimeout(timer);
      ctl.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, roads]);

  if (roads && state?.key === key) return { legs: state.legs, source: 'roads' };
  return { legs: straight, source: 'straight' };
}

function along(line: LatLon[], f: number): LatLon {
  if (line.length < 2) return line[0];
  const seg = line.slice(1).map((p, i) => Math.hypot(p[0] - line[i][0], p[1] - line[i][1]));
  const total = seg.reduce((a, b) => a + b, 0);
  let target = Math.min(Math.max(f, 0), 1) * total;
  for (let i = 0; i < seg.length; i++) {
    if (target <= seg[i] || i === seg.length - 1) {
      const t = seg[i] ? target / seg[i] : 0;
      return [line[i][0] + (line[i + 1][0] - line[i][0]) * t, line[i][1] + (line[i + 1][1] - line[i][1]) * t];
    }
    target -= seg[i];
  }
  return line[line.length - 1];
}

/** Where the rep is at a minute of the day, and what they're doing. */
export function positionAt(plan: RoutePlan, legs: LatLon[][], minute: number): { pos: LatLon; label: string; stopIndex?: number } | null {
  const pts = waypoints(plan);
  if (!pts.length) return null;
  const offset = plan.start ? 1 : 0;
  const { segments } = planTimeline(plan);
  const seg = segments.find((s) => minute >= s.from && minute < s.to) ?? segments[segments.length - 1];
  if (!seg) return { pos: [pts[0].lat, pts[0].lon], label: plan.start?.name ?? '' };
  if (seg.kind === 'drive' && seg.stopIndex !== undefined) {
    const leg = legs[seg.stopIndex + offset - 1];
    const s = plan.stops[seg.stopIndex];
    const f = (minute - seg.from) / (seg.to - seg.from);
    return { pos: leg ? along(leg, f) : [s.lat, s.lon], label: `Driving to ${s.stop} · ${s.hcpName}`, stopIndex: seg.stopIndex };
  }
  if (seg.kind === 'visit' && seg.stopIndex !== undefined) {
    const s = plan.stops[seg.stopIndex];
    return { pos: [s.lat, s.lon], label: `At ${s.stop} · ${s.hcpName}`, stopIndex: seg.stopIndex };
  }
  // Waiting, a break or free time: wherever the last visit ended (or the office).
  const prev = [...plan.stops.entries()].reverse().find(([, s]) => toMin(s.depart) <= minute);
  const at = prev ? prev[1] : pts[0];
  const what = seg.kind === 'break' ? (seg.label ?? 'Break') : seg.kind === 'free' ? 'Free time' : 'Waiting';
  return { pos: [at.lat, at.lon], label: `${what}${prev ? ` near ${prev[1].stop}` : ` at ${plan.start?.name ?? 'start'}`}`, stopIndex: prev?.[0] };
}
