<p align="center">
  <picture>
    <source srcset="docs/assets/readme_cover.webp" type="image/webp">
    <img src="docs/assets/readme_cover.jpg" alt="Second — humans and agents, side by side" width="100%">
  </picture>
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

Second is a factory for custom internal software,<br>purpose-built for human2agent and agent2agent work.

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

Second the most powerful way to build custom GUIs for agents.

It lets you orchestrate a team of agents inside custom apps built around your workflows, giving agents room to work while your team stays in full control.

From one prompt, Second builds complete apps **that treat agents as first-class citizens:** agents work inside the apps you build, right alongside your team. They read and write to the same real-time DB, call only the tools you approve, and perform actual work without broad access to your company.

### How It Works

Second is a single workspace.

1. **You describe your app.** In a single prompt.
2. **Second generates it.** The UI, agents, scoped tools, and real-time DB. Tools are presented for approval.
3. **Your team works alongside agents** in the same shared custom software.

<table align="center" width="100%" cellpadding="16">
  <tr>
    <td align="center">
      <h3>Example: <strong>competitor tracker app</strong> built on Second</h3>
      <p>This example features agents discovering new competitors, enriching them, and generating a weekly recap deck from all available information.</p>
      <video src="https://github.com/user-attachments/assets/2116c633-48f3-415a-a047-a72f05da3166" width="600" controls></video>
      <p><sub>GitHub mobile app? <a href="https://github.com/user-attachments/assets/2116c633-48f3-415a-a047-a72f05da3166">Click here to watch the video →</a></sub></p>
      <p>•</p>
      <p align="left"><strong>Second is the most powerful way to build custom GUIs for agents.</strong><br>Production-ready software for your team, deployed in your VPC, built around your workflows.</p>
      <br>
    </td>
  </tr>
</table>

## Second VS other solutions

Most platforms weren't built for multiplayer, async work with agents. They either treat agents as an afterthought bolted onto existing tools, or they're too opinionated and end up not fitting how your team actually works.

Second solves that: think Paperclip or Multica, but instead of pre-built software you get to build your own custom GUI for a team of agents, tailored to your company's needs.

---

## Core Philosophy

| Principle | What it means in Second |
|:---|:---|
| **Build the app, not just the agent.** | The durable artifact is working internal software: a focused UI, live data, team workflows, and agents that operate inside that product. |
| **Agents are first-class citizens.** | Apps can include multiple named agents with roles, tools, data access, schedules, and visible run history. They are not bolted-on chat widgets. |
| **Humans stay in command.** | Plans, agent configs, integration setup, and publishing go through explicit review. Agents can work freely only inside the boundaries you approved. |
| **Small tools beat broad access.** | The builder creates scoped tools for the specific app and use case. Tools are tied to approved domains, collections, integration grants, and secret placeholders. |
| **Integrations should self-build.** | Instead of starting with a giant MCP catalog or handing agents every connector, Second generates the narrow integration contract and human setup instructions the app actually needs. |
| **Collaboration is the runtime.** | Agent-to-agent and agent-to-human work happens through the app's shared state, realtime updates, resumable streams, comments, approvals, and audit trail. |
| **Generated software must still be real software.** | Draft and published snapshots are separated, source is persisted, builds are checked, data survives restarts, and production access follows the same tenant and permission model. |
| **Local-first, on-prem-ready.** | Start on your machine. Deploy inside your cloud when the workflow matters. Your VPC, your auth provider, your secrets, your rules. |

---

## The Internal Platform Everyone Needs (and Builds)

Companies like **Ramp** and **Deel** have already figured out that teams are building amazing things internally with Claude, Codex, and Lovable-style builders, but most of that work never reaches production. Security, governance, integrations, maintenance, agent access control, and deployment all become platform problems.

So they build internal platforms for themselves.

**Second lets every organization have that platform layer.**

Every app you build in Second gets a realtime database, app agents, scoped tools, audit logs, RBAC, agent RBAC, review flows, and governance controls built into the workspace.

<table>
  <tr>
    <td width="50%" valign="top">
      <h3 align="center">👥 For Teams</h3>
      <ul>
        <li>Build custom internal apps from a single prompt</li>
        <li>Run multiple agents across the workflows your team already owns</li>
        <li>Work in a realtime collaborative UI where agents and humans share state</li>
        <li>Move before credentials are connected: integrations return mock data until configured</li>
      </ul>
    </td>
    <td width="50%" valign="top">
      <h3 align="center">🛠️ For Platform Engineers</h3>
      <ul>
        <li>Fine-grained access control per app, agent, collection, and integration</li>
        <li>One-time workspace setup, unlimited apps</li>
        <li>Full governance: draft, review, approve, publish, audit</li>
        <li>Deploy on your own Kubernetes cluster, air-gapped or on-prem</li>
      </ul>
    </td>
  </tr>
</table>

