'use client';

import 'leaflet/dist/leaflet.css';
import 'maplibre-gl/dist/maplibre-gl.css';
import type * as Leaflet from 'leaflet';
import { useEffect, useRef, useState } from 'react';
import type { RoutePlan, StopChange, TerritoryHcp } from '@cowork/shared';
import type { LatLon } from '@/lib/route-geo';

export const TIER_COLOR: Record<string, string> = { A: '#e5484d', B: '#f59e0b', C: '#8792a2' };

/** OpenFreeMap vector styles: free, keyless, no usage limits (they carry their own attribution). */
const STYLE = {
  clean: (dark: boolean) => `https://tiles.openfreemap.org/styles/${dark ? 'dark' : 'positron'}`,
  streets: (dark: boolean) => `https://tiles.openfreemap.org/styles/${dark ? 'fiord' : 'liberty'}`,
};

export interface RouteMapProps {
  plan?: RoutePlan;
  legs: LatLon[][];
  territory: TerritoryHcp[];
  selected?: string;
  hovered?: string;
  changed: Record<string, StopChange>;
  playhead?: { pos: LatLon; label: string } | null;
  dark: boolean;
  tiles: 'clean' | 'streets';
  /** Changes when the map should re-frame the route (new rep or day). */
  fitKey: string;
  onSelect: (hcpId?: string) => void;
  onHover: (hcpId?: string) => void;
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

function bearing(a: LatLon, b: LatLon) {
  return (Math.atan2(b[1] - a[1], b[0] - a[0]) * 180) / Math.PI;
}

/** Leaflet map: office, lettered stops, road legs with direction chevrons, territory doctors, playhead. */
export function RouteMap(p: RouteMapProps) {
  const el = useRef<HTMLDivElement>(null);
  const L = useRef<typeof Leaflet>(null);
  const map = useRef<Leaflet.Map>(null);
  const baseLayer = useRef<Leaflet.Layer>(null);
  const layers = useRef<{ route: Leaflet.LayerGroup; marks: Leaflet.LayerGroup; terr: Leaflet.LayerGroup; play: Leaflet.LayerGroup }>(null);
  const [ready, setReady] = useState(false);
  const cb = useRef(p);
  cb.current = p;

  useEffect(() => {
    let dead = false;
    Promise.all([import('leaflet'), import('@maplibre/maplibre-gl-leaflet')]).then(([mod]) => {
      if (dead || !el.current || map.current) return;
      const lf = (mod.default ?? mod) as typeof Leaflet;
      L.current = lf;
      const m = lf.map(el.current, { zoomControl: false, attributionControl: true, center: [12.97, 77.6], zoom: 12 });
      lf.control.zoom({ position: 'bottomright' }).addTo(m);
      m.on('click', () => cb.current.onSelect(undefined));
      layers.current = { terr: lf.layerGroup().addTo(m), route: lf.layerGroup().addTo(m), marks: lf.layerGroup().addTo(m), play: lf.layerGroup().addTo(m) };
      map.current = m;
      setReady(true);
    });
    return () => {
      dead = true;
      map.current?.remove();
      map.current = null;
    };
  }, []);

  // Vector basemap that follows the theme; plain OSM raster tiles if WebGL isn't available.
  useEffect(() => {
    const lf = L.current;
    if (!ready || !lf || !map.current) return;
    baseLayer.current?.remove();
    const gl = (() => {
      try {
        return !!document.createElement('canvas').getContext('webgl2');
      } catch {
        return false;
      }
    })();
    baseLayer.current = gl
      ? lf.maplibreGL({ style: STYLE[p.tiles](p.dark) })
      : lf.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors' });
    baseLayer.current.addTo(map.current);
  }, [ready, p.dark, p.tiles]);

  // Route, stops and territory.
  useEffect(() => {
    const lf = L.current;
    const g = layers.current;
    if (!ready || !lf || !g) return;
    g.route.clearLayers();
    g.marks.clearLayers();
    g.terr.clearLayers();
    const plan = p.plan;
    const accent = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#1f6fd1';
    const casing = p.dark ? '#0c1016' : '#ffffff';
    const planned = new Set(plan?.stops.map((s) => s.hcpId));
    const unscheduled = new Set(plan?.unscheduled.map((u) => u.hcpId));

    // Territory doctors that aren't on today's route: small tier-coloured dots you can add.
    for (const h of p.territory) {
      if (planned.has(h.hcpId)) continue;
      const isSel = p.selected === h.hcpId;
      const missed = unscheduled.has(h.hcpId);
      const icon = lf.divIcon({
        className: 'rp-icon',
        iconSize: [18, 18],
        iconAnchor: [9, 9],
        html: `<div class="rp-dot${isSel ? ' is-selected' : ''}${missed ? ' is-missed' : ''}" style="--tier:${TIER_COLOR[h.tier ?? ''] ?? '#8792a2'}">${missed ? '!' : ''}</div>`,
      });
      lf.marker([h.lat, h.lon], { icon, zIndexOffset: isSel ? 900 : 0, keyboard: false })
        .bindTooltip(`<b>${esc(h.hcpName)}</b><br/>${esc([h.specialty, h.tier && `Tier ${h.tier}`, h.area].filter(Boolean).join(' · '))}${missed ? '<br/><i>Couldn’t fit today</i>' : '<br/><i>Click to add to the day</i>'}`, { direction: 'top', offset: [0, -8], className: 'rp-tip' })
        .on('click', (e) => {
          lf.DomEvent.stopPropagation(e);
          cb.current.onSelect(h.hcpId);
        })
        .addTo(g.terr);
    }

    if (!plan) return;
    const offset = plan.start ? 1 : 0;
    p.legs.forEach((leg, i) => {
      const stop = plan.stops[i + 1 - offset];
      if (!stop || leg.length < 2) return;
      const hot = p.hovered === stop.hcpId || p.selected === stop.hcpId;
      lf.polyline(leg, { color: casing, weight: hot ? 11 : 8, opacity: 0.95, lineCap: 'round', lineJoin: 'round', interactive: false }).addTo(g.route);
      const line = lf
        .polyline(leg, { color: accent, weight: hot ? 7 : 4.5, opacity: hot ? 1 : 0.88, lineCap: 'round', lineJoin: 'round' })
        .bindTooltip(`<b>→ ${esc(stop.stop)}</b> ${esc(stop.hcpName)}<br/>${[stop.travelKm !== undefined && `${stop.travelKm} km`, stop.travelMin !== undefined && `${stop.travelMin} min`].filter(Boolean).join(' · ')} <span style="opacity:.6">approx.</span>`, { sticky: true, className: 'rp-tip' })
        .on('mouseover', () => cb.current.onHover(stop.hcpId))
        .on('mouseout', () => cb.current.onHover(undefined))
        .on('click', (e) => {
          lf.DomEvent.stopPropagation(e);
          cb.current.onSelect(stop.hcpId);
        });
      line.addTo(g.route);
      // A chevron mid-leg shows the direction of travel.
      const mid = Math.floor(leg.length / 2);
      const a = leg[Math.max(0, mid - 1)];
      const b = leg[Math.min(leg.length - 1, mid + 1)];
      lf.marker(leg[mid], {
        interactive: false,
        keyboard: false,
        icon: lf.divIcon({ className: 'rp-icon', iconSize: [14, 14], iconAnchor: [7, 7], html: `<div class="rp-chevron" style="transform:rotate(${90 - bearing(a, b)}deg)"></div>` }),
      }).addTo(g.route);
    });

    if (plan.start) {
      lf.marker([plan.start.lat, plan.start.lon], {
        zIndexOffset: 500,
        icon: lf.divIcon({
          className: 'rp-icon',
          iconSize: [34, 34],
          iconAnchor: [17, 17],
          html: `<div class="rp-office"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 21h18"/><path d="M5 21V7l8-4v18"/><path d="M19 21V11l-6-4"/><path d="M9 9v.01M9 12v.01M9 15v.01M9 18v.01"/></svg></div>`,
        }),
      })
        .bindTooltip(`<b>${esc(plan.start.name)}</b>${plan.start.leaveAt ? `<br/>Leave at ${esc(plan.start.leaveAt)}` : ''}`, { direction: 'top', offset: [0, -14], className: 'rp-tip' })
        .addTo(g.marks);
    }

    plan.stops.forEach((s) => {
      const isSel = p.selected === s.hcpId;
      const isHot = p.hovered === s.hcpId;
      const change = p.changed[s.hcpId];
      lf.marker([s.lat, s.lon], {
        zIndexOffset: isSel ? 1000 : isHot ? 800 : 600,
        riseOnHover: true,
        icon: lf.divIcon({
          className: 'rp-icon',
          iconSize: [36, 44],
          iconAnchor: [18, 42],
          html: `<div class="rp-pin${isSel ? ' is-selected' : ''}${isHot ? ' is-hot' : ''}${change ? ` is-${change}` : ''}"><span>${esc(s.stop)}</span><i style="background:${TIER_COLOR[s.tier ?? ''] ?? 'transparent'}"></i></div><div class="rp-time">${esc(s.arrive)}</div>`,
        }),
      })
        .bindTooltip(`<b>${esc(s.stop)} · ${esc(s.hcpName)}</b><br/>${esc(s.arrive)}–${esc(s.depart)} · ${esc([s.specialty, s.tier && `Tier ${s.tier}`].filter(Boolean).join(', '))}`, { direction: 'top', offset: [0, -40], className: 'rp-tip' })
        .on('mouseover', () => cb.current.onHover(s.hcpId))
        .on('mouseout', () => cb.current.onHover(undefined))
        .on('click', (e) => {
          lf.DomEvent.stopPropagation(e);
          cb.current.onSelect(s.hcpId);
        })
        .addTo(g.marks);
    });
  }, [ready, p.plan, p.legs, p.territory, p.selected, p.hovered, p.changed, p.dark]);

  // Frame the whole day when the rep or date changes.
  useEffect(() => {
    const lf = L.current;
    if (!ready || !lf || !map.current || !p.plan) return;
    const pts: LatLon[] = [...(p.plan.start ? [[p.plan.start.lat, p.plan.start.lon] as LatLon] : []), ...p.plan.stops.map((s): LatLon => [s.lat, s.lon])];
    if (pts.length) map.current.flyToBounds(lf.latLngBounds(pts), { padding: [70, 70], maxZoom: 14, duration: 0.8 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, p.fitKey, !!p.plan]);

  // Pan to a selected doctor if it's off screen.
  useEffect(() => {
    const m = map.current;
    if (!ready || !m || !p.selected) return;
    const s = p.plan?.stops.find((x) => x.hcpId === p.selected) ?? p.territory.find((x) => x.hcpId === p.selected);
    if (s && !m.getBounds().pad(-0.15).contains([s.lat, s.lon])) m.panTo([s.lat, s.lon], { animate: true });
  }, [ready, p.selected, p.plan, p.territory]);

  // "Play the day": a marker moving along the route.
  useEffect(() => {
    const lf = L.current;
    const g = layers.current;
    if (!ready || !lf || !g) return;
    g.play.clearLayers();
    if (!p.playhead) return;
    lf.marker(p.playhead.pos, {
      interactive: false,
      zIndexOffset: 2000,
      icon: lf.divIcon({ className: 'rp-icon', iconSize: [22, 22], iconAnchor: [11, 11], html: '<div class="rp-me"></div>' }),
    }).addTo(g.play);
  }, [ready, p.playhead]);

  return <div ref={el} className="rp-map h-full w-full" />;
}
