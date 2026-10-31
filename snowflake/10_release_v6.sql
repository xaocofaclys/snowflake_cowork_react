-- =====================================================================================
-- 10_release_v6.sql: v6 "Route Planner". A map-first page on top of the
-- FIELD_REP_DAY_PLANNER agent: plan any rep's day, edit it on the map (FR_ADJUST_PLAN),
-- or ask the agent to change it.
--
-- PART A (run now, as ACCOUNTADMIN): grants so COWORK_USER (and the SPCS service role,
--         which inherits it) can use the agent, its procedures, its semantic view and the
--         warehouse its tools run on.
-- PART B (after `TAG=v6 ./deploy/spcs/build_push.sh`): roll the service to the v6 images.
--
-- v6 is cumulative: it also ships v4.1 (assistant layer) and v5 (the Flurry experience),
-- which were never pushed (the repository had v1-v4 on 2026-10-31). No other new objects.
-- Roll back: run 07_release_v4.sql (the :v4 images stay in the repository).
-- =====================================================================================

-- ---------- PART A: grants ----------
USE ROLE ACCOUNTADMIN;

GRANT USAGE ON AGENT DEV_REACT_COWORK.AGENTS.FIELD_REP_DAY_PLANNER TO ROLE COWORK_USER;

-- FR_PLAN_ROUTE, FR_ADJUST_PLAN, FR_PREP_BRIEF (and any procedures added later).
GRANT USAGE ON ALL PROCEDURES IN SCHEMA DEV_REACT_COWORK.AGENTS TO ROLE COWORK_USER;
GRANT USAGE ON FUTURE PROCEDURES IN SCHEMA DEV_REACT_COWORK.AGENTS TO ROLE COWORK_USER;

-- The field_rep_analytics tool (Cortex Analyst over FR_FIELD_REP_SV).
GRANT SELECT ON ALL SEMANTIC VIEWS IN SCHEMA DEV_REACT_COWORK.AGENTS TO ROLE COWORK_USER;
GRANT SELECT ON FUTURE SEMANTIC VIEWS IN SCHEMA DEV_REACT_COWORK.AGENTS TO ROLE COWORK_USER;

-- Only needed if the FR_ procedures run with caller's rights; harmless otherwise.
GRANT INSERT, DELETE ON TABLE DEV_REACT_COWORK.AGENTS.FR_PLAN_OVERRIDES TO ROLE COWORK_USER;

-- The agent's tools execute on COMPUTE_WH. Either grant it...
GRANT USAGE ON WAREHOUSE COMPUTE_WH TO ROLE COWORK_USER;
-- ...or point the agent's tool_resources at COWORK_WH instead and skip the line above.

-- Check (as the service role): should list FR_PLAN_ROUTE, FR_ADJUST_PLAN, FR_PREP_BRIEF.
USE ROLE COWORK_APP_SERVICE;
SHOW PROCEDURES LIKE 'FR_%' IN SCHEMA DEV_REACT_COWORK.AGENTS;

-- ---------- PART B: service spec (v6 images) ----------
USE ROLE COWORK_APP_SERVICE;
ALTER SERVICE COWORK_APP.SPCS.COWORK_SERVICE FROM SPECIFICATION $$
spec:
  containers:
  - name: router
    image: /cowork_app/spcs/images/cowork-router:v6
    resources:
      requests: { cpu: 0.1, memory: 128M }
      limits: { cpu: 0.25, memory: 256M }
    readinessProbe: { port: 8080, path: /healthz }
  - name: web
    image: /cowork_app/spcs/images/cowork-web:v6
    env:
      PORT: "3000"
      HOSTNAME: 0.0.0.0
    resources:
      requests: { cpu: 0.3, memory: 512M }
      limits: { cpu: 1, memory: 1G }
    readinessProbe: { port: 3000, path: /login }
  - name: api
    image: /cowork_app/spcs/images/cowork-api:v6
    env:
      PORT: "4000"
      AUTH_MODE: spcs
      APP_STORE: snowflake
      CORTEX_MOCK: "false"
      SNOWFLAKE_WAREHOUSE: COWORK_WH
      SNOWFLAKE_ROLE: COWORK_USER
      APP_DATABASE: COWORK_APP
      APP_SCHEMA: CORE
      AGENT_LOCATIONS: DEV_REACT_COWORK.AGENTS
      LLM_MODEL: llama3.1-70b
      EMBED_MODEL: snowflake-arctic-embed-m-v1.5
      WORKFLOW_BUILDER_ROLE: ""
      RESEARCH_MODEL: claude-sonnet-4-5
      EMAIL_INTEGRATION: COWORK_EMAIL
      APP_PUBLIC_URL: https://eaptzc-lbxplby-jj73300.snowflakecomputing.app
      PLANNER_AGENT: DEV_REACT_COWORK.AGENTS.FIELD_REP_DAY_PLANNER
    resources:
      requests: { cpu: 0.5, memory: 1G }
      limits: { cpu: 1, memory: 2G }
    readinessProbe: { port: 4000, path: /health }
  endpoints:
  - name: app
    port: 8080
    public: true
serviceRoles:
- name: app_user
  endpoints:
  - app
$$;
-- The service was SUSPENDED on 2026-10-31. Resume the pool, then the service (skip either if it's
-- already running). Ready in ~3-5 min.
ALTER COMPUTE POOL COWORK_POOL RESUME;
ALTER SERVICE COWORK_APP.SPCS.COWORK_SERVICE RESUME;
SELECT SYSTEM$GET_SERVICE_STATUS('COWORK_APP.SPCS.COWORK_SERVICE');  -- wait for 3x READY

-- Smoke test in the app: Home loads in the new look; Route Planner shows your day with the office
-- pin and road legs; a map edit (e.g. Later on a stop) re-plans; "Prep me for stop A" streams a brief.
