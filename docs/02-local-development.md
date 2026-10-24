# 2. Local development

## 2.1 Prerequisites

- Node.js 22+ and npm (the repo uses npm workspaces)
- Optional: Docker Desktop (local Redis, building images), Snowflake CLI (`snow`) for registry login

```bash
npm install
cp .env.example .env
npm run dev          # builds packages/shared, then runs shared (tsc --watch), api (:4000) and web (:3000)
```

Open http://localhost:3000.

## 2.2 Three ways to run locally

| Mode | `.env` | Needs Snowflake? | What you get |
|---|---|---|---|
| **Offline** | `AUTH_MODE=dev` `CORTEX_MOCK=true` `APP_STORE=file` | No | Dev login, a mock agent that emits the real Cortex SSE wire format, data in `.data/db.json` |
| **Live, per-user OAuth** | `AUTH_MODE=oauth` `CORTEX_MOCK=false` `APP_STORE=snowflake` + Snowflake values | Yes | "Sign in with Snowflake". Every query and agent call runs under the signed-in user's role |
| **SPCS simulation** (API only) | `AUTH_MODE=spcs` `SNOWFLAKE_HOST=…` `SPCS_TOKEN_PATH=<file>` | Optional | Exercises header-based auth. Send `Sf-Context-Current-User: NAME` with requests |

The mock agent recognizes questions about *monthly revenue*, *region*, *nation* and *top customers*. The customer and nation
questions deliberately return **a table without a chart**, which exercises the chart fallback.

## 2.3 Environment reference

All variables are read from the repo-root `.env` (both apps load it). Validation lives in `apps/api/src/config/env.ts`.

| Variable | Default | Notes |
|---|---|---|
| `AUTH_MODE` | `dev` | `dev` · `oauth` · `spcs` |
| `CORTEX_MOCK` | `false` | `true` = offline mock agent and no LLM calls |
| `APP_STORE` | `file` | `file` (`.data/db.json`) · `snowflake` (`COWORK_APP.CORE`) |
| `REDIS_URL` | – | Unset = in-memory cache and in-process jobs |
| `PORT` / `WEB_ORIGIN` | `4000` / `http://localhost:3000` | CORS origin for local dev |
| `NEXT_PUBLIC_API_URL` | `http://localhost:4000` | Baked into the web build; the Docker image uses `/api` |
| `SESSION_SECRET` | dev value | Encrypts refresh tokens (oauth mode). Generate with `openssl rand -hex 32` |
| `SNOWFLAKE_ACCOUNT_URL` | – | `https://lbxplby-jj73300.snowflakecomputing.com` (dashes, not underscores). Derived from `SNOWFLAKE_HOST` in spcs mode |
| `SNOWFLAKE_ACCOUNT` | – | `LBXPLBY-JJ73300`. Used in key-pair JWTs |
| `SNOWFLAKE_WAREHOUSE` / `SNOWFLAKE_ROLE` | `COWORK_WH` / `COWORK_USER` | The role is requested at OAuth sign-in |
| `OAUTH_CLIENT_ID` / `OAUTH_CLIENT_SECRET` / `OAUTH_REDIRECT_URI` | – / – / `http://localhost:4000/auth/callback` | From `SYSTEM$SHOW_OAUTH_CLIENT_SECRETS('COWORK_OAUTH')` |
| `SNOWFLAKE_SERVICE_USER` / `SNOWFLAKE_SERVICE_PRIVATE_KEY_PATH` | – | `COWORK_SVC` / `./cowork_svc.p8` (resolved from the repo root) |
| `SNOWFLAKE_SERVICE_PAT` | – | Alternative to the key pair |
| `SNOWFLAKE_SERVICE_ROLE` | `COWORK_APP_SERVICE` | |
| `APP_DATABASE` / `APP_SCHEMA` | `COWORK_APP` / `CORE` | |
| `AGENT_LOCATIONS` | – | `DEV_REACT_COWORK.AGENTS`. Comma-separated; empty = `SHOW AGENTS IN ACCOUNT` |
| `LLM_MODEL` / `EMBED_MODEL` | `llama3.1-70b` / `snowflake-arctic-embed-m-v1.5` | Memory extraction, titles, chart fallback |
| `ARTIFACT_CACHE_TTL` | `300` | Seconds |
| `SPCS_CALLER_RIGHTS` | `false` | spcs only, experimental |

Never commit `.env`, `*.p8` or `*.pub`; all three are in `.gitignore` and `.dockerignore`.

## 2.4 Scripts and tests

```bash
npm run dev          # everything, with watch
npm run build        # shared → api → web
npm run typecheck
npm test             # vitest: SSE parser, Cortex normalizer, BlockBuilder, chart heuristics, memory rules
```

Tests live in `packages/shared/test` and `apps/api/test`. `apps/api/test/normalize.test.ts` runs the mock agent through the
real parser end to end.

## 2.5 Conventions

- **Shared logic goes in `packages/shared`.** It's compiled to CommonJS (`dist/`), imported by the API, and transpiled by Next (`transpilePackages`).
- **Every LLM-assisted feature has a non-LLM fallback**: chart heuristics, rule-based memory extraction, heuristic titles. Features degrade instead of failing when a model isn't available.
- **The API tsconfig does not use `incremental`.** Nest's `deleteOutDir` combined with a stale `tsbuildinfo` makes `tsc` emit nothing, and the dev server then silently never starts.
