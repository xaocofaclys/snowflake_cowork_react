-- =====================================================================================
-- 06_phase2.sql: Phase 2 + 3 (workflows, automatic agent access, deep research, dashboards,
-- automations with email, auto start/stop on IST). Released together as image tag v3.
-- Prereqs: 01, 02, 05 done; service running.
--
--   PART A  ACCOUNTADMIN       grants only an admin can make            (run in Snowsight)
--   PART B  COWORK_APP_SERVICE procedures + tasks for start/stop       (Snowsight or snow CLI)
--   PART C  COWORK_APP_SERVICE deploy v3 images                        (after build_push.sh TAG=v3)
-- =====================================================================================

-- -------------------------------------------------------------------------------------
-- PART A: ACCOUNTADMIN
-- -------------------------------------------------------------------------------------
USE ROLE ACCOUNTADMIN;

-- A1. Every agent in DEV_REACT_COWORK.AGENTS, now and in future, is usable by COWORK_USER
--     (and therefore by the app, whose role inherits COWORK_USER).
GRANT USAGE ON ALL AGENTS IN SCHEMA DEV_REACT_COWORK.AGENTS TO ROLE COWORK_USER;
GRANT USAGE ON FUTURE AGENTS IN SCHEMA DEV_REACT_COWORK.AGENTS TO ROLE COWORK_USER;

-- A2. Objects agents' tools use. Repeat the block for every schema your agents read from.
GRANT SELECT ON ALL TABLES IN SCHEMA DEV_REACT_COWORK.NBA_FIELD TO ROLE COWORK_USER;
GRANT SELECT ON FUTURE TABLES IN SCHEMA DEV_REACT_COWORK.NBA_FIELD TO ROLE COWORK_USER;
GRANT SELECT ON ALL VIEWS IN SCHEMA DEV_REACT_COWORK.NBA_FIELD TO ROLE COWORK_USER;
GRANT SELECT ON FUTURE VIEWS IN SCHEMA DEV_REACT_COWORK.NBA_FIELD TO ROLE COWORK_USER;
GRANT SELECT ON ALL SEMANTIC VIEWS IN SCHEMA DEV_REACT_COWORK.NBA_FIELD TO ROLE COWORK_USER;
GRANT SELECT ON FUTURE SEMANTIC VIEWS IN SCHEMA DEV_REACT_COWORK.NBA_FIELD TO ROLE COWORK_USER;
GRANT USAGE ON ALL CORTEX SEARCH SERVICES IN SCHEMA DEV_REACT_COWORK.NBA_FIELD TO ROLE COWORK_USER;
GRANT USAGE ON FUTURE CORTEX SEARCH SERVICES IN SCHEMA DEV_REACT_COWORK.NBA_FIELD TO ROLE COWORK_USER;
GRANT USAGE ON ALL PROCEDURES IN SCHEMA DEV_REACT_COWORK.NBA_FIELD TO ROLE COWORK_USER;
GRANT USAGE ON FUTURE PROCEDURES IN SCHEMA DEV_REACT_COWORK.NBA_FIELD TO ROLE COWORK_USER;
GRANT USAGE ON ALL FUNCTIONS IN SCHEMA DEV_REACT_COWORK.NBA_FIELD TO ROLE COWORK_USER;
GRANT USAGE ON FUTURE FUNCTIONS IN SCHEMA DEV_REACT_COWORK.NBA_FIELD TO ROLE COWORK_USER;
-- Note: CREATE OR REPLACE AGENT ... COPY GRANTS skips future grants. Create agents without
-- COPY GRANTS, or re-run the "ALL AGENTS" line after replacing one.

