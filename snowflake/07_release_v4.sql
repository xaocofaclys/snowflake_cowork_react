-- =====================================================================================
-- 07_release_v4.sql: v4 (dashboards built from chat: KPI cards, filters, cross-filtering,
-- drill-down, editing in chat). Same spec as v3 with :v4 images; no new grants or objects.
-- Steps: TAG=v4 ./deploy/spcs/build_push.sh → run this file in Snowsight → wait for 3× READY.
-- Roll back: run 06_phase2.sql PART C (the :v3 images are still in the repository).
-- =====================================================================================
USE ROLE COWORK_APP_SERVICE;
ALTER SERVICE COWORK_APP.SPCS.COWORK_SERVICE FROM SPECIFICATION $$
spec:
  containers:
  - name: router
    image: /cowork_app/spcs/images/cowork-router:v4
    resources:
      requests: { cpu: 0.1, memory: 128M }
      limits: { cpu: 0.25, memory: 256M }
    readinessProbe: { port: 8080, path: /healthz }
  - name: web
    image: /cowork_app/spcs/images/cowork-web:v4
    env:
      PORT: "3000"
      HOSTNAME: 0.0.0.0
    resources:
      requests: { cpu: 0.3, memory: 512M }
      limits: { cpu: 1, memory: 1G }
    readinessProbe: { port: 3000, path: /login }
  - name: api
    image: /cowork_app/spcs/images/cowork-api:v4
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
SELECT SYSTEM$GET_SERVICE_STATUS('COWORK_APP.SPCS.COWORK_SERVICE');
