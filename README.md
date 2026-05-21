<p align="center">
  <img src="docs/assets/readme_cover.png" alt="Second — humans and agents, side by side" width="100%">
</p>

<div align="center">

<br>

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="apps/web/public/favicon-dark.svg">
  <source media="(prefers-color-scheme: light)" srcset="apps/web/public/favicon-light.svg">
  <img alt="Second" src="apps/web/public/favicon-light.svg" width="56" height="52">
</picture>

<h1>Second</h1>

**Humans and agents, side by side.**

Second is a factory for custom internal software,<br>purpose-built for human2agent work.

<!-- Let your team ship custom internal apps from a prompt, where agents work natively alongside your humans. -->

<a href="https://github.com/Second-Inc/second/actions"><img src="https://img.shields.io/github/actions/workflow/status/Second-Inc/second/ci.yml?label=CI" alt="CI"></a>&nbsp;&nbsp;
<a href="#quick-start"><img src="https://img.shields.io/badge/Try_it-npx_@second--inc/cli-black.svg" alt="Try it"></a>

<a href="#quick-start"><strong>Quick Start</strong></a> · <a href="https://docs.second.so"><strong>Docs</strong></a> · <a href="#security--governance"><strong>Security & Governance</strong></a> · <a href="#self-hosting"><strong>Self-Hosting</strong></a>

</div>

## Quick Start
Run Second locally:
```bash
npx --yes @second-inc/cli
```

| Platform | Status |
|:---|:---|
| Apple Silicon Mac (M1-M5) | **Available now** |
| Intel Mac, Linux, Windows | Coming soon |

Bring your agent:

<table>
  <tr>
    <td width="70" align="center">
      <img src="apps/web/public/icons/claude-code.svg" width="28" height="28" alt="Claude Code">
    </td>
    <td width="70" align="center">
      <img src="apps/web/public/icons/codex.svg" width="28" height="28" alt="Codex">
    </td>
    <td width="70" align="center">
      <img src="apps/web/public/icons/opencode.svg" width="28" height="28" alt="OpenCode">
    </td>
  </tr>
  <tr>
    <td align="center">✅</td>
    <td align="center">✅</td>
    <td align="center"><sub>Soon</sub></td>
  </tr>
</table>

<br>

## What is Second?

Second is a local / on-prem Lovable for building internal software (e.g. competitor research, lead enrichment) **that treats agents as first-class citizens:** AI agents work inside the apps you build, right alongside your team. They read and write to the same real-time DB as your team does, get scoped tools to handle real workloads inside the apps you've built, and perform actual work instead of just answering questions.

<!-- Teams love Second because it makes multiplayer AI simple, loved and finally- easy. -->

### Second VS other platforms

Most platforms weren't built for deep, multiplayer, async work with AI agents. They either treat agents as an afterthought bolted onto existing tools, or they're too opinionated and end up not fitting how your team actually works.\
**Generally, multiplayer human-agent work is where coordination gets hard and things start to break, fast.**

Second solves that: Think Paperclip or Multica, but instead of pre-built software you get to build your own custom interfaces to work with agents, tailored to what your team needs right now!

### How it Works

Second is a single workspace.

1. **You describe your app.** In a single prompt.
2. **Second generates it.** The agents, scoped tools, and a beautiful UI, backed by a real-time DB.
3. **Your team now works alongside agents-** in the same shared interface.

`<<INSERT VIDEO/GIF OF APP GENERATION FLOW HERE>>`

---

## The Internal Platform Everyone Needs (and Builds)

Companies like **Ramp** and **Deel** have already figured out that teams are building amazing things internally with Claude, Codex, or Lovable- but most never reach production (security, governance, integrations, maintenance, agent access control...). To solve this, they built internal platforms for themselves.

**Second lets every organization have that.**

Every app you build in Second gets a real-time DB, audit logs, RBAC, agent RBAC, and governance tools built into the workspace.

