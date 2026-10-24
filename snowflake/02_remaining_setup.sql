-- =====================================================================================
-- 02_remaining_setup.sql: run AFTER your 01_setup.sql (warehouse COWORK_WH, roles
-- COWORK_USER / COWORK_APP_SERVICE, Cortex grants, COWORK_APP.CORE, DEV_REACT_COWORK,
-- and COWORK_USER granted to you are already done; nothing here repeats them).
--
-- Before running, find-and-replace in the worksheet:
--   <AGENT_DB>.<AGENT_SCHEMA>.<AGENT_NAME>  your agent, e.g. DEV_REACT_COWORK.AGENTS.SALES_AGENT
--   <PUBLIC_KEY>                            output of step 0 below (one line)
--
-- Step 0 (terminal, in the repo root) creates the backend's key pair:
--   openssl genrsa 2048 | openssl pkcs8 -topk8 -inform PEM -out cowork_svc.p8 -nocrypt
--   openssl rsa -in cowork_svc.p8 -pubout -out cowork_svc.pub
--   grep -v "PUBLIC KEY" cowork_svc.pub | tr -d '\n'; echo     ← this is <PUBLIC_KEY>
-- =====================================================================================

USE ROLE ACCOUNTADMIN;

-- -------------------------------------------------------------------------------------
-- A. Let COWORK_USER call your agent.
--    (If the agent lives in DEV_REACT_COWORK, database/schema USAGE is already granted;
--     re-running these two lines is harmless.)
-- -------------------------------------------------------------------------------------
GRANT USAGE ON DATABASE <AGENT_DB> TO ROLE COWORK_USER;
GRANT USAGE ON SCHEMA <AGENT_DB>.<AGENT_SCHEMA> TO ROLE COWORK_USER;
GRANT USAGE ON AGENT <AGENT_DB>.<AGENT_SCHEMA>.<AGENT_NAME> TO ROLE COWORK_USER;

-- -------------------------------------------------------------------------------------
-- B. Let COWORK_USER use what the agent's tools use (agents run tools with the caller's role).
--    Run DESCRIBE, open the "agent_spec" value, and look under "tool_resources" for:
--    semantic_view / semantic_model_file, search_service, execution_environment.warehouse.
-- -------------------------------------------------------------------------------------
DESCRIBE AGENT <AGENT_DB>.<AGENT_SCHEMA>.<AGENT_NAME>;

-- Data in DEV_REACT_COWORK (covers every schema in it: TPCH, ANALYTICS, AGENTS):
GRANT SELECT ON ALL TABLES IN DATABASE DEV_REACT_COWORK TO ROLE COWORK_USER;
GRANT SELECT ON ALL VIEWS IN DATABASE DEV_REACT_COWORK TO ROLE COWORK_USER;
GRANT SELECT ON FUTURE TABLES IN DATABASE DEV_REACT_COWORK TO ROLE COWORK_USER;
GRANT SELECT ON FUTURE VIEWS IN DATABASE DEV_REACT_COWORK TO ROLE COWORK_USER;

-- Uncomment and fill in what DESCRIBE showed:
-- Semantic view:
-- GRANT SELECT ON SEMANTIC VIEW <DB>.<SCHEMA>.<SEMANTIC_VIEW> TO ROLE COWORK_USER;
-- YAML semantic model on a stage (semantic_model_file: @DB.SCHEMA.STAGE/file.yaml):
-- GRANT READ ON STAGE <DB>.<SCHEMA>.<STAGE> TO ROLE COWORK_USER;
-- Cortex Search service:
-- GRANT USAGE ON CORTEX SEARCH SERVICE <DB>.<SCHEMA>.<SERVICE> TO ROLE COWORK_USER;
-- Custom tool procedure (argument types as in SHOW PROCEDURES):
-- GRANT USAGE ON PROCEDURE <DB>.<SCHEMA>.<PROC>(VARCHAR) TO ROLE COWORK_USER;
-- Tool warehouse, if execution_environment names one other than COWORK_WH:
-- GRANT USAGE ON WAREHOUSE <TOOL_WH> TO ROLE COWORK_USER;
-- Data in a database other than DEV_REACT_COWORK:
-- GRANT USAGE ON DATABASE <DATA_DB> TO ROLE COWORK_USER;
-- GRANT USAGE ON ALL SCHEMAS IN DATABASE <DATA_DB> TO ROLE COWORK_USER;
-- GRANT SELECT ON ALL TABLES IN DATABASE <DATA_DB> TO ROLE COWORK_USER;
-- GRANT SELECT ON ALL VIEWS IN DATABASE <DATA_DB> TO ROLE COWORK_USER;

-- Check: COWORK_USER must see the agent. For a full test, ask it a question in
-- Snowsight (AI & ML → Agents) while your role is COWORK_USER.
USE ROLE COWORK_USER;
SHOW AGENTS IN SCHEMA <AGENT_DB>.<AGENT_SCHEMA>;
USE ROLE ACCOUNTADMIN;

-- -------------------------------------------------------------------------------------
-- C. Service user the backend logs in as (stores chats, artifacts, memories in COWORK_APP).
-- -------------------------------------------------------------------------------------
CREATE USER IF NOT EXISTS COWORK_SVC
  TYPE = SERVICE
  DEFAULT_ROLE = COWORK_APP_SERVICE
  DEFAULT_WAREHOUSE = COWORK_WH
  COMMENT = 'CoWork clone API service user';
ALTER USER COWORK_SVC SET RSA_PUBLIC_KEY = '<PUBLIC_KEY>';
GRANT ROLE COWORK_APP_SERVICE TO USER COWORK_SVC;

-- -------------------------------------------------------------------------------------
-- D. OAuth integration for "Sign in with Snowflake".
-- -------------------------------------------------------------------------------------
CREATE OR REPLACE SECURITY INTEGRATION COWORK_OAUTH
  TYPE = OAUTH
  ENABLED = TRUE
  OAUTH_CLIENT = CUSTOM
  OAUTH_CLIENT_TYPE = 'CONFIDENTIAL'
  OAUTH_REDIRECT_URI = 'http://localhost:4000/auth/callback'
  OAUTH_ALLOW_NON_TLS_REDIRECT_URI = TRUE      -- local dev only; remove for SPCS/https
  OAUTH_ISSUE_REFRESH_TOKENS = TRUE
  OAUTH_REFRESH_TOKEN_VALIDITY = 86400
  COMMENT = 'CoWork clone';

-- -------------------------------------------------------------------------------------
-- E. Values for .env. Copy these outputs.
-- -------------------------------------------------------------------------------------
-- → OAUTH_CLIENT_ID, OAUTH_CLIENT_SECRET
SELECT SYSTEM$SHOW_OAUTH_CLIENT_SECRETS('COWORK_OAUTH');
-- → SNOWFLAKE_ACCOUNT, SNOWFLAKE_ACCOUNT_URL
SELECT
  UPPER(CURRENT_ORGANIZATION_NAME() || '-' || CURRENT_ACCOUNT_NAME()) AS SNOWFLAKE_ACCOUNT,
  'https://' || LOWER(REPLACE(CURRENT_ORGANIZATION_NAME() || '-' || CURRENT_ACCOUNT_NAME(), '_', '-'))
    || '.snowflakecomputing.com' AS SNOWFLAKE_ACCOUNT_URL;