-- A3. Let the app role run scheduled tasks (serverless) and start/stop the compute pool.
GRANT EXECUTE TASK, EXECUTE MANAGED TASK ON ACCOUNT TO ROLE COWORK_APP_SERVICE;
GRANT OPERATE ON COMPUTE POOL COWORK_POOL TO ROLE COWORK_APP_SERVICE;
-- Pool releases its node 5 min after the service stops (was 60).
ALTER COMPUTE POOL COWORK_POOL SET AUTO_SUSPEND_SECS = 300;

-- A5. Email for automations (SYSTEM$SEND_EMAIL). Snowflake delivers only to *verified* email
--     addresses of users in this account (Snowsight → your profile → verify email).
CREATE NOTIFICATION INTEGRATION IF NOT EXISTS COWORK_EMAIL
  TYPE = EMAIL
  ENABLED = TRUE
  COMMENT = 'CoWork automation emails';
GRANT USAGE ON INTEGRATION COWORK_EMAIL TO ROLE COWORK_APP_SERVICE;

-- A4. (Later, optional) restrict workflow building to a role:
--   CREATE ROLE IF NOT EXISTS COWORK_BUILDER;
--   GRANT ROLE COWORK_BUILDER TO USER <builder_user>;
--   GRANT ROLE COWORK_BUILDER TO ROLE COWORK_APP_SERVICE;     -- lets the app read its members
--   then set WORKFLOW_BUILDER_ROLE: COWORK_BUILDER in the service spec (PART C) and ALTER SERVICE.

-- -------------------------------------------------------------------------------------
-- PART B: auto start/stop (COWORK_APP_SERVICE, which owns the service)
--   09:00 IST Mon–Fri   task starts the app
--   working hours       stays up (09:00–20:00 IST, Mon–Fri)
--   otherwise           every 15 min: stop if nobody used it for 60 min
--   automations         every 15 min: start the app if a run is due within 20 min;
--                       never stop it while a run is due within 30 min or still running
--   any time            anyone with COWORK_USER can: CALL COWORK_APP.SPCS.START_COWORK();
-- -------------------------------------------------------------------------------------
USE ROLE COWORK_APP_SERVICE;
USE WAREHOUSE COWORK_WH;

-- Tables the procedures read (the API creates them too; same shape as every app collection).
-- ACTIVITY: row ID='app', UPDATED_AT = last use. AUTOMATIONS / AUTOMATION_RUNS: schedules and runs.
CREATE TABLE IF NOT EXISTS COWORK_APP.CORE.ACTIVITY (
  ID STRING PRIMARY KEY, USER_ID STRING, PARENT_ID STRING, DATA VARIANT,
  CREATED_AT TIMESTAMP_NTZ DEFAULT SYSDATE(), UPDATED_AT TIMESTAMP_NTZ DEFAULT SYSDATE());
CREATE TABLE IF NOT EXISTS COWORK_APP.CORE.AUTOMATIONS (
  ID STRING PRIMARY KEY, USER_ID STRING, PARENT_ID STRING, DATA VARIANT,
  CREATED_AT TIMESTAMP_NTZ DEFAULT SYSDATE(), UPDATED_AT TIMESTAMP_NTZ DEFAULT SYSDATE());
CREATE TABLE IF NOT EXISTS COWORK_APP.CORE.AUTOMATION_RUNS (
  ID STRING PRIMARY KEY, USER_ID STRING, PARENT_ID STRING, DATA VARIANT,
  CREATED_AT TIMESTAMP_NTZ DEFAULT SYSDATE(), UPDATED_AT TIMESTAMP_NTZ DEFAULT SYSDATE());

CREATE OR REPLACE PROCEDURE COWORK_APP.SPCS.START_COWORK()
  RETURNS STRING
  LANGUAGE SQL
  EXECUTE AS OWNER