<table>
  <tr>
    <td width="50%" valign="top">
      <h3 align="center">👥 For Teams</h3>
      <ul>
        <li>Build custom apps from a single prompt</li>
        <li>Run multiple agents in parallel across workflows</li>
        <li>Real-time collaborative UI with agents and humans on the same page</li>
        <li>Never blocked: integrations return mock data until connected</li>
      </ul>
    </td>
    <td width="50%" valign="top">
      <h3 align="center">🛠️ For Platform Engineers</h3>
      <ul>
        <li>Fine-grained access control per app, per agent, per integration</li>
        <li>One-time workspace setup, unlimited apps</li>
        <li>Full governance: draft/review/publish lifecycle</li>
        <li>Deploy on your own k8s, air-gapped or on-prem</li>
      </ul>
    </td>
  </tr>
</table>

---

## Features

| Feature | &nbsp; |
|:---|:---|
| **🔧 Self-Building** | Integrations are generated on demand with exact connection instructions |
| **🤖 App Agents** | Each app gets its own agents, with tools and data access presented for approval |
| **🔌 BYO Agent** | Use Claude Code, Codex, OpenCode, or your own harness. Switch runtimes per app or message |
| **⚡ Realtime** | Live data, change streams, and optimistic updates keep teams and agents synced |
| **👥 Multiplayer Sessions** | Talk with your agents, invite teammates into the session, and collaborate with shared context |
| **🔒 Agent Permissions** | Agents run with approved tools, data, and integrations. Everything is scoped and audited |
| **🛡️ Governance** | Draft, review, approve, and publish apps with agents and integrations under control |
| **📋 Audit Logs** | Every agent action, tool call, data write, and access denial recorded and searchable |
| **🏠 Self-Hosted / On-Prem** | Deploy on your own infrastructure. Your k8s cluster, your VPC, your rules |
| **🧠 Workspace Agents** | Create reusable agents with prompts, skills, models, and team visibility |
| **📚 Workspace Skills** | Define instructions once, then attach them to agents across the workspace |
| **⏲️ Scheduled Agent Jobs** | Agents run on a schedule for periodic research, monitoring, and background tasks |
| **🚀 One-Command Setup** | From zero to running with `npx @second-inc/cli` |

## What You Can Build

<table>
<tr>
<td width="50%" valign="top">

<h3>🔍 Competitor Research Dashboard</h3>

<sub>**Flow:** 🤖 Monitor → 👤 Review and flag → 🤖 Compile report → 👤 Share</sub><br>
<sub>**Tools:** Web Search, Google Alerts, Drive</sub><br>
<sub>**Agents:** Research Agent, Alert Agent, Report Agent</sub>

```
┌─────────────────────────────────┐
│ LIVE FEED             3 new ▼   │
├─────────────────────────────────┤
│                                 │
│ 🤖 Acme raised prices 12%     │
│    Source: pricing page crawl   │
│    → 👤 [Flag]  [Archive]     │
│                                 │
│ 🤖 RivalCo blog: "Q3 Roadmap" │
│    Source: RSS monitor          │
│    → 👤 [Read]  [Dismiss]     │
│                                 │
│ 👤 You flagged: Acme Series B  │
│ 🤖 → Added to weekly report   │
│                                 │
├─────────────────────────────────┤
│ 💬 Report Agent:               │
│ "Weekly digest ready. 3 price   │
│  alerts, 2 product launches,    │
│  1 funding round flagged."      │
│                                 │
│ 👤 [Download PDF] [Share]      │
└─────────────────────────────────┘
```

</td>
<td width="50%" valign="top">

<h3>📹 Content Curation Pipeline</h3>

<sub>**Flow:** 🤖 Fetch videos → 👤 Select clips → 🤖 Cut and upload → 👤 Approve</sub><br>
<sub>**Tools:** YouTube API, Clipping Service, Google Drive</sub><br>
<sub>**Agents:** Curator Agent, Clip Agent</sub>

