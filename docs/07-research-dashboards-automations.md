# 7. Deep research, dashboards, automations and export

## 7.0 How chat routes a message

Before any agent is called, the API checks, in order:

1. **Dashboard** build ("build a dashboard for …") or edit (in a thread that built one).
2. **Automation proposal** ("send me this every Monday …").
3. **Assistant layer** (`apps/api/src/chat/assistant.service.ts`): messages about the app or the user are answered with Cortex `COMPLETE` (`RESEARCH_MODEL`), with **no agent call**:
   - memory: "add this as a preference", "remember …", "forget …", "what do you remember about me?" ("this" resolves from the previous turn; respects Settings → Memory);
   - app help: "what can you do?", "how do I schedule a report?", "which agents do I have?" (answered from a built-in feature description plus the user's agent list);
   - small talk: "hi", "thanks".
   A keyword pre-check means ordinary data questions never pay for this extra call. If the model decides a message needs data, it still goes to the agent. Offline, rule-based fallbacks apply.
4. **Deep research**, a **workflow**, or the **agent** (Auto picks one).

## 7.1 Deep research

Turn it on with **+ → Deep research** in the message box. The selected agent decides the scope:

| Agent picker | Research uses |
|---|---|
| **Auto** (default when several agents exist) | The planner assigns each sub-question to the best agent, judged from agent descriptions and sample questions |
| A specific agent | Only that agent, for every sub-question |
| A workflow | Treated as Auto |

```mermaid
flowchart LR
    Q["Question"] --> P["Plan<br/>claude-sonnet-4-5<br/>3–6 sub-questions → agents"]
    P --> R1["[1] agent run"]
    P --> R2["[2] agent run"]
    P --> R3["[3] agent run"]
    R1 --> W["Write<br/>claude-sonnet-4-5<br/>cited Markdown report"]
    R2 --> W
    R3 --> W
    W --> A["Report artifact<br/>text + findings (SQL, table, chart)"]
```

- `ResearchService` (`apps/api/src/research/research.service.ts`): `SNOWFLAKE.CORTEX.COMPLETE(RESEARCH_MODEL, …)` plans, sub-questions run **3 at a time** against the agents (with auto-charting), and the writer cites findings as `[n]`.
- Progress streams as research steps, so chat shows a **Deep research** trace with one row per sub-question (expand to see the agent's answer, SQL, table and chart), followed by the report and a card linking to the saved **Report** artifact.
- If the model is unavailable, the plan falls back to simple variations and the report to an assembled list of findings, so research still completes.
- Give each agent a one-line `COMMENT` describing what it covers. The planner relies on it (`TEST_AGENT` currently has none).

**Report artifacts** show the written report with clickable citations, then **Sources**: each finding's question, agent, chart or table, answer and SQL. **Refresh** re-runs every finding's SQL under the viewer's role and keeps the text.

## 7.2 Auto agent selection in normal chat

With **Auto** selected and Deep research off, each question goes to one agent chosen by `AI_CLASSIFY` over the agents'
names and descriptions (`AgentRouter`). The status line shows "Asking <agent>". Auto threads don't use Cortex threads
because the agent can change between turns; prior turns are sent as history instead.

## 7.3 Dashboards

- **Artifacts → Dashboards → New dashboard**, or **Add to dashboard** on any chart or table artifact.
- A 12-column grid (`react-grid-layout`). **Edit** to drag (handle), resize (corner) and remove tiles. **Done** saves the layout.
- Opening a dashboard loads live data through the artifact cache (`ARTIFACT_CACHE_TTL`). **Refresh all** forces fresh queries.
- **Share** works like artifacts (usernames or everyone). Viewers only see tiles whose artifacts they can open.
- Stored in `COWORK_APP.CORE.DASHBOARDS` (`items: [{artifactId, x, y, w, h}]`).

## 7.3b Dashboards built from chat (Power BI style)

Ask in chat, e.g. *"Build a dashboard for field-rep performance by region"*, or use **Artifacts → Dashboards → Build with Flurry**.

```mermaid
flowchart LR
    R["Request in chat"] --> D["Design<br/>claude-sonnet-4-5<br/>KPIs · charts · filters · layout"]
    D --> T1["KPI tile → agent<br/>monthly series + filter columns"]
    D --> T2["Chart tile → agent<br/>grouped rows + filter columns"]
    D --> T3["…"]
    T1 --> S["Artifacts (type kpi / chart / table)<br/>table + SQL + resolved roles"]
    T2 --> S
    T3 --> S
    S --> B["Dashboard<br/>filter bar · KPI row · charts"]
```

- **Design** (`DashboardBuilderService`): 3–5 KPI cards, 3–6 charts (line, area, bar, hbar, stacked, donut, scatter), at most one detail table, 1–3 filters (date and dimensions) and a layout (KPI row, then charts two per row). The selected agent scopes it: Auto may use several agents, a pinned agent is used for every tile.
- **Data stays filterable:** each tile's agent question asks for the filter columns too (e.g. `MONTH`, `REGION`), and KPI questions ask for a 12-month series. Results are saved as artifacts with a `tile` config mapping columns to roles (`x`, `y`, `color`, time) and to filters (`resolveTile` in `packages/shared/src/dashboards.ts`).
- **In the browser:**
  - **Filter bar:** date presets (relative to the latest date in the data), dimension dropdowns, **Clear all**.
  - **Cross-filtering:** click a bar or slice. Other tiles filter, and the clicked chart keeps all categories with the selection highlighted (Power BI behaviour). Click again or use the chip × to clear.
  - **KPI cards:** value, change vs the previous period (or the equally long window before a date range) with ▲/▼ and text, plus a sparkline. Sums add up within a month and use the tile's aggregate (sum/mean) across months; percentages average.
  - **Drill-down:** the table icon on a tile shows the filtered rows and SQL.
  - Charts are rebuilt from the filtered rows (`buildTileSpec`), so totals always re-aggregate correctly. Time axes group by month.
- **Editing in chat:** in the conversation that built it (or **Edit in chat** on the dashboard): *"add a chart of inquiries by product"*, *"make the trend a bar chart"*, *"remove the payer mix tile"*, *"rename the dashboard to …"*. Presentation changes are instant; new tiles query their agent.
- **Refresh, share, PDF and PowerPoint** work as for other dashboards. PowerPoint uses the current filters: a **Key metrics** slide, then one slide per chart or table.
- **Limits:** tiles can only show what the agents can answer (unbuildable tiles are listed in the chat reply). In-browser filtering suits aggregated results (hundreds to tens of thousands of rows per tile).

## 7.4 Automations

**Automations** page → **New automation**: name, what runs (**Deep research**, **Agent** with Auto allowed, or a published
**Workflow**), the message, a schedule in **IST** (every day / weekdays / weekly / custom cron, at most every 15 min) and
optional email recipients.

### Creating automations from chat

- **Automate this:** the calendar icon under any answer (and **Automate** on report and answer artifacts) opens the automation form pre-filled with that question, agent (or Auto) and mode (deep research if the answer was a report).
- **Ask in chat:** e.g. *"send me this every Monday at 8am to me@company.com"*. Messages that look like scheduling (recurrence and action words) are checked by `AutomationIntentService` with `RESEARCH_MODEL`. "This/that" resolves to the previous question, and kind follows the previous answer (report → deep research). Chat replies with a **confirmation card** (name, what runs, schedule in IST, recipients) with **Create automation** or **Edit first**. Nothing is scheduled until you confirm. Ordinary questions ("revenue every month in 1997") are not treated as schedules. Offline, a rule-based parser (`parseScheduleText`) does the extraction.

### How a run happens

```mermaid
sequenceDiagram
    participant T as Snowflake task COWORK_IDLE_STOP (every 15 min)
    participant S as SPCS service
    participant A as API scheduler (every 60 s)
    participant DB as COWORK_APP.CORE
    participant M as SYSTEM$SEND_EMAIL

    T->>DB: AUTOMATIONS due within 20 min?
    alt service stopped and one is due
        T->>S: START_COWORK() (ready in ~3–5 min)
    end
    A->>DB: enabled AUTOMATIONS with nextRunAt ≤ now
    A->>DB: advance nextRunAt, insert AUTOMATION_RUNS (running)
    A->>A: run target headlessly (research / agent / workflow)
    A->>DB: save artifact (report or answer)
    opt email enabled
        A->>M: HTML summary + "Open in CoWork" link
    end
    A->>DB: run → success / error
    T->>DB: run in progress or due within 30 min? keep running
```

- **Late starts:** due runs execute even if the app came up a few minutes late. Over 6 hours late, they're recorded as **missed** and rescheduled, so there's no backlog flood.
- **Restarts:** runs left `running` by a restarted process are closed as errors on start-up.
- **Credentials:** runs use the app's service identity (owner's rights): the SPCS token in production, `COWORK_SVC` locally.
- **Run now** executes immediately (the button waits for the result). **History** lists runs with status, duration, email flag and a link to the result.
- **Tables:** `AUTOMATIONS`, `AUTOMATION_RUNS` (`PARENT_ID` = automation id).

### Email

`CALL SYSTEM$SEND_EMAIL('COWORK_EMAIL', recipients, subject, html, 'text/html')` with the notification integration from
`06_phase2.sql` A5. **Snowflake only delivers to verified email addresses of users in this account.** Each recipient
verifies theirs in Snowsight (profile → email → verify). The email has the report text (Markdown rendered to HTML) and
an **Open in CoWork** button (`APP_PUBLIC_URL`). Charts stay in the app.

## 7.5 Export

| Where | PDF | PowerPoint |
|---|---|---|
| Report | ✅ | Title, one slide per report section, one chart (or table) slide per finding |
| Chart / table / answer artifact | ✅ | Title + chart or table (+ summary) |
| Dashboard | ✅ | Title + one slide per tile, in grid order |

- **PDF** uses the browser's print dialog (*Save as PDF*). Print CSS hides navigation and lets content flow across pages; charts stay vector.
- **PowerPoint** is generated in the browser with `pptxgenjs` (16:9). Charts are rendered off-screen to PNG with the app's chart theme.

## 7.6 Configuration

| Variable | Default | Purpose |
|---|---|---|
| `RESEARCH_MODEL` | `claude-sonnet-4-5` | Planning and writing for deep research |
| `EMAIL_INTEGRATION` | `COWORK_EMAIL` | Notification integration for `SYSTEM$SEND_EMAIL` |
| `APP_PUBLIC_URL` | `WEB_ORIGIN` | Links in emails (SPCS: the ingress URL) |

Models available on this account (checked 2026-10-24): `claude-sonnet-4-5`, `llama3.3-70b`, `llama3.1-70b`. Snowflake
Decision models aren't enabled yet; conditions and Auto routing use `AI_CLASSIFY`.
