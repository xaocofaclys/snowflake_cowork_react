-- =====================================================================================
-- 05_spcs.sql: deploy CoWork to Snowpark Container Services.
-- Prereqs: 01_setup.sql and 02_remaining_setup.sql have been run.
--
-- Order:  PART 1 (here) → push images (deploy/spcs/build_push.sh) → PART 2 → PART 3
-- =====================================================================================

-- -------------------------------------------------------------------------------------
-- PART 1: infrastructure (ACCOUNTADMIN)
-- -------------------------------------------------------------------------------------
USE ROLE ACCOUNTADMIN;

-- The service runs as its owner role, COWORK_APP_SERVICE. Give it everything app users can
-- reach (your agent + its data, from 02_remaining_setup.sql) on top of the app database.
GRANT ROLE COWORK_USER TO ROLE COWORK_APP_SERVICE;

CREATE SCHEMA IF NOT EXISTS COWORK_APP.SPCS;
GRANT ALL ON SCHEMA COWORK_APP.SPCS TO ROLE COWORK_APP_SERVICE;

CREATE COMPUTE POOL IF NOT EXISTS COWORK_POOL
  MIN_NODES = 1
  MAX_NODES = 1
  INSTANCE_FAMILY = CPU_X64_XS
  AUTO_RESUME = TRUE
  AUTO_SUSPEND_SECS = 3600
  COMMENT = 'CoWork app';
GRANT USAGE, MONITOR ON COMPUTE POOL COWORK_POOL TO ROLE COWORK_APP_SERVICE;

-- Needed to create a public (ingress) endpoint.
GRANT BIND SERVICE ENDPOINT ON ACCOUNT TO ROLE COWORK_APP_SERVICE;

USE ROLE COWORK_APP_SERVICE;
CREATE IMAGE REPOSITORY IF NOT EXISTS COWORK_APP.SPCS.IMAGES;
-- repository_url is where build_push.sh pushes, e.g.
-- lbxplby-jj73300.registry.snowflakecomputing.com/cowork_app/spcs/images
SHOW IMAGE REPOSITORIES IN SCHEMA COWORK_APP.SPCS;

-- The pool takes a few minutes to reach ACTIVE/IDLE; PART 2 waits for it anyway.
DESCRIBE COMPUTE POOL COWORK_POOL;

-- ======> Now run:  ./deploy/spcs/build_push.sh   (pushes cowork-api, cowork-web, cowork-router)
-- Check the images arrived:
SHOW IMAGES IN IMAGE REPOSITORY COWORK_APP.SPCS.IMAGES;

-- -------------------------------------------------------------------------------------
-- PART 2: the service (COWORK_APP_SERVICE)
--   router (public :8080) → /api/* to api :4000, everything else to web :3000
-- -------------------------------------------------------------------------------------
USE ROLE COWORK_APP_SERVICE;
USE WAREHOUSE COWORK_WH;

CREATE SERVICE IF NOT EXISTS COWORK_APP.SPCS.COWORK_SERVICE
  IN COMPUTE POOL COWORK_POOL
  QUERY_WAREHOUSE = COWORK_WH
  MIN_INSTANCES = 1
  MAX_INSTANCES = 1
  COMMENT = 'CoWork app'
  FROM SPECIFICATION $$
spec:
  containers:
  - name: router
    image: /cowork_app/spcs/images/cowork-router:v1
    resources:
      requests: { cpu: 0.1, memory: 128M }
      limits: { cpu: 0.25, memory: 256M }
    readinessProbe: { port: 8080, path: /healthz }
  - name: web
    image: /cowork_app/spcs/images/cowork-web:v1
    env:
      PORT: "3000"
      HOSTNAME: 0.0.0.0
    resources:
      requests: { cpu: 0.3, memory: 512M }
      limits: { cpu: 1, memory: 1G }
    readinessProbe: { port: 3000, path: /login }
  - name: api
    image: /cowork_app/spcs/images/cowork-api:v1
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

-- Wait until every container reports READY (re-run until it does; first start pulls images).
SELECT SYSTEM$GET_SERVICE_STATUS('COWORK_APP.SPCS.COWORK_SERVICE');

-- The app URL is ingress_url (it shows "Endpoints provisioning in progress" for a minute or two).
SHOW ENDPOINTS IN SERVICE COWORK_APP.SPCS.COWORK_SERVICE;

-- -------------------------------------------------------------------------------------
-- PART 3: who can open the app
-- -------------------------------------------------------------------------------------
-- Endpoint access needs the service role AND usage on the database/schema holding the
-- service (to resolve its name); without the latter the ingress returns ERROR_FORBIDDEN.
-- This exposes nothing in COWORK_APP.CORE (no grants there).
USE ROLE ACCOUNTADMIN;
GRANT USAGE ON DATABASE COWORK_APP TO ROLE COWORK_USER;
GRANT USAGE ON SCHEMA COWORK_APP.SPCS TO ROLE COWORK_USER;

USE ROLE COWORK_APP_SERVICE;
GRANT SERVICE ROLE COWORK_APP.SPCS.COWORK_SERVICE!APP_USER TO ROLE COWORK_USER;

-- To give someone else access:  GRANT ROLE COWORK_USER TO USER <their_user>;
-- If the endpoint login says your role isn't allowed, make COWORK_USER your default role:
--   USE ROLE ACCOUNTADMIN;
--   SET me = CURRENT_USER();
--   ALTER USER IDENTIFIER($me) SET DEFAULT_ROLE = COWORK_USER;

-- -------------------------------------------------------------------------------------
-- Operations
-- -------------------------------------------------------------------------------------
-- Logs per container (api / web / router):
--   SELECT SYSTEM$GET_SERVICE_LOGS('COWORK_APP.SPCS.COWORK_SERVICE', 0, 'api', 200);
--
-- Deploy a new version: TAG=v2 ./deploy/spcs/build_push.sh, then re-run the CREATE SERVICE
-- block above as ALTER SERVICE with the new tags:
--   ALTER SERVICE COWORK_APP.SPCS.COWORK_SERVICE FROM SPECIFICATION $$ ...same spec, :v2 tags... $$;
--
-- Save credits when not using it:
--   ALTER SERVICE COWORK_APP.SPCS.COWORK_SERVICE SUSPEND;
--   ALTER COMPUTE POOL COWORK_POOL SUSPEND;
-- Bring it back:
--   ALTER COMPUTE POOL COWORK_POOL RESUME;
--   ALTER SERVICE COWORK_APP.SPCS.COWORK_SERVICE RESUME;