```
┌─────────────────────────────────┐
│ VIDEOS THIS WEEK       12 ▼    │
├────────┬────────┬───────────────┤
│ Title  │ Source │ Status        │
├────────┼────────┼───────────────┤
│ "AI    │ YT     │ ✅ Clipped   │
│ Agents │        │    → Drive    │
│ 2025"  │        │               │
├────────┼────────┼───────────────┤
│ "Build │ YT     │ 👤 Review    │
│ Your   │        │   [Select]    │
│ Agent" │        │   [Skip]      │
├────────┼────────┼───────────────┤
│ "Agent │ YT     │ 🤖 Fetched   │
│ Ops at │        │    Pending    │
│ Scale" │        │               │
├────────┴────────┴───────────────┤
│ 💬 Clip Agent:                 │
│ "Clipped first 2 min. Uploaded  │
│  to /Content/May-2025."         │
│                                 │
│ 👤 [Approve] [Re-clip] [Next] │
└─────────────────────────────────┘
```

</td>
</tr>
</table>

<table>
<tr>
<td width="50%" valign="top">

<h3>🎯 Lead Enrichment Pipeline</h3>

<sub>**Flow:** 🤖 Scrape leads → 🤖 Enrich from LinkedIn + web → 🤖 Score and rank → 👤 Team reviews top leads</sub><br>
<sub>**Tools:** HubSpot, LinkedIn, Web Search</sub><br>
<sub>**Agents:** Scraper Agent, Enrichment Agent, Scoring Agent</sub>

```
┌─────────────────────────────────┐
│ PIPELINE            47 leads ▼  │
├────────┬───────┬────────────────┤
│ Lead   │ Score │ Status         │
├────────┼───────┼────────────────┤
│ Acme   │ 92/100│ ✅ Ready      │
│ Corp   │       │ 👤 [Call]     │
├────────┼───────┼────────────────┤
│ Nova   │ 78/100│ 🤖 Enriching  │
│ Labs   │       │ 🤖 Score next │
├────────┼───────┼────────────────┤
│ Peak   │  --   │ 🤖 Scraping.. │
│ Inc    │       │    3 sources   │
├────────┴───────┴────────────────┤
│ 💬 Scoring Agent:              │
│ "Acme Corp: 200 employees,      │
│  Series A, hiring 3 engineers.  │
│  Score: 92. Ready for review."  │
│                                 │
│ 👤 [Accept] [Edit] [Skip]     │
└─────────────────────────────────┘
```

</td>
<td width="50%" valign="top">

<h3>📊 GTM War Room</h3>

<sub>**Flow:** 🤖 Agent pulls weekly metrics → 👤 PMM reviews positioning → 👤 Sales adds field notes → 🤖 Agent generates battlecard</sub><br>
<sub>**Tools:** HubSpot, Slack, Google Docs, Analytics</sub><br>
<sub>**Agents:** Metrics Agent, Battlecard Agent</sub>

```
┌─────────────────────────────────┐
│ GTM WAR ROOM       Week 21 ▼   │
├─────────────────────────────────┤
│                                 │
│ 📈 THIS WEEK                   │
│ Pipeline: $320k (+14%)          │
│ Win rate: 38% (up from 31%)     │
│ Lost to competitor: 3 deals     │
│                                 │
│ 👤 PMM added positioning note: │
│ "Emphasize self-hosted angle    │
│  vs. Acme's cloud-only offer"   │
│                                 │
│ 👤 Sales added field note:     │
│ "Acme offering 40% discounts    │
│  to win back churned accounts"  │
│                                 │
├─────────────────────────────────┤
│ 💬 Battlecard Agent:           │
│ "Updated battlecard with new    │
│  field intel. 2 new objection   │
│  handlers added."               │
│                                 │
│ 👤 [Review card] [Push to Docs]│
└─────────────────────────────────┘
```

</td>
</tr>
</table>

And many more:

