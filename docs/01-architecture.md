# 1. Architecture

CoWork is a self-hosted clone of Snowflake CoWork (formerly Snowflake Intelligence). It's a chat-first work agent over governed
Snowflake data. **Cortex Agents do all the reasoning.** The app adds the product around them: streaming chat with charts, saved
artifacts, user memory, skills and history. It's packaged as one Snowpark Container Services (SPCS) service.

## 1.1 Runtime architecture (production, SPCS)

```mermaid
flowchart LR
    user["User<br/>(browser or phone)"]

    subgraph sf["Snowflake account LBXPLBY-JJ73300"]
        ingress["SPCS ingress<br/>Snowflake login + access check<br/>eaptzc-lbxplby-jj73300.snowflakecomputing.app"]

        subgraph pool["Compute pool COWORK_POOL · CPU_X64_XS · 1 node"]
            subgraph svc["Service COWORK_APP.SPCS.COWORK_SERVICE · runs as COWORK_APP_SERVICE"]
                router["router<br/>nginx :8080<br/>(only public endpoint)"]
                web["web<br/>Next.js :3000"]
                api["api<br/>NestJS :4000"]
                token[("/snowflake/session/token<br/>service OAuth token")]
            end
        end

        subgraph apis["Snowflake APIs via SNOWFLAKE_HOST"]
            sqlapi["SQL API<br/>/api/v2/statements"]
            agentapi["Cortex Agents<br/>/agents/{name}:run (SSE)<br/>/cortex/threads"]
            llm["Cortex LLM functions<br/>COMPLETE · EMBED_TEXT_768"]
        end

        subgraph appdb["COWORK_APP.CORE · app metadata"]
            tables[("USERS · THREADS · MESSAGES<br/>ARTIFACTS · MEMORIES<br/>SKILLS · SETTINGS")]
        end

        subgraph agentdb["DEV_REACT_COWORK · your agent"]
            agent["Agent<br/>AGENTS.NBA_FIELD_REP_ASSISTANT"]
            tools["Tools: semantic view NBA_FIELD_SV,<br/>Cortex Search services, procedures,<br/>NBA_FIELD tables"]
        end

        repo[("Image repository<br/>COWORK_APP.SPCS.IMAGES")]
    end

    user -- "HTTPS" --> ingress
    ingress -- "adds Sf-Context-Current-User" --> router
    router -- "/*" --> web
    router -- "/api/* → strip prefix<br/>unbuffered (SSE)" --> api
    token -.-> api
    api --> sqlapi
    api --> agentapi
    sqlapi --> tables
    sqlapi --> llm
    agentapi --> agent
    agent --> tools
    repo -. "images pulled at start" .-> svc
```

Key points:

- **One public endpoint.** The `router` container is the only thing the ingress talks to. The browser loads pages and calls `/api/*` on the same origin, so there's no CORS and no cross-site cookies.
- **Containers share `localhost`** inside a service instance, which is how nginx reaches `web` and `api`.
- **Sign-in is Snowflake's.** The ingress logs the user in and checks endpoint access before any request reaches the app, then forwards the username in `Sf-Context-Current-User`. The API trusts that header in `AUTH_MODE=spcs`. The app has no passwords and no OAuth flow in production.
- **Snowflake access uses the service token.** SPCS mounts a short-lived OAuth token at `/snowflake/session/token` and refreshes it every few minutes. The API reads it on every call and talks to `https://$SNOWFLAKE_HOST`, which needs no external access integration.
- **Owner's rights.** Agent runs, SQL and LLM calls execute as the service owner role `COWORK_APP_SERVICE`, which inherits `COWORK_USER`. Every user of the app sees the same data. Per-user rights (caller's rights) is built in but off; see [§1.6](#16-auth-modes).

## 1.2 Snowflake objects, roles and grants

```mermaid
flowchart LR
    subgraph users["Users"]
        human["Human users<br/>(you, ARPAN, ...)<br/>default role COWORK_USER"]
        svcuser["COWORK_SVC<br/>TYPE=SERVICE · key-pair<br/>(local dev + image push)"]
    end

    subgraph roles["Roles (arrow = is granted to)"]
        cu["COWORK_USER<br/>end-user role"]
        cas["COWORK_APP_SERVICE<br/>backend / service owner"]
        sa["SYSADMIN → ACCOUNTADMIN"]
    end

    subgraph userobjs["Reachable by COWORK_USER"]
        o1["Warehouse COWORK_WH · USAGE"]
        o2["SNOWFLAKE.CORTEX_USER · database role"]
        o3["DEV_REACT_COWORK<br/>agent NBA_FIELD_REP_ASSISTANT · USAGE<br/>semantic view + tables · SELECT<br/>search services, procedures · USAGE"]
        o4["COWORK_APP, COWORK_APP.SPCS<br/>USAGE (name resolution only)"]
        o5["Service role COWORK_SERVICE!APP_USER<br/>→ opens endpoint 'app'"]
    end

    subgraph svcobjs["Owned / used by COWORK_APP_SERVICE"]
        s1["COWORK_APP.CORE · ALL<br/>app tables"]
        s2["Service COWORK_SERVICE<br/>Image repo IMAGES · OWNERSHIP"]
        s3["Compute pool COWORK_POOL<br/>USAGE, MONITOR"]
        s4["Account · BIND SERVICE ENDPOINT"]
    end

    human --> cu
    svcuser --> cas
    cu -- "granted to" --> cas
    cu --> sa
    cas --> sa
    cu --- userobjs
    cas --- svcobjs
```

`COWORK_APP_SERVICE` inherits `COWORK_USER`, so the service can run the agent with everything users can reach.

| Object | Purpose |
|---|---|
| `COWORK_WH` (XS, auto-suspend 60s) | Warehouse for SQL API calls and agent tool execution |
| `COWORK_USER` | What people sign in as. Can reach the agent and its data, and open the app endpoint. Can't read `COWORK_APP.CORE` |
| `COWORK_APP_SERVICE` | Owns the service, image repo and app tables. Inherits `COWORK_USER` so the service can run the agent |
| `COWORK_SVC` | Service *user* with a key pair. Used by the API when running locally (`APP_STORE=snowflake`) and by `build_push.sh` to log in to the image registry |
| `COWORK_APP.CORE` | App metadata tables, created by the API on first start |
| `COWORK_APP.SPCS` | Image repository `IMAGES` and service `COWORK_SERVICE` |
| `COWORK_POOL` | CPU_X64_XS compute pool, 1 node, auto-suspend after 1h idle |
| `COWORK_OAUTH` | OAuth security integration, used **only for local development** (`AUTH_MODE=oauth`) |
| `DEV_REACT_COWORK` | Your data and agent (`AGENTS.NBA_FIELD_REP_ASSISTANT`, `NBA_FIELD.*`) |

> Endpoint access needs **both** the service role (`COWORK_SERVICE!APP_USER`) **and** USAGE on the database and schema that
> contain the service. Without the second, the ingress returns `ERROR_FORBIDDEN`. See [Operations](05-operations.md#ingress-error_forbidden).

## 1.3 Repository layout

```
apps/web         Next.js 15 (App Router) UI
apps/api         NestJS 11 API
packages/shared  TypeScript shared by both: stream events, BlockBuilder, chart heuristics, models
snowflake/       Setup SQL (01, 02, 04 optional, 05 SPCS)
docker/          api.Dockerfile, web.Dockerfile, router/ (nginx), docker-compose.yml (local Redis)
deploy/spcs/     build_push.sh
docs/            This documentation
```

### API modules (`apps/api/src`)

| Module | Responsibility |
|---|---|
| `auth/` | Auth modes `dev` / `oauth` / `spcs`, session guard, user settings |
| `snowflake/` | `SnowflakeClient`: SQL API + REST via `fetch`, credentials (OAuth, key-pair JWT, PAT, SPCS token) |
| `store/` | `DocStore` abstraction: `SnowflakeStore` (tables in `COWORK_APP.CORE`) or `FileStore` (`.data/db.json`, offline) |
| `cortex/` | Agent discovery, Cortex threads, `run()` streaming, SSE parser, **event normalizer**, offline mock agent |
| `chat/` | Streaming turn orchestration, thread and message CRUD, feedback, auto titles |
| `charts/` | **Chart fallback** when an agent returns a table without a chart |
| `memory/` | Memory extraction (LLM or rules), embeddings, retrieval, CRUD |
| `artifacts/` | Save, list, share and live-refresh charts and tables |
| `skills/` | `/command` saved prompts |
| `llm/` | `SNOWFLAKE.CORTEX.COMPLETE` and `EMBED_TEXT_768` wrappers, each with a non-LLM fallback |
| `common/` | Cache (Redis or in-memory), job queue (BullMQ or in-process), ids, AES-GCM crypto |

### Web (`apps/web/src`)

| Area | Files |
|---|---|
| Shell | `app/(app)/layout.tsx`, `components/Sidebar.tsx` |
| Chat | `components/ChatView.tsx`, `Composer.tsx` (slash skills, voice), `AgentPicker.tsx`, `Message.tsx` |
| Result rendering | `components/blocks/ResultCard.tsx` (Chart / Table / SQL tabs), `Reasoning.tsx`, `VegaChart.tsx`, `DataTable.tsx` |
| State | `lib/chat-store.ts` (live stream via Zustand), `lib/hooks.ts` (TanStack Query), `lib/sse.ts` |
| Pages | `/`, `/c/[id]`, `/artifacts`, `/artifacts/[id]`, `/skills`, `/settings`, `/login` |

## 1.4 A chat turn, end to end

```mermaid
sequenceDiagram
    autonumber
    participant B as Browser
    participant I as SPCS ingress
    participant R as router (nginx)
    participant A as api (NestJS)
    participant S as Snowflake SQL API
    participant C as Cortex Agent

    B->>I: POST /api/chat/stream {agentId, text, threadId?}
    I->>I: Snowflake session + endpoint access check
    I->>R: forward + Sf-Context-Current-User
    R->>A: POST /chat/stream (unbuffered)
    A->>S: load settings, thread · insert user message
    A->>S: retrieve memories (embeddings)
    opt new thread
        A->>C: POST /api/v2/cortex/threads
    end
    A->>C: POST /agents/{name}:run (thread_id, parent_message_id,<br/>text prefixed with user_context memories)
    loop SSE events
        C-->>A: response.status / thinking.delta / tool_use / tool_result /<br/>table / chart / text.delta / metadata
        A->>A: normalize → StreamEvent, fold into BlockBuilder
        A-->>B: event: <type> (normalized)
    end
    alt table returned without chart
        A->>A: ChartService.fallback → chart {generated: true}
        A-->>B: event: chart
    end
    A->>S: insert assistant message (content blocks), update thread
    A-->>B: event: done {messageId}
    A->>S: memory extraction (COMPLETE) → insert MEMORIES
    A-->>B: event: memory {saved}
```

The browser runs the **same `BlockBuilder`** (from `packages/shared`) over the live events, so a streamed answer and a
reloaded one render identically.

## 1.5 How charts work (the main gap in typical Cortex Agent clients)

Cortex Agents stream charts as their own SSE event, `response.chart`. Its `chart_spec` is a **Vega-Lite v5 spec serialized
as a string**, and tables arrive separately as `response.table` (a SQL-API style `result_set`). Clients that only read
`response.text.delta` lose both. CoWork handles each step:

```mermaid
flowchart LR
    ev["Cortex SSE"] --> n["normalize.ts<br/>parse chart_spec string,<br/>result_set → TableData"]
    n --> bb["BlockBuilder<br/>groups tool / table / chart<br/>by tool_use_id"]
    bb --> q{"table without<br/>chart?"}
    q -- "no" --> ui
    q -- "yes" --> h["ChartService:<br/>column-type heuristic<br/>(time→line, category→bar,<br/>2 measures→scatter)"]
    h -- "undecided" --> l["Cortex COMPLETE → Vega-Lite,<br/>validated against columns"]
    h --> ui
    l --> ui
    ui["ResultCard<br/>Chart · Table · SQL tabs<br/>type toggle · PNG · Save artifact"]
```

- Native charts need the agent to have the `data_to_chart` tool plus an orchestration instruction to chart (see `snowflake/04_demo_agent.sql`).
- Charts are themed in `apps/web/src/lib/vega-theme.ts`: a fixed categorical palette, 2px lines, rounded bars capped at 24px, hairline grid, and separate light and dark steps.
- **Artifacts** store the spec, the table snapshot and the SQL. **Refresh** re-runs the SQL (cached `ARTIFACT_CACHE_TTL` seconds) and swaps fresh rows into the spec.

## 1.6 Auth modes

| `AUTH_MODE` | Who the user is | Snowflake credential | Used for |
|---|---|---|---|
| `dev` | Name typed on `/login` (session cookie) | Service user if configured, else none (pair with `CORTEX_MOCK=true`) | Offline development |
| `oauth` | Snowflake OAuth authorization-code flow (`COWORK_OAUTH`), refresh token AES-GCM encrypted in the cache | **The user's own OAuth token**, so each user's role applies | Local development against Snowflake |
| `spcs` | `Sf-Context-Current-User` header from the ingress | SPCS service token (owner's rights) | Production |

Caller's rights in SPCS (`SPCS_CALLER_RIGHTS=true`) sends `<service token>.<Sf-Context-Current-User-Token>` so queries run as
the signed-in user. It also needs `executeAsCaller: true` in the spec and `GRANT CALLER ...` privileges. It's implemented but
not enabled or verified.

## 1.7 Data model (`COWORK_APP.CORE`)

Every collection is a table with the same shape. Real columns hold ownership and parent lookups, and the document lives in `DATA`:

```sql
ID STRING PRIMARY KEY, USER_ID STRING, PARENT_ID STRING, DATA VARIANT,
CREATED_AT TIMESTAMP_NTZ, UPDATED_AT TIMESTAMP_NTZ
```

| Table | `PARENT_ID` | Document (`packages/shared/src/models.ts`) |
|---|---|---|
| `USERS` | – | `User` (id `u_<username>`) |
| `THREADS` | – | `Thread`: title, agentId, `cortexThreadId`, `lastCortexMessageId`, pinned |
| `MESSAGES` | thread id | `Message`: role, `content: ContentBlock[]`, feedback |
| `ARTIFACTS` | – | `Artifact`: type, title, spec, table, sql, sharedWith |
| `MEMORIES` | – | `Memory`: text, category, source, embedding (768-d) |
| `SKILLS` | – | `Skill`: name, prompt (`{{input}}`), description |
| `SETTINGS` | – | `UserSettings`: memoryEnabled, autoChart, defaultAgentId |

Standard tables (not hybrid tables, which trial accounts don't offer) behind a cache. Agent lists, user records, memories and
artifact refreshes are cached in Redis when `REDIS_URL` is set, or in memory otherwise.
