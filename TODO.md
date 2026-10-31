# To do

Open work, most important first. Move items to the roadmap in [docs/README.md](docs/README.md) when done.

## Route Planner (after v6)

### 1. Lock the planner to the signed-in rep (security)
Today any signed-in user can open and change any rep's plan. The rep picker is open to
everyone, the API doesn't check `repId`, and the `FR_*` procedures run with owner's rights.
- Reps see only their own day: rep resolved from login (`FR_REPS.SNOWFLAKE_USER`), no picker.
- **Enforce in the API** (`apps/api/src/planner/planner.service.ts`): `plan`, `adjust`, `chat`
  and `territory` reject any other `repId`. Hiding the picker isn't enough.
- Managers get the picker, limited to their team. Decide how a manager is identified: a
  role (e.g. `FIELD_MANAGER`) or a manager column on `FR_REPS`.
- Users not in `FR_REPS` get "You're not set up as a field rep" instead of silently seeing R001.
- Keep passing `rep_id` explicitly. In SPCS the procedures see the service user as
  `CURRENT_USER()`, so they can't resolve the rep themselves.

### 2. Let the planner chat use other agents
The chat only calls `FIELD_REP_DAY_PLANNER` (`PLANNER_AGENT`). Prep briefs already work
through its `prep_brief` tool.
- **First:** check that the other agents (`HCP_RESONANCE_ADVISOR`, `NBA_FIELD_REP_ASSISTANT`)
  know the same doctors. Their data is in `DEV_REACT_COWORK.NBA_FIELD`; HCP IDs and names
  must match `FR_HCPS`, or combined answers won't line up.
- **Preferred:** route in the app. Plan changes always go to the planner agent; other
  questions go to the best-matching agent (reuse `AgentRouter` from Auto mode). "Prep me
  for Dr X" can combine the planner's brief with the other agent's advice in one answer.
- **Alternative:** a "Prep" workflow (planner + resonance advisor in parallel → merge),
  called by the planner chat for prep requests.
- Decide which agents are allowed.

### 3. Smaller planner items
- Point the agent's tool `execution_environment` at `COWORK_WH` and drop the `COMPUTE_WH`
  grant in `10_release_v6.sql` PART A (one warehouse to watch and pay for).
- Undo for single map edits. Today the only way back is **Reset**, which clears every
  change for the day; this needs a "remove override" action in `FR_ADJUST_PLAN`.

## Carried over

- **Rotate the OAuth client secret.** It was pasted into a chat session earlier.
- **Back up `.env` and `cowork_svc.p8` outside iCloud**, e.g. in a password manager. They're
  deliberately not in git.
- **Move the repo off the iCloud-synced Desktop**, or free up iCloud space. Evicted
  ("dataless") files caused build and commit timeouts.
- **Auto start/stop (IST)**: `06_phase2.sql` PART B. Postponed, so the service runs (or stays
  suspended) until someone changes it by hand.
- **Roadmap "Next"**: file upload as context (`AI_PARSE_DOCUMENT`), caller's rights in SPCS,
  `response.map` rendering, MCP connectors, Redis container, Snowflake Decision for workflow
  conditions (private preview; `AI_CLASSIFY` meanwhile).