| Use Case | What It Does | Tools | Agents |
|:---|:---|:---|:---|
| **Social Media Ops** | Draft posts, schedule across platforms, track engagement, repurpose top performers | Twitter/X, LinkedIn, Buffer | Content Agent, Scheduling Agent, Analytics Agent |
| **Recruiting Pipeline** | Source candidates, screen resumes, schedule interviews, track pipeline | LinkedIn, ATS, Google Calendar, Gmail | Sourcing Agent, Screening Agent, Scheduling Agent |
| **Customer Success** | Pull data from CRMs and support tools, surface churn risk, draft outreach | HubSpot, Intercom, Slack | Insights Agent, Churn Agent, Outreach Agent |
| **Invoice & Expense Tracking** | Collect invoices from email, extract data, match to POs, flag discrepancies | Gmail, Google Drive, Accounting API | Extraction Agent, Matching Agent, Approval Agent |
| **Compliance Monitoring** | Scan for policy violations, flag issues, route to approvers | Internal APIs, Slack, Jira | Compliance Agent, Triage Agent, Routing Agent |
| **Internal Knowledge Base** | Continuously index docs, summarize updates, answer team questions | Notion, Confluence, Slack | Indexing Agent, Summary Agent, Q&A Agent |
| **Founder's Daily Brief** | Aggregate metrics, news, emails, and calendar into one morning summary | Gmail, Google Calendar, Analytics, Web Search | Metrics Agent, News Agent, Brief Agent |
| **PR & Media Monitoring** | Track brand mentions, analyze sentiment, draft responses, alert on crises | Web Search, Twitter/X, Slack, Google Docs | Monitor Agent, Sentiment Agent, Response Agent |
| **Product Feedback Loop** | Collect feedback from support tickets, reviews, and calls, cluster themes, surface to PM | Intercom, G2, Gong, Slack | Collection Agent, Clustering Agent, Summary Agent |
| **Vendor & Contract Management** | Track renewal dates, compare pricing, flag expiring contracts, draft RFPs | Gmail, Google Drive, Slack | Tracker Agent, Comparison Agent, Draft Agent |
| **SEO Content Pipeline** | Research keywords, generate briefs, draft articles, track rankings | Ahrefs, Web Search, Google Docs, Analytics | Research Agent, Brief Agent, Writer Agent |
| **Security Alert Triage** | Ingest alerts from multiple tools, deduplicate, prioritize, assign to on-call | PagerDuty, Slack, Jira, SIEM API | Ingestion Agent, Triage Agent, Assignment Agent |
| **Meeting Follow-ups** | Record action items from meetings, assign owners, send follow-up emails, track completion | Google Calendar, Gong, Gmail, Slack | Notes Agent, Follow-up Agent, Tracker Agent |

Your team sees everything in one collaborative interface. Agents write to the same database your team reads from. No export, no copy-paste, no context switching.

---

## Why Second is Special

**Second generates dynamic, agent-native software.** For each app:

- **Scoped tools created per app, for every agent.** Agents can never do things you don't want them to do.
- **Second is true self-building software.** It generates the integrations, connection instructions, and scoped tools.
- **Agents never see secrets.** Secrets are injected server-side.
- **`agents.json`: governed policy as code.** Each app has an `agents.json`. Changes require admin approval via hash verification.
- **Draft and published are fully separated.** Builders iterate freely with mock data. Published apps only run the last approved config.

`<<INSERT VIDEO OF SELF-BUILDING INTEGRATION HERE>>`

On top of that, Second handles the hard parts:

| Capability | &nbsp; |
|:---|:---|
| **🤹 Multi-agent orchestration** | Multiple specialized agents per app |
| **⏲️ Long-running async work** | Scheduled jobs, periodic research, background tasks |
| **🗃️ Live data persistence** | Real-time DB with Change Streams; survives restarts and churn |

<!-- ## Second Is Right For You If

- ✅ Your team has Claude, Codex, or Lovable prototypes that need to become real production software.
- ✅ You need internal tools where humans and agents work on the same workflows.
- ✅ You need agents to work with real systems while keeping access scoped, approved, and auditable.
- ✅ You want to keep using your own agent harness (e.g. Claude Code or Codex) to ship powerful internal apps.
- ✅ You need RBAC, agent access control, approval flows, audit logs, integrations, and safe deployments from the start.
- ✅ You want agents inside the app, not off to the side in a separate chat window.
- ✅ You have security constraints that require local, self-hosted, or on-prem deployment.
-->

