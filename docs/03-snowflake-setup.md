# 3. Snowflake setup

Everything here runs in a Snowsight SQL worksheet as `ACCOUNTADMIN`, unless noted. The scripts are idempotent, so re-running
them is safe.

| Order | Script | Creates |
|---|---|---|
| 1 | `snowflake/01_setup.sql` | Warehouse, roles, Cortex grants, app database, `DEV_REACT_COWORK` schemas, `COWORK_USER` granted to you |
| 2 | `snowflake/02_remaining_setup.sql` | Agent access for `COWORK_USER`, service user `COWORK_SVC`, OAuth integration, `.env` values |
| – | `snowflake/04_demo_agent.sql` | **Optional.** A demo TPC-H text-to-SQL agent, for accounts without one |
| 3 | `snowflake/05_spcs.sql` | Compute pool, image repo, service, endpoint access. See [SPCS deployment](04-spcs-deployment.md) |

## 3.1 Base objects (`01_setup.sql`)

- `COWORK_WH`: XSMALL, auto-suspend 60s, auto-resume
- Roles `COWORK_USER` and `COWORK_APP_SERVICE`, both granted to `SYSADMIN`
- `SNOWFLAKE.CORTEX_USER` and `USAGE` on `COWORK_WH` for both roles
- `COWORK_APP.CORE`, with `ALL` + future tables for `COWORK_APP_SERVICE`
- `COWORK_USER` granted to the current user. OAuth blocks `ACCOUNTADMIN`/`SECURITYADMIN`, and the SPCS endpoint checks `COWORK_USER`

## 3.2 Agent access (`02_remaining_setup.sql`, sections A–B)

Cortex Agents run their tools **with the caller's role**, so the role calling the agent needs the agent *and* everything its
tools touch. Find what the tools use:

```sql
DESCRIBE AGENT DEV_REACT_COWORK.AGENTS.NBA_FIELD_REP_ASSISTANT;
-- agent_spec → tool_resources: semantic_view, search_service, execution_environment.warehouse, procedures
```

For this account, `COWORK_USER` holds:

```sql
GRANT USAGE ON DATABASE DEV_REACT_COWORK TO ROLE COWORK_USER;
GRANT USAGE ON SCHEMA DEV_REACT_COWORK.AGENTS TO ROLE COWORK_USER;
GRANT USAGE ON SCHEMA DEV_REACT_COWORK.NBA_FIELD TO ROLE COWORK_USER;
GRANT USAGE ON AGENT DEV_REACT_COWORK.AGENTS.NBA_FIELD_REP_ASSISTANT TO ROLE COWORK_USER;
GRANT SELECT ON SEMANTIC VIEW DEV_REACT_COWORK.NBA_FIELD.NBA_FIELD_SV TO ROLE COWORK_USER;
GRANT USAGE ON CORTEX SEARCH SERVICE DEV_REACT_COWORK.NBA_FIELD.CS_APPROVED_CONTENT TO ROLE COWORK_USER;
GRANT USAGE ON CORTEX SEARCH SERVICE DEV_REACT_COWORK.NBA_FIELD.CS_INTERACTION_NOTES TO ROLE COWORK_USER;
GRANT USAGE ON CORTEX SEARCH SERVICE DEV_REACT_COWORK.NBA_FIELD.CS_MLR_GUIDELINES TO ROLE COWORK_USER;
GRANT USAGE ON PROCEDURE DEV_REACT_COWORK.NBA_FIELD.MLR_AI_REVIEW(VARCHAR, VARCHAR) TO ROLE COWORK_USER;
GRANT USAGE ON PROCEDURE DEV_REACT_COWORK.NBA_FIELD.MLR_RULE_CHECK(VARCHAR, VARCHAR, VARCHAR) TO ROLE COWORK_USER;
GRANT SELECT ON ALL TABLES IN DATABASE DEV_REACT_COWORK TO ROLE COWORK_USER;
GRANT USAGE ON WAREHOUSE COMPUTE_WH TO ROLE COWORK_USER;   -- tool warehouse
```

To test: `USE ROLE COWORK_USER;`, then ask the agent a question in Snowsight (AI & ML → Agents). If it answers there, it
answers in the app.

## 3.3 Service user (section C)

