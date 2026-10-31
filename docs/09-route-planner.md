# 9. Route Planner (v6)

A map-first page (**Route Planner** in the sidebar, `/planner`) on top of the
`FIELD_REP_DAY_PLANNER` Cortex agent. Pick any rep and any of the next five days. The
day is drawn on an interactive map. Change it by hand on the map or itinerary, or ask
the agent in plain words. Both paths write the same `FR_PLAN_OVERRIDES` table, so they
always agree.

## 9.1 What's on the page

| Area | What you can do |
|---|---|
| **Header** | Rep picker (`FR_REPS`; defaults to the rep whose `SNOWFLAKE_USER` is you), day chips (today + 4), open the whole route in Google Maps, show/hide chat |
| **Map** (Leaflet + OpenFreeMap vector tiles) | Office, lettered stops (tier dot, arrival time), legs drawn along roads with direction chevrons, hover a leg for km/min, the rep's other doctors as tier-coloured dots (click → **Add to this day** / **Prep brief**), "couldn't fit" doctors as dashed dots. Fit-route, map style (clean/streets), roads/straight-line toggle. Follows light/dark |
| **Itinerary** | Summary (visits, km, drive min, finish), day controls (**Start**, **Hard stop**, **Add break**, **Reset**), stop cards with the leg before each. **Drag a card** to reorder (PIN), or open it for **Earlier/Later**, **time on site ±5** (DWELL), **Next day** (PUSH), **Remove**, **Directions**, **Prep brief**. Free windows ("Fill it" asks the agent), couldn't-fit list ("Push to next day"), add a doctor by search |
| **Day strip** | The day as segments: drive (hatched), visit (lettered), free, break, waiting, hard stop line. Drag to scrub, or **Play** to watch a marker drive the route (~12 s) |
| **Ask the planner** | Chat with the agent. Context-aware chips (a selected stop gives "Prep me for Dr X", "Push Dr X to tomorrow"). When the agent re-plans, the map updates, changed stops flash and get **Added / Moved / New time** badges |

Mobile: the map sits on top, with Itinerary / Ask the planner tabs below.

## 9.2 How it works

```
browser ──/planner/plan────▶ API ── CALL FR_PLAN_ROUTE(rep, date, start) ──▶ Snowflake
        ──/planner/adjust──▶ API ── CALL FR_ADJUST_PLAN(rep, date, action, hcp, param)
        ──/planner/chat (SSE)▶ API ── agent :run (Cortex thread per user+rep+day)
                                       └ tool_result of plan_route / adjust_plan ─▶ route_plan event
        ──OSRM (road geometry), OpenFreeMap (tiles): straight from the browser
```

- **Map edits call the procedures directly**: about a second, deterministic, no LLM cost.
  **Chat goes through the agent**, which picks the tool and the action.
- The agent's procedure output arrives in `response.tool_result` (`content[].json.result`).
  The API parses it (`parseRoutePlan`, `packages/shared/src/route.ts`) and emits a
  `route_plan` event. If it can't, the reply's ` ```json route_plan ` block is the fallback.
  The block is hidden in the chat.
- The parser is tolerant: keys are case-insensitive, with common aliases
  (`arrive`/`arrival`, `travel_km`/`drive_km`…). Coordinates can come from the GeoJSON.
- Each chat message is prefixed with `[rep_id, plan_date, current stops]` so "stop C" or a
  doctor's name resolves to the right HCP even after map edits.
- If `CALL FR_PLAN_ROUTE` fails (e.g. no USAGE), the API asks the agent to plan instead.
  This is slower, but it works wherever the agent works.
- **Road geometry** comes from the public OSRM demo server and is only used to draw the
  legs. Times and km stay the planner's estimates (straight line × 1.4 at ~20 km/h, so
  "approx."). If OSRM is slow (>6 s) or unreachable, legs are straight lines.
- **Tiles:** OpenFreeMap (positron / dark / liberty / fiord): free, no key, no usage limits.
  OSM raster tiles are the fallback when WebGL is unavailable. Tiles and OSRM are fetched by
  the browser, so SPCS needs no external access integration.

## 9.3 Setup

1. Run **PART A** of `snowflake/10_release_v6.sql` as ACCOUNTADMIN. It grants COWORK_USER
   (inherited by the service role) USAGE on the agent and the `FR_*` procedures, SELECT on the
   semantic view, and USAGE on `COMPUTE_WH`, where the agent's tools run. You can point the
   agent at `COWORK_WH` instead.
2. `PLANNER_AGENT` (default `DEV_REACT_COWORK.AGENTS.FIELD_REP_DAY_PLANNER`) selects the
   agent. Its procedures and `FR_REPS` / `FR_HCPS` must live in the same schema.
3. Deploy: `TAG=v6 ./deploy/spcs/build_push.sh`, then **PART B** of the release script.

Offline (`CORTEX_MOCK=true`), the page uses a copy of the synthetic Bangalore data and a small
planner with the same rules (`apps/api/src/planner/mock-*.ts`). The chat understands push,
remove, add, first/second…, hard stop, break, start time, time on site, reset and prep.

## 9.4 API

| Endpoint | Body / query | Returns |
|---|---|---|
| `GET /planner/context` | | agent id, reps, default rep, today (account time zone), live/mock |
| `GET /planner/territory?repId=` | | the rep's doctors (`FR_HCPS`) |
| `POST /planner/plan` | `{ repId, date, startTime? }` | `RoutePlan` |
| `POST /planner/adjust` | `{ repId, date, action, hcpId?, param? }`: action is PUSH, REMOVE, ADD, PIN, HARD_STOP, START_TIME, BREAK, DWELL or RESET | re-planned `RoutePlan` |
| `POST /planner/chat` (SSE) | `{ repId, date, text, stops? }` | normalized agent events + `route_plan` |