<!-- ## Problems Second Solves

| Without Second | With Second |
|---|---|
| ❌ Prototypes work in Claude, Codex, or Lovable, then stall before production. | ✅ Apps are generated inside a governed workspace with the runtime pieces already there. |
| ❌ Agents work in separate chats and lose the context your team is acting on. | ✅ Agents and humans share the same app, real-time DB, and interface. |
| ❌ Every integration becomes a one-off security project. | ✅ Second generates scoped tools and keeps secrets server-side. |
| ❌ Agent permissions are hard to explain, approve, and audit. | ✅ `agents.json`, RBAC, approvals, and audit logs make access explicit. |
| ❌ Every team rebuilds deployment, governance, and collaboration from scratch. | ✅ One workspace gives teams and platform engineers the same foundation. |
-->

---

## Security & Governance

Second is designed for enterprise teams that need complete control over what humans and agents can access and do.

**Zero-trust architecture for agents.** No agent is granted implicit access to anything. Every capability, every data collection, every integration must be explicitly declared, scoped, and approved before an agent can act.

| Feature | Description |
|:---|:---|
| **Agent access control** | Capabilities defined in `agents.json`: approved collections, allowed tools, integration scopes. Changes require admin approval via cryptographic hash verification. Secrets injected server-side; agents never see credentials. |
| **Role-based access control** | Workspace roles (owner, admin, member) with granular permissions: `integrations:manage`, `members:invite`, `audit:read`. App-level roles for creators and collaborators. |
| **Approval flows** | Draft/review/publish lifecycle. Platform engineers approve apps, agent configs, and integration grants before anything goes live. |
| **Domain-locked tools** | Custom HTTP tools locked to declared domains. Private IP access rejected. Agents with org tools such as HubSpot and Slack are blocked from internet access. |
| **Audit logs** | Every action recorded: app changes, agent tool calls, data writes, access denials, integration usage. Secrets are never stored, only hashes and metadata. |
| **Workspace isolation** | Complete tenant isolation. Every query scoped to `workspaceId`. Cross-workspace access returns `404`, not `403`, to prevent resource enumeration. |
| **Subprocess hardening** | Infrastructure secrets scrubbed from agent subprocess environments. Linux deployments use `bubblewrap` sandboxing. CLI runtimes get allowlisted env + private per-app HOME. |

### `agents.json`: Agent Policy as Code

Every app's agent capabilities are declared, version-controlled, and approved:

```json
{
  "agents": [
    {
      "id": "lead-enricher",
      "name": "Lead Enricher",
      "description": "Enriches leads with public company data",
      "systemPrompt": "You are a lead enrichment agent...",
      "dataCollections": ["leads"],
      "tools": [
        { "type": "builtin", "name": "WebSearch", "enabled": true },
        {
          "type": "custom",
          "name": "hubspot_fetch_contacts",
          "integration": { "domain": "hubapi.com" },
          "endpoint": {
            "method": "GET",
            "url": "https://api.hubapi.com/crm/v3/objects/contacts",
            "headers": { "Authorization": "Bearer {{secrets.HUBSPOT_PRIVATE_APP_TOKEN}}" }
          }
        }
      ]
    }
  ]
}
```

<table>
<tr><td>

- Secrets are resolved server-side via `{{secrets.*}}` templates, never embedded in config
- Any change to `agents.json` **clears existing approval**, preventing silent config drift
- Published apps use the **last approved hash** only, while draft changes stay sandboxed

</td></tr>
</table>

## Self-Hosting

Second runs on your infrastructure: your k8s cluster, your VPC, your rules.