The API uses `COWORK_SVC` when it runs **outside** SPCS (local, `APP_STORE=snowflake`). `build_push.sh` also uses it to log
in to the image registry. Authentication is key-pair:

```bash
# repo root
openssl genrsa 2048 | openssl pkcs8 -topk8 -inform PEM -out cowork_svc.p8 -nocrypt
openssl rsa -in cowork_svc.p8 -pubout -out cowork_svc.pub
grep -v "PUBLIC KEY" cowork_svc.pub | tr -d '\n'; echo      # → RSA_PUBLIC_KEY
```

```sql
CREATE USER IF NOT EXISTS COWORK_SVC TYPE = SERVICE DEFAULT_ROLE = COWORK_APP_SERVICE DEFAULT_WAREHOUSE = COWORK_WH;
ALTER USER COWORK_SVC SET RSA_PUBLIC_KEY = '<public key body>';
GRANT ROLE COWORK_APP_SERVICE TO USER COWORK_SVC;
```

Inside SPCS, the service uses its own mounted token instead, and `COWORK_SVC` isn't involved.

## 3.4 OAuth integration (section D), local development only

```sql
CREATE OR REPLACE SECURITY INTEGRATION COWORK_OAUTH
  TYPE = OAUTH ENABLED = TRUE OAUTH_CLIENT = CUSTOM OAUTH_CLIENT_TYPE = 'CONFIDENTIAL'
  OAUTH_REDIRECT_URI = 'http://localhost:4000/auth/callback'
  OAUTH_ALLOW_NON_TLS_REDIRECT_URI = TRUE
  OAUTH_ISSUE_REFRESH_TOKENS = TRUE OAUTH_REFRESH_TOKEN_VALIDITY = 86400;

SELECT SYSTEM$SHOW_OAUTH_CLIENT_SECRETS('COWORK_OAUTH');    -- → OAUTH_CLIENT_ID / OAUTH_CLIENT_SECRET
```

The API requests scope `refresh_token session:role:COWORK_USER`, exchanges the code at `/oauth/token-request`, and refreshes
tokens automatically. Rotate the secret with `ALTER SECURITY INTEGRATION COWORK_OAUTH REFRESH OAUTH_CLIENT_SECRET;`.

## 3.5 `.env` for live local development

```ini
AUTH_MODE=oauth
CORTEX_MOCK=false
APP_STORE=snowflake
SNOWFLAKE_ACCOUNT_URL=https://lbxplby-jj73300.snowflakecomputing.com
SNOWFLAKE_ACCOUNT=LBXPLBY-JJ73300
OAUTH_CLIENT_ID=<from 3.4>
OAUTH_CLIENT_SECRET=<from 3.4>
SNOWFLAKE_SERVICE_USER=COWORK_SVC
SNOWFLAKE_SERVICE_PRIVATE_KEY_PATH=./cowork_svc.p8
AGENT_LOCATIONS=DEV_REACT_COWORK.AGENTS
SESSION_SECRET=<openssl rand -hex 32>
```

On start, the API logs `App schema ready in COWORK_APP.CORE`, which creates the tables if they're missing.

## 3.6 Adding a user

```sql
USE ROLE ACCOUNTADMIN;
CREATE USER ARPAN
  LOGIN_NAME = 'arpan' DISPLAY_NAME = 'arpan' EMAIL = '…'
  PASSWORD = '<unique temporary password>' MUST_CHANGE_PASSWORD = TRUE
  DEFAULT_ROLE = COWORK_USER DEFAULT_WAREHOUSE = COWORK_WH DEFAULT_SECONDARY_ROLES = ();
GRANT ROLE COWORK_USER TO USER ARPAN;
-- If MUST_CHANGE_PASSWORD shows false afterwards (re-setting a password resets it):
ALTER USER ARPAN SET MUST_CHANGE_PASSWORD = TRUE;
```

Send the user the app URL, their login name and the temporary password. They'll change the password and enroll in MFA on
first login. A `COWORK_USER`-only user can still log in to Snowsight, but only sees what that role was granted: the agent, its
data, and `COWORK_WH`. They can't see `COWORK_APP.CORE` or admin settings. Disable with `ALTER USER … SET DISABLED = TRUE`.