> [!TIP]
> **Enterprise deployment?** See [Enterprise Deployment and Security](https://docs.second.so/enterprise).
>
> Need help with security, SSO, deployment, cost management, runtime setup, and SLA support? Contact [sales@second.so](mailto:sales@second.so).

---

## Features

| Feature | &nbsp; |
|:---|:---|
| **🔧 Prompt-to-App Generation** | Generate internal apps, data models, agents, tools, and setup instructions from one prompt |
| **🤖 App Agents** | Each app gets its own first-class agents with roles, prompts, data access, and approved tools |
| **🧰 Scoped Tool Generation** | Tools are generated per app and tied to explicit domains, collections, inputs, and integration grants |
| **🔌 Self-Building Integrations** | Second creates connection requirements and human setup instructions only when the app needs them |
| **🤹 Multi-Agent Orchestration** | Run specialized agents in parallel across foreground, background, scheduled, and async workflows |
| **🔄 BYO Runtime** | Use Claude Code, Codex, OpenCode, or your own harness. Switch runtimes per app or message |
| **⚡ Realtime Collaboration** | Live data, change streams, resumable streams, and optimistic updates keep teams and agents synced |
| **👥 Multiplayer Sessions** | Talk with agents, invite teammates into sessions, and collaborate with shared context |
| **🔒 Agent Permissions** | Agents run with approved tools, data, and integrations. Everything is scoped and audited |
| **🛡️ Governance** | Draft, review, approve, and publish apps with agents and integrations under control |
| **📋 Audit Logs** | Every agent action, tool call, data write, and access denial recorded and searchable |
| **🏠 Self-Hosted / On-Prem** | Deploy on your own infrastructure. Your Kubernetes cluster, your VPC, your rules |
| **🧠 Workspace Agents** | Create reusable agents with prompts, skills, models, and team visibility |
| **📚 Workspace Skills** | Define instructions once, then attach them to agents across the workspace |
| **⏲️ Scheduled Agent Jobs** | Agents run on a schedule for periodic research, monitoring, and background tasks |
| **🚀 One-Command Setup** | From zero to running with `npx @second-inc/cli` |

## What You Can Build

<table>
<tr>
<td width="100%" valign="top">

<div align="center">

<h3>🎯 Lead Enrichment Pipeline</h3>

<sub>**Flow:** 🤖 Scrape leads → 🤖 Enrich from LinkedIn + web → 🤖 Score and rank → 👤 Team reviews top leads</sub><br>
<sub>**Tools:** HubSpot, LinkedIn, Web Search</sub><br>
<sub>**Agents:** Scraper Agent, Enrichment Agent, Scoring Agent</sub>

</div>

<table align="center" width="90%" cellpadding="10">
  <tr>
    <td colspan="3"><strong>PIPELINE</strong> <span align="right">47 leads ▼</span></td>
  </tr>
  <tr>
    <td><sub>Lead</sub></td>
    <td><sub>Score</sub></td>
    <td><sub>Status</sub></td>
  </tr>
  <tr>
    <td><strong>Acme Corp</strong></td>
    <td>92/100</td>
    <td>✅ Ready<br>👤 <code>[Call]</code></td>
  </tr>
  <tr>
    <td><strong>Nova Labs</strong></td>
    <td>78/100</td>
    <td>🤖 Enriching<br>🤖 Score next</td>
  </tr>
  <tr>
    <td><strong>Peak Inc</strong></td>
    <td>--</td>
    <td>🤖 Scraping...<br><sub>3 sources</sub></td>
  </tr>
  <tr>
    <td colspan="3">💬 <strong>Scoring Agent</strong><br>"Acme Corp: 200 employees, Series A, hiring 3 engineers. Score: 92. Ready for review."<br><br>👤 <code>[Accept]</code> <code>[Edit]</code> <code>[Skip]</code></td>
  </tr>
</table>

</td>
</tr>
<tr>
<td width="100%" valign="top">

<div align="center">

<h3>📊 GTM War Room</h3>

<sub>**Flow:** 🤖 Agent pulls weekly metrics → 👤 PMM reviews positioning → 👤 Sales adds field notes → 🤖 Agent generates battlecard</sub><br>
<sub>**Tools:** HubSpot, Slack, Google Docs, Analytics</sub><br>
<sub>**Agents:** Metrics Agent, Battlecard Agent</sub>

</div>

<table align="center" width="90%" cellpadding="10">
  <tr>
    <td colspan="2"><strong>GTM WAR ROOM</strong></td>
    <td align="right"><sub>Week 21 ▼</sub></td>
  </tr>
  <tr>
    <td width="36" align="center">📈</td>
    <td colspan="2"><strong>THIS WEEK</strong><br>Pipeline: $320k (+14%)<br>Win rate: 38% (up from 31%)<br>Lost to competitor: 3 deals</td>
  </tr>
  <tr>
    <td width="36" align="center">👤</td>
    <td colspan="2"><strong>PMM added positioning note</strong><br>"Emphasize self-hosted angle vs. Acme's cloud-only offer"</td>
  </tr>
  <tr>
    <td width="36" align="center">👤</td>
    <td colspan="2"><strong>Sales added field note</strong><br>"Acme offering 40% discounts to win back churned accounts"</td>
  </tr>
  <tr>
    <td width="36" align="center">🤖</td>
    <td colspan="2"><strong>Battlecard Agent</strong><br>"Updated battlecard with new field intel. 2 new objection handlers added."<br><br>👤 <code>[Review card]</code> <code>[Push to Docs]</code></td>
  </tr>
</table>

</td>
</tr>
</table>

And many more:

| Use Case | What It Does | Tools | Agents |
|:---|:---|:---|:---|
| **Competitor Research Dashboard** | Monitor competitor changes, review and flag important updates, compile reports, and share research | Web Search, Google Alerts, Drive | Research Agent, Alert Agent, Report Agent |
| **Content Curation Pipeline** | Fetch videos, select clips, cut and upload assets, and route finished content for approval | YouTube API, Clipping Service, Google Drive | Curator Agent, Clip Agent |
| **Social Media Ops** | Draft posts, schedule across platforms, track engagement, repurpose top performers | Twitter/X, LinkedIn, Buffer | Content Agent, Scheduling Agent, Analytics Agent |
| **Recruiting Pipeline** | Source candidates, screen resumes, schedule interviews, track pipeline | LinkedIn, ATS, Google Calendar, Gmail | Sourcing Agent, Screening Agent, Scheduling Agent |
| **Customer Success** | Pull data from CRMs and support tools, surface churn risk, draft outreach | HubSpot, Intercom, Slack | Insights Agent, Churn Agent, Outreach Agent |
| **Invoice & Expense Tracking** | Collect invoices from email, extract data, match to POs, flag discrepancies | Gmail, Google Drive, Accounting API | Extraction Agent, Matching Agent, Approval Agent |
| **Compliance Monitoring** | Scan for policy violations, flag issues, route to approvers | Internal APIs, Slack, Jira | Compliance Agent, Triage Agent, Routing Agent |
| **Internal Knowledge Base** | Continuously index docs, summarize updates, answer team questions | Notion, Confluence, Slack | Indexing Agent, Summary Agent, Q&A Agent |
| **Founder's Daily Brief** | Aggregate metrics, news, emails, and calendar into one morning summary | Gmail, Google Calendar, Analytics, Web Search | Metrics Agent, News Agent, Brief Agent |
| **PR & Media Monitoring** | Track brand mentions, analyze sentiment, draft responses, alert on crises | Web Search, Twitter/X, Slack, Google Docs | Monitor Agent, Sentiment Agent, Response Agent |
| **Product Feedback Loop** | Collect feedback from support tickets, reviews, and calls, cluster themes, surface to PM | Intercom, G2, Gong, Slack | Collection Agent, Clustering Agent, Summary Agent |
| **Vendor & Contract Management** | Track renewal dates, compare pricing, flag expiring contracts, draft RFPs | Gmail, Notion, Slack | Tracker Agent, Comparison Agent, Draft Agent |
| **SEO Content Pipeline** | Research keywords, generate briefs, draft articles, track rankings | Ahrefs, Web Search, Notion, Analytics | Research Agent, Brief Agent, Writer Agent |
| **Security Alert Triage** | Ingest alerts from multiple tools, deduplicate, prioritize, assign to on-call | PagerDuty, Slack, Jira, SIEM API | Ingestion Agent, Triage Agent, Assignment Agent |
| **Meeting Follow-ups** | Record action items from meetings, assign owners, send follow-up emails, track completion | Google Calendar, Gong, Gmail, Notion | Notes Agent, Follow-up Agent, Tracker Agent |

---

## What Second Handles

Second is not just a prompt-to-UI generator. It is the control layer around the generated app:

- **Scoped tools per app, per agent.** Agents receive the smallest useful tool surface for the workflow, not blanket access to a connector.
- **Self-building integration setup.** The builder creates the integration contract, setup instructions, mock data, and tool definitions needed by the app.
- **Server-side secret resolution.** Agents never receive raw API keys, OAuth tokens, cookies, or provider secrets.
- **`agents.json` as governed policy.** Every runtime capability is declared, validated, approved, hashed, and invalidated when it changes.
- **Draft / published separation.** Builders can keep iterating while team members keep using the last approved published version.

On top of that, Second handles the hard parts:

| Capability | &nbsp; |
|:---|:---|
| **🤹 Multi-agent orchestration** | Multiple specialized agents per app, coordinated through shared app state |
| **⏲️ Long-running async work** | Scheduled jobs, periodic research, background runs, and resumable streams |
| **🗃️ Live data persistence** | Realtime DB with Change Streams; app data survives restarts and user churn |
| **🧾 Governance and auditability** | Review flows, access checks, integration approvals, and searchable audit events |

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

Second runs on your infrastructure: your Kubernetes cluster, your VPC, your rules.

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