For full environment setup, see the [self-hosting docs](https://docs.second.so/self-hosting).

> [!TIP]
> Need help with security, SSO, deployment, cost management, runtime setup, or SLA support? Contact [sales@second.so](mailto:sales@second.so).

### Production Requirements

| Component | Requirement |
|:---|:---|
| **MongoDB 8.0+** | Replica set (required for Change Streams) |
| **Redis 7+** | Stream resumption, pub/sub, OAuth state |
| **Auth provider** | External auth (WorkOS or custom) for `SECOND_AUTH_MODE=external` |
| **HTTPS** | Reverse proxy with TLS termination |
| **Agent runtime credentials** | Claude: `ANTHROPIC_API_KEY` or Bedrock (`CLAUDE_CODE_USE_BEDROCK=1` with `AWS_BEARER_TOKEN_BEDROCK`, `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY`, or `AWS_PROFILE`); Codex: `CODEX_API_KEY` or `OPENAI_API_KEY` |

<br>

## Architecture

```
+------------------------------------------------------------------------------+
| Browser                                                                      |
| App UI, chat, generated app iframe                                           |
+-----------------------------------+------------------------------------------+
                                    |
                                    | REST + SSE
                                    v
+------------------------------------------------------------------------------+
| Web (Next.js)                                                                |
| Public entrypoint, auth, workspace guards, API routes, reviews               |
| Tool execution, secret resolution, app data, auditability                    |
+------------------+--------------------------+--------------------------+------+
                   |                          |                          |
                   | private HTTP + SSE       | persistent state         | replay + events
                   | internal auth            | Change Streams           | OAuth state + locks
                   v                          v                          v
+---------------------------+     +---------------------------+     +------------------+
| Worker (Hono)             |     | MongoDB Replica Set       |     | Redis            |
| Claude Code, Codex        |     | workspaces, apps, runs    |     | stream replay    |
| OpenCode, app agents      |     | app_data, audit logs      |     | workspace pubsub |
+-------------+-------------+     | integration metadata      |     +------------------+
              |                   +---------------------------+
              |
              | internal callbacks
              | /api/internal/*
              v
+------------------------------------------------------------------------------+
| Web-owned governed layer                                                     |
| Tool calls, app-data writes, approvals, tenant boundaries                    |
| Secrets stay server-side before reaching external systems                    |
+-----------------------------------+------------------------------------------+
                                    |
                                    | server-side tools
                                    v
+------------------------------------------------------------------------------+
| External systems                                                             |
| OAuth providers, APIs, internal services                                     |
+------------------------------------------------------------------------------+
```

Agents run in the Worker. App-data writes, tool calls, secret resolution, and audit trails go through the Web layer, so the Worker can run agents without becoming the source of truth for permissions or data.

<br>

## CLI

Run Second locally with one command:

```bash
npx --yes @second-inc/cli
```

| Platform | Status |
|:---|:---|
| Apple Silicon Mac (M1-M5) | **Available now** |
| Intel Mac, Linux, Windows | Coming soon |

<details>
<summary>&nbsp;&nbsp;<strong>CLI Commands</strong></summary>
<br>

```bash
npx --yes @second-inc/cli                      # Start Second
npx --yes @second-inc/cli stop                 # Stop all services
npx --yes @second-inc/cli reset                # Stop + delete all data
npx --yes @second-inc/cli --port 4000          # Custom port
npx --yes @second-inc/cli --disable-telemetry  # No analytics
```

</details>

<details>
<summary>&nbsp;&nbsp;<strong>Development from Source</strong></summary>
<br>

**Prerequisites:** Node.js 20+, npm 10+, Docker Desktop

This starts MongoDB + Redis in Docker, and the web + worker processes on your host. Open the URL printed by the script or check `.second-dev.txt`.

```bash
git clone https://github.com/Second-Inc/second.git
cd second
npm run dev
```

</details>

<br>

## Contributing

We welcome contributions. See [CONTRIBUTING.md](CONTRIBUTING.md) and the
[docs](https://docs.second.so) for architecture details and development setup.
Report security issues privately; see [SECURITY.md](SECURITY.md).

<br>

<p align="center">
  <sub>Second is licensed under the <a href="LICENSE">Apache License 2.0</a>.</sub>
</p>
