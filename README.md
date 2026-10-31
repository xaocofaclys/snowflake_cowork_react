# Flurry: a Snowflake CoWork-style app on Cortex Agents

> *A flurry of Snowflake agents, one answer.* (The repo and Snowflake objects keep the original `cowork` names.)

Chat with your Snowflake data through Cortex Agents, with streamed reasoning, SQL, tables and **charts** (including charts the
agent didn't draw), saved artifacts with live refresh, user memory, `/skills` and chat history. Combine agents into
**workflows**, run **deep research** with cited reports, build **dashboards**, schedule **automations** with email, and
export to **PDF / PowerPoint**. Built with Next.js + NestJS and deployed on Snowpark Container Services.

**Live:** https://eaptzc-lbxplby-jj73300.snowflakecomputing.app · **Docs:** [docs/](docs/README.md)

```mermaid
flowchart LR
    U["Browser"] --> I["SPCS ingress<br/>(Snowflake login)"]
    I --> R["router · nginx"]
    R -- "/*" --> W["web · Next.js"]
    R -- "/api/*" --> A["api · NestJS"]
    A --> CA["Cortex Agents"]
    A --> SQL["SQL API → COWORK_APP.CORE"]
```

## Quick start (offline, no Snowflake)

```bash
npm install
cp .env.example .env     # set AUTH_MODE=dev, CORTEX_MOCK=true, APP_STORE=file
npm run dev              # web :3000 · api :4000
```

Try "Show monthly revenue for 1997", "Top 10 customers by spend" (table only, so it gets auto-charted) and "I prefer bar charts" (memory).

## Repository

```
apps/web         Next.js UI          apps/api         NestJS API
packages/shared  shared TS logic     snowflake/       setup + SPCS SQL
docker/          Dockerfiles, nginx  deploy/spcs/     build_push.sh
docs/            documentation
```

## Documentation

1. [Architecture](docs/01-architecture.md): diagrams, Snowflake objects and roles, chat flow, chart pipeline
2. [Local development](docs/02-local-development.md): run modes, env reference, tests
3. [Snowflake setup](docs/03-snowflake-setup.md): setup scripts, agent grants, users
4. [SPCS deployment](docs/04-spcs-deployment.md): build, push, deploy, release
5. [Operations](docs/05-operations.md): health checks, troubleshooting, security
6. [Workflows](docs/06-workflows.md): combine Snowflake agents into one chatbot
7. [Deep research, dashboards, automations, export](docs/07-research-dashboards-automations.md)
8. [The Flurry experience](docs/08-experience.md)
9. [Route Planner](docs/09-route-planner.md): plan a field rep's day on an interactive map with the planner agent

## Tests

```bash
npm test && npm run typecheck
```
