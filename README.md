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
      <br>
    </td>
    <td width="50%" valign="top">
      <h3 align="center">🛠️ For Platform Engineers</h3>
      <ul>
        <li>Fine-grained access control per app, per agent, per integration</li>
        <li>One-time workspace setup, unlimited apps</li>
        <li>Full governance: draft/review/publish lifecycle</li>
        <li>Deploy on your own k8s, air-gapped or on-prem</li>
      </ul>
      <br>
    </td>
  </tr>
</table>

---

## Features

<table>
<tr>
<td align="center" width="33%">
<h3>🔧 Self-Building Integrations</h3>
Second builds itself: integrations are generated on demand with exact connection instructions.
</td>
<td align="center" width="33%">
<h3>🤖 App Agents</h3>
Each app gets its own agents, with tools and data access presented for approval.
</td>
<td align="center" width="33%">
<h3>🔌 BYO Agent</h3>
Use Claude Code, Codex, OpenCode, or your own harness. Switch runtimes per app or message.
</td>
</tr>
<tr>
<td align="center">
<h3>👥 Multiplayer Sessions</h3>
Talk with Claude Code or Codex, invite teammates into the session, and collaborate with shared context.
</td>
<td align="center">
<h3>🔒 Permissions</h3>
Agents run with approved tools, data, and integrations. Everything is scoped and audited.
</td>
<td align="center">
<h3>⚡ Realtime</h3>
Live data, change streams, and optimistic updates keep teams and agents synced.
</td>
</tr>
<tr>
<td align="center">
<h3>🧠 Workspace Agents</h3>
Create reusable agents with prompts, skills, models, and team visibility.
</td>
<td align="center">
<h3>📚 Workspace Skills</h3>
Define instructions once, then attach them to agents across the workspace.
</td>
<td align="center">
<h3>🛡️ Governance</h3>
Draft, review, approve, and publish apps with agents and integrations under control.
</td>
</tr>
</table>

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

## What You Can Build

Second excels at apps where teams collaborate with agents on long-running, asynchronous workflows:

- **Competitor intelligence:** Agents monitor competitors, aggregate news, alert on pricing changes, and collect case studies.
- **Lead enrichment pipelines:** Agents research and qualify leads while your team reviews and acts.
- **Content operations:** Agents draft, research, and organize while editors review in real time.
- **Customer success dashboards:** Agents pull data from CRMs and support tools so teams can act on insights.
- **Internal knowledge bases:** Agents continuously index and organize docs while teams search and annotate.
- **Compliance monitoring:** Agents scan for policy violations while approvers review and resolve.

<!-- ### Example: Competitor Research

From a single prompt, build an app where agents:
- Produce a live **news feed** of latest competitor updates
- Run a scheduled job that **alerts on pricing changes**
- Maintain a **research overview** page with structured analysis
- Collect and store **PDFs and case studies** found across the web

-->

Your team sees everything in one collaborative interface. Agents write to the same database your team reads from, no export, no copy-paste, no context switching.

`<<INSERT SCREENSHOT OF COLLABORATIVE APP INTERFACE HERE>>`

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