AS
$$
BEGIN
  BEGIN
    ALTER COMPUTE POOL COWORK_POOL RESUME;
  EXCEPTION WHEN OTHER THEN NULL;    -- already active
  END;
  BEGIN
    ALTER SERVICE COWORK_APP.SPCS.COWORK_SERVICE RESUME;
  EXCEPTION WHEN OTHER THEN NULL;    -- already running
  END;
  -- Counts as activity, so the idle check gives the starter a full idle window.
  MERGE INTO COWORK_APP.CORE.ACTIVITY t USING (SELECT 'app' AS ID) s ON t.ID = s.ID
    WHEN MATCHED THEN UPDATE SET UPDATED_AT = SYSDATE()
    WHEN NOT MATCHED THEN INSERT (ID, USER_ID, DATA, CREATED_AT, UPDATED_AT)
      VALUES ('app', 'system', OBJECT_CONSTRUCT('id', 'app', 'userId', 'system'), SYSDATE(), SYSDATE());
  RETURN 'CoWork is starting. It is usually ready in 3-5 minutes at https://eaptzc-lbxplby-jj73300.snowflakecomputing.app';
END;
$$;

CREATE OR REPLACE PROCEDURE COWORK_APP.SPCS.STOP_COWORK()
  RETURNS STRING
  LANGUAGE SQL
  EXECUTE AS OWNER
AS
$$
BEGIN
  BEGIN
    ALTER SERVICE COWORK_APP.SPCS.COWORK_SERVICE SUSPEND;
  EXCEPTION WHEN OTHER THEN NULL;
  END;
  BEGIN
    ALTER COMPUTE POOL COWORK_POOL SUSPEND;
  EXCEPTION WHEN OTHER THEN NULL;    -- if the service is still stopping, AUTO_SUSPEND_SECS=300 finishes the job
  END;
  RETURN 'CoWork stopped.';
END;
$$;

CREATE OR REPLACE PROCEDURE COWORK_APP.SPCS.COWORK_IDLE_CHECK(IDLE_MINUTES NUMBER)
  RETURNS STRING
  LANGUAGE SQL
  EXECUTE AS OWNER
AS
$$
DECLARE
  now_ist TIMESTAMP_NTZ;
  svc_status STRING;
  last_seen TIMESTAMP_NTZ;
  due_20 NUMBER;
  due_30 NUMBER;
  running NUMBER;
BEGIN
  SHOW SERVICES LIKE 'COWORK_SERVICE' IN SCHEMA COWORK_APP.SPCS;
  SELECT "status" INTO :svc_status FROM TABLE(RESULT_SCAN(LAST_QUERY_ID()));

  SELECT
    COUNT_IF(TRY_TO_TIMESTAMP_NTZ(DATA:nextRunAt::STRING) <= DATEADD('minute', 20, SYSDATE())),
    COUNT_IF(TRY_TO_TIMESTAMP_NTZ(DATA:nextRunAt::STRING) <= DATEADD('minute', 30, SYSDATE()))
  INTO :due_20, :due_30
  FROM COWORK_APP.CORE.AUTOMATIONS
  WHERE DATA:enabled::BOOLEAN = TRUE;

  -- Wake the app for an upcoming automation.
  IF (svc_status IS DISTINCT FROM 'RUNNING') THEN
    IF (due_20 > 0) THEN
      CALL COWORK_APP.SPCS.START_COWORK();
      RETURN 'started: automation due within 20 minutes';
    END IF;
    RETURN 'service is ' || COALESCE(svc_status, 'missing');
  END IF;

  now_ist := CONVERT_TIMEZONE('Asia/Kolkata', CURRENT_TIMESTAMP())::TIMESTAMP_NTZ;
  IF (DAYOFWEEKISO(now_ist) <= 5 AND HOUR(now_ist) >= 9 AND HOUR(now_ist) < 20) THEN
    RETURN 'working hours: keep running';
  END IF;

  SELECT COUNT(*) INTO :running FROM COWORK_APP.CORE.AUTOMATION_RUNS
  WHERE DATA:status::STRING = 'running' AND CREATED_AT > DATEADD('hour', -2, SYSDATE());
  IF (running > 0 OR due_30 > 0) THEN
    RETURN 'automation running or due soon: keep running';
  END IF;

  SELECT MAX(UPDATED_AT) INTO :last_seen FROM COWORK_APP.CORE.ACTIVITY WHERE ID = 'app';
  IF (last_seen IS NULL OR DATEDIFF('minute', last_seen, SYSDATE()) >= IDLE_MINUTES) THEN
    CALL COWORK_APP.SPCS.STOP_COWORK();
    RETURN 'idle since ' || COALESCE(last_seen::STRING, 'never') || ' UTC: stopped';
  END IF;
  RETURN 'active (last used ' || last_seen::STRING || ' UTC)';
