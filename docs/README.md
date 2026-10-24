# CoWork documentation

| # | Document | Read it for |
|---|---|---|
| 1 | [Architecture](01-architecture.md) | System diagram, Snowflake objects and roles, chat sequence, chart pipeline, auth modes, data model |
| 2 | [Local development](02-local-development.md) | Run modes (offline, OAuth, SPCS simulation), environment reference, tests |
| 3 | [Snowflake setup](03-snowflake-setup.md) | The setup scripts in order, agent grants, service user, OAuth, adding users |
| 4 | [SPCS deployment](04-spcs-deployment.md) | Images, router, build and push, service spec, endpoint access, releases, cost |
| 5 | [Operations](05-operations.md) | Health checks, logs, issues we hit and their fixes, security notes |

## Current deployment

| | |
|---|---|
| App URL | https://eaptzc-lbxplby-jj73300.snowflakecomputing.app |
| Account | `LBXPLBY-JJ73300` |
| Service | `COWORK_APP.SPCS.COWORK_SERVICE` on `COWORK_POOL` (CPU_X64_XS) |
| Images | `cowork_app/spcs/images/{cowork-api,cowork-web,cowork-router}:v1` |
| Agent | `DEV_REACT_COWORK.AGENTS.NBA_FIELD_REP_ASSISTANT` |
| App data | `COWORK_APP.CORE` |
| User role | `COWORK_USER` (users: account owner, `ARPAN`) |

## How we got here

1. **Plan.** We studied Snowflake CoWork's feature set (chat over governed data, charts, artifacts, memory, skills, deep research, automations) and the Cortex Agents Run API. We confirmed that charts arrive as a separate `response.chart` event carrying a Vega-Lite string, which explained why they were missing in typical clients.
2. **Build v1 offline.** Monorepo (Next.js + NestJS + shared TS), full Cortex event normalizer, chart fallback, artifacts, memory, skills. A mock agent emits real Cortex SSE, so all of it was built and tested without an account.
3. **Connect to Snowflake.** `01_setup.sql` → `02_remaining_setup.sql` (agent grants, key-pair service user, OAuth) → `.env`. Ran locally with per-user OAuth against the real agent.
4. **Deploy to SPCS.** Added `AUTH_MODE=spcs` (ingress identity + service token), Dockerfiles, an nginx router, `build_push.sh` and `05_spcs.sql`. Built and pushed the images, created the service, and fixed endpoint access (the missing USAGE on `COWORK_APP`/`SPCS`).
5. **Onboard users.** Created `ARPAN` with `COWORK_USER` as the only role.

## Design decisions

| Decision | Why |
|---|---|
| Cortex Agents as the only reasoning engine | Requirement. Keeps RBAC, semantic models and tools governed in Snowflake |
| Normalize Cortex SSE into our own event types (`packages/shared/src/events.ts`) | One vocabulary for API and browser, and tolerant of new Cortex event types |
| Same `BlockBuilder` on server and client | Streamed and reloaded messages render identically |
| Heuristic-first chart fallback, LLM second | Fast and deterministic. The LLM is only used for ambiguous result shapes |
| Document tables in Snowflake (`DATA VARIANT`) | One schema shape for all collections. The same code runs on a local JSON file offline. Hybrid tables aren't available on trial accounts |
| Redis optional | Single-instance SPCS works with the in-memory cache. Redis enables multi-instance caching and BullMQ |
| REST + SQL API via `fetch`, no native driver | Identical behavior locally and in SPCS. Streaming agent runs need raw HTTP anyway |
| Single public endpoint with an nginx router | Same origin for UI and API, unbuffered SSE, one URL to grant |
| Owner's rights in SPCS (for now) | Works without caller grants. Caller's rights is implemented behind a flag |

## Roadmap

| Phase | Items |
|---|---|
| **2** | Visual multi-agent workflow builder (React Flow DAG of agents → published as one chatbot), deep research (plan → parallel agent calls → cited report), dashboards from artifacts, richer sharing |
| **3** | Automations (scheduled prompts and skills with email via `SYSTEM$SEND_EMAIL`), file upload (stage + `AI_PARSE_DOCUMENT`), PDF/PPTX export, maps (`response.map`), MCP connectors, caller's rights in SPCS, Redis container in the service |
