# 5. Operations and troubleshooting

## 5.1 Health checks

```sql
-- container status (expect READY, restartCount 0)
SELECT SYSTEM$GET_SERVICE_STATUS('COWORK_APP.SPCS.COWORK_SERVICE');
-- logs per container: api | web | router
SELECT SYSTEM$GET_SERVICE_LOGS('COWORK_APP.SPCS.COWORK_SERVICE', 0, 'api', 200);
-- endpoint URL
SHOW ENDPOINTS IN SERVICE COWORK_APP.SPCS.COWORK_SERVICE;
```

A healthy API start logs:

```
[SnowflakeStore] App schema ready in COWORK_APP.CORE
[Bootstrap] API on http://localhost:4000 (auth=spcs, store=snowflake, cortex=live, redis=off)
```

The same checks from a terminal, as `COWORK_SVC` (read-only, no Snowsight needed):

```bash
snow sql -x --account LBXPLBY-JJ73300 --user COWORK_SVC --authenticator SNOWFLAKE_JWT \
  --private-key-file ./cowork_svc.p8 --role COWORK_APP_SERVICE --warehouse COWORK_WH \
  -q "SELECT SYSTEM\$GET_SERVICE_STATUS('COWORK_APP.SPCS.COWORK_SERVICE')"
```

## 5.2 Issues we hit, and their fixes

### Ingress `ERROR_FORBIDDEN`

```json
{"detail":"Access denied. Insufficient privileges to use eaptzc-lbxplby-jj73300.","responseType":"ERROR_FORBIDDEN"}
```

This comes from the **SPCS ingress, not the app**. The app's own errors look like `{"statusCode":401,...}`. Endpoint access
needs all three of:

1. the service role, `GRANT SERVICE ROLE COWORK_APP.SPCS.COWORK_SERVICE!APP_USER TO ROLE COWORK_USER`;
2. **USAGE on the database and schema holding the service**: `COWORK_APP` and `COWORK_APP.SPCS`. This one was missing at first;
3. the user's **default role** being `COWORK_USER` (or one that includes it). Set it with `ALTER USER … SET DEFAULT_ROLE = COWORK_USER`.

Check with `SHOW GRANTS TO ROLE COWORK_USER;` and `SHOW GRANTS OF SERVICE ROLE COWORK_APP.SPCS.COWORK_SERVICE!APP_USER;`.

### Local login page stuck on "Connecting to API at localhost:4000"

The API wasn't running. The cause was `"incremental": true` in `apps/api/tsconfig.json` combined with Nest's `deleteOutDir`:
a stale `tsconfig.tsbuildinfo` made `tsc` emit nothing, so `dist/main.js` never existed and `nest start --watch` waited
silently. Fixed by removing `incremental`. If it ever recurs: delete `apps/api/tsconfig.tsbuildinfo` and `apps/api/dist`,
then restart.

### Docker login fails with password

Snowflake enforces MFA for password logins. Either use `build_push.sh` (it logs in with the `COWORK_SVC` key pair via the
Snowflake CLI), or create a programmatic access token in Snowsight (profile → Settings → Authentication) and use it as the
`docker login` password.

### Other symptoms

| Symptom | Fix |
|---|---|
| Agent picker empty | `AGENT_LOCATIONS` wrong, or missing `USAGE ON AGENT` for the role that runs the agent (`COWORK_USER`, inherited by `COWORK_APP_SERVICE`) |
| Agent answers with a permissions error | A tool object isn't granted. Run `DESCRIBE AGENT` and grant what `tool_resources` lists ([§3.2](03-snowflake-setup.md#32-agent-access-02_remaining_setupsql-sections-ab)) |
| API logs `COMPLETE failed` / `EMBED failed` | `LLM_MODEL` isn't available in the region. Pick another model or `ALTER ACCOUNT SET CORTEX_ENABLED_CROSS_REGION = 'ANY_REGION'`. Memory, titles and charts fall back to non-LLM logic meanwhile |
| API logs `SPCS token accepted only in "Snowflake Token" format` | Informational. The client switched header formats and continues |
| OAuth (local) *invalid redirect URI* | Must exactly match `http://localhost:4000/auth/callback` |
| OAuth (local) role not allowed | `COWORK_USER` isn't granted to the user, or you tried a blocked admin role |
| Charts not shown, table only | Expected when the agent lacks `data_to_chart`. The app auto-charts (Settings → Auto-chart results). Add the tool to the agent for native charts |
| Automation emails never arrive | Recipient's email isn't verified in Snowflake (profile → verify), the `COWORK_EMAIL` integration is missing, or `USAGE` on it isn't granted (06_phase2.sql A5). The run history shows "Saved, but the email failed: …" |
| Automation shows **missed** | The app was down more than 6 h past the due time. Check `SHOW TASKS IN SCHEMA COWORK_APP.SPCS` (is `COWORK_IDLE_STOP` started?) and task history |
| Deep research report is just a list of findings | `RESEARCH_MODEL` failed (see API logs for `COMPLETE failed`). Check model availability / cross-region setting |
| Container restarting | `SYSTEM$GET_SERVICE_LOGS(..., 'api', 200)`. Usually an env validation message on the first lines |

## 5.3 Where data goes (data residency)

**In production (SPCS), the app runs and stores everything inside Snowflake:**

| Piece | Location |
|---|---|
| Web, API and router containers | SPCS in account `LBXPLBY-JJ73300` |
| Chats, artifacts, memories, workflows, dashboards, automations | `COWORK_APP.CORE` tables |
| Agents, `AI_CLASSIFY`, embeddings, `claude-sonnet-4-5` (research) | Cortex via the internal `SNOWFLAKE_HOST` endpoint (models hosted by Snowflake) |
| Cache | In memory inside the API container (no Redis) |
| Sign-in | Snowflake ingress |

- The service has **no external access integration**, so its containers cannot reach the internet. Snowflake enforces this.
- In code, the API's only outbound calls are `snowflake.client.ts` (your account) and `auth.service.ts` (OAuth token endpoint of your account, local dev only). The browser loads no external fonts, scripts or analytics. Charts and PowerPoint export are bundled and run client-side. Next.js telemetry is disabled in the image.

**Deliberate exits:**
1. **Automation emails** (`SYSTEM$SEND_EMAIL`) carry report/answer text to recipients' inboxes. Only verified emails of account users are allowed. Leave email off for sensitive automations; results are still saved in the app.
2. **Users' devices:** what the browser displays, and PDF/PowerPoint exports saved locally.
3. **Cross-region Cortex:** stays off unless someone runs `ALTER ACCOUNT SET CORTEX_ENABLED_CROSS_REGION`. Keep it off if data must stay in-region.

**Outside production:** `npm run dev` processes data on the developer's laptop (and offline mode writes `.data/db.json`). Image builds pull code dependencies from npm and Docker Hub; images contain code only.

## 5.4 Security notes

- The OAuth client secret was pasted into a chat during setup. Rotate it before real users: `ALTER SECURITY INTEGRATION COWORK_OAUTH REFRESH OAUTH_CLIENT_SECRET;` and update `.env`.
- `cowork_svc.p8` gives access as `COWORK_APP_SERVICE`. Keep it out of git (it's ignored) and rotate it with `RSA_PUBLIC_KEY_2` if it leaks.
- In SPCS the app uses **owner's rights**: every user sees what `COWORK_APP_SERVICE` sees. Limit who gets `COWORK_USER` accordingly, or enable caller's rights ([§1.6](01-architecture.md#16-auth-modes)).
- In local dev (`REDIS_URL` set), background jobs carry the user's short-lived access token through Redis.