END;
$$;

-- Anyone who can open the app can also start it.
GRANT USAGE ON PROCEDURE COWORK_APP.SPCS.START_COWORK() TO ROLE COWORK_USER;

-- Serverless tasks (no warehouse to wake; billed per second of compute).
CREATE OR REPLACE TASK COWORK_APP.SPCS.COWORK_START_WEEKDAYS
  SCHEDULE = 'USING CRON 0 9 * * MON-FRI Asia/Kolkata'
  USER_TASK_MANAGED_INITIAL_WAREHOUSE_SIZE = 'XSMALL'
  COMMENT = 'Start CoWork at 09:00 IST on weekdays'
AS
  CALL COWORK_APP.SPCS.START_COWORK();

CREATE OR REPLACE TASK COWORK_APP.SPCS.COWORK_IDLE_STOP
  SCHEDULE = 'USING CRON */15 * * * * Asia/Kolkata'
  USER_TASK_MANAGED_INITIAL_WAREHOUSE_SIZE = 'XSMALL'
  COMMENT = 'Wake CoWork for due automations; outside 09:00-20:00 IST weekdays stop it after 60 idle minutes'
AS
  CALL COWORK_APP.SPCS.COWORK_IDLE_CHECK(60);

ALTER TASK COWORK_APP.SPCS.COWORK_START_WEEKDAYS RESUME;
ALTER TASK COWORK_APP.SPCS.COWORK_IDLE_STOP RESUME;

-- Check:
--   SHOW TASKS IN SCHEMA COWORK_APP.SPCS;
--   CALL COWORK_APP.SPCS.COWORK_IDLE_CHECK(60);        -- dry look at what the task would do now
--   SELECT * FROM TABLE(INFORMATION_SCHEMA.TASK_HISTORY()) WHERE NAME LIKE 'COWORK_%' ORDER BY SCHEDULED_TIME DESC LIMIT 20;
-- Change hours: edit the CRON (start) and the HOUR() check in COWORK_IDLE_CHECK, re-run.
-- Pause automation: ALTER TASK COWORK_APP.SPCS.COWORK_IDLE_STOP SUSPEND; (same for START_WEEKDAYS)

-- -------------------------------------------------------------------------------------
-- PART C: deploy v3 (after: TAG=v3 ./deploy/spcs/build_push.sh)
-- -------------------------------------------------------------------------------------
USE ROLE COWORK_APP_SERVICE;
ALTER SERVICE COWORK_APP.SPCS.COWORK_SERVICE FROM SPECIFICATION $$
spec:
  containers:
  - name: router
    image: /cowork_app/spcs/images/cowork-router:v3
    resources:
      requests: { cpu: 0.1, memory: 128M }
      limits: { cpu: 0.25, memory: 256M }
    readinessProbe: { port: 8080, path: /healthz }
  - name: web
    image: /cowork_app/spcs/images/cowork-web:v3
    env:
      PORT: "3000"
      HOSTNAME: 0.0.0.0
    resources:
      requests: { cpu: 0.3, memory: 512M }
      limits: { cpu: 1, memory: 1G }
    readinessProbe: { port: 3000, path: /login }
  - name: api
    image: /cowork_app/spcs/images/cowork-api:v3
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
