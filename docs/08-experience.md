# 8. The Flurry experience (v5)

App-level features that work with any agent. None of them need Snowflake changes.

## 8.1 Visual identity
- **Snow palette** (`apps/web/src/app/globals.css`): cooler neutrals, `--canvas` background for dashboards, soft depth (`shadow-soft`, `shadow-lift`), brand gradient (`bg-brand`, `text-brand`).
- **Accents:** six user-selectable accents (Snow, Glacier, Aurora, Violet, Rose, Amber) via `data-accent` on `<html>`. Tints derive automatically (`color-mix`). Applied before first paint from `localStorage`, so there's no colour flash.
- **Inter** via `next/font`: downloaded at build time and served by the app, so the browser never calls Google.
- **Motion:** messages fade up, the canvas slides in, skeletons shimmer. Respects `prefers-reduced-motion`.
- **Logo** (`components/Logo.tsx`): gradient snowflake mark that follows the accent.
- **Responsive:** below `md` the sidebar becomes a drawer with a top bar.

## 8.2 Home workspace (`components/Home.tsx`)
Greeting, a large composer with **Ask / Deep research / Dashboard** mode pills, the agent's starter questions, a **Watchlist** of pinned KPI cards (live values), **Pinned** dashboards and artifacts, "Do more" cards, and **Recent** chats and artifacts. Pin from any dashboard (**Pin**), artifact page, or the pin icon on a dashboard KPI tile. Pins live in user settings.

## 8.3 Command palette (`components/CommandPalette.tsx`)
**⌘K / Ctrl+K** anywhere, or the sidebar search. Fuzzy search over chats, dashboards, reports, artifacts, workflows and skills, plus actions (new chat, deep research, build a dashboard, automations, settings, theme). Fully keyboard driven.

## 8.4 Smarter answers
- **Insight callouts** (`computeInsights`, `packages/shared/src/insights.ts`): deterministic highlights on every result. For time series: latest change, peak, overall change. For categories: leader with share, laggard vs average, top-3 concentration. No model call.
- **Follow-up suggestions:** after an ordinary answer, the API asks the cheap `LLM_MODEL` for 3 next questions (6 s budget). Without a model, shape-based suggestions apply (`shapeFollowUps`). Shown as chips under the latest answer; one click sends.
- **Click-to-ask:** clicking a bar or point in a chat chart puts "Tell me more about …" into the composer.
- **Edit & resend** (your messages) and **Regenerate** (answers).
- **Skeleton loading** shaped like the answer while it starts.
- **Modes:** *Dashboard* forces the dashboard builder (`mode: 'dashboard'`), *Deep research* runs research. Both are one-shot; follow-ups return to *Ask*.

## 8.5 Live canvas (`components/Canvas.tsx`)
A resizable panel beside the chat (32–72% width, drag the left edge; full screen on mobile) showing a result (chart/table/SQL, large), a report, or a full interactive dashboard (`DashboardView embedded`). Opens from **Open in canvas** on any result card or by clicking a report/dashboard card (Cmd/Ctrl-click opens the full page). Dashboards and reports built in a turn **open automatically** on wide screens. Esc closes.

## 8.6 Personalisation (Settings)
- **Response style:** concise / balanced / detailed, passed to every agent in `<user_context>`.
- **Numbers:** international (2.6B) or Indian (26 Cr, 45 L, 12,34,567) for chart axes, tables, KPIs and agent wording.
- **Currency:** $ ₹ € £ for KPI cards and agent wording.
- **Theme and accent**, and **Show welcome tour again**.
- First-run **welcome tour** (`components/Welcome.tsx`).
- Saving one setting never clears others (the API keeps only fields that were sent, validated).
