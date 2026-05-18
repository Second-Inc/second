<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="apps/web/public/favicon-dark.svg">
    <source media="(prefers-color-scheme: light)" srcset="apps/web/public/favicon-light.svg">
    <img alt="Second" src="apps/web/public/favicon-light.svg" width="72" height="67">
  </picture>
</p>

<h1 align="center">Second</h1>

<p align="center">
  The factory for custom internal software,<br>purpose-built for human2agent work.
</p>

<p align="center">
  <a href="LICENSE"><img src="https://img.shields.io/badge/License-Apache_2.0-blue.svg" alt="License"></a>&nbsp;&nbsp;
  <a href="#quick-start"><img src="https://img.shields.io/badge/Try_it-npx_@second--inc/cli-black.svg" alt="Try it"></a>&nbsp;&nbsp;
  <a href="#platform-support"><img src="https://img.shields.io/badge/Platform-Apple_Silicon-lightgrey.svg" alt="Platform"></a>
</p>

<h3 align="center">⭐ Like what we're doing? Give us a star ⬆️</h3>

<p align="center">
  <a href="#quick-start"><strong>Quick Start</strong></a> &nbsp;&nbsp;|&nbsp;&nbsp;
  <a href="https://docs.second.so"><strong>Docs</strong></a> &nbsp;&nbsp;|&nbsp;&nbsp;
  <a href="#security--governance"><strong>Security & Governance</strong></a> &nbsp;&nbsp;|&nbsp;&nbsp;
  <a href="#self-hosting"><strong>Self-Hosting</strong></a>
</p>

## Quick Start

```bash
npx --yes @second-inc/cli
```

| Platform | Status |
|:---|:---|
| Apple Silicon Mac (M1-M5) | **Available now** |
| Intel Mac, Linux, Windows | Coming soon |

<br>

## What is Second?

Second is a factory for shipping internal software built for human-agent collaboration.

Most platforms were not built for deep, multiplayer, asynchronous work with AI agents. They either treat agents as an afterthought bolted onto existing tools, or they're too opinionated and end up not fitting how your team actually works. Generally, multiplayer human-agent work is where coordination gets hard and things start to break.

**Second solves that:** imagine an on-prem, secure Lovable for building complete internal software (e.g. competitor research, lead enrichment, various pipelines) **that treats agents as first-class citizens:** agents read and write to the same real-time DB as your human team does, get dynamically generated, scoped tools to do the work inside the apps you've built — and most importantly work alongside your human team.

Second is open-source, self-hosted, and bring your own agent.

> [!TIP]
> **Enterprise deployment?** See [Enterprise Deployment and Security](https://docs.second.so/enterprise) — covers customer-owned auth and OAuth apps, `agents.json` approval, secret injection, tenant isolation, and auditability.
>
> Need help with secure deployment, cost management, runtime setup, or production support? Contact [sales@second.so](mailto:sales@second.so).

## Personal Software Factory

Every app you build in Second gets a real-time DB, audit logs, RBAC, agent RBAC, and governance tools built into the workspace.

Companies like **Ramp** and **Deel** have already figured out that teams are building amazing things internally with Claude, Codex, or Lovable, but most of these projects never reach production because of various reasons (security, integrations, governance, safe deployments, maintenance, agent access control, and so on...).

**To solve this, they built internal platforms for themselves. Second lets every organization have that.**

<table>
  <tr>
    <td width="50%" valign="top">
      <h3 align="center">👥 For Teams</h3>
      <ul>
        <li>Build custom apps from a single prompt</li>
        <li>Run multiple agents in parallel across workflows</li>
        <li>Real-time collaborative UI with agents and humans on the same page</li>
        <li>No code required — designed for non-technical teams</li>
      </ul>
      <br>
    </td>
    <td width="50%" valign="top">
      <h3 align="center">🛠️ For Platform Engineers</h3>
      <ul>
        <li>One-time workspace setup, unlimited apps</li>
        <li>Full governance: draft/review/publish lifecycle</li>
        <li>Fine-grained access control per app, per agent, per integration</li>
        <li>Deploy on your own k8s, air-gapped or on-prem</li>
      </ul>
      <br>
    </td>
  </tr>
</table>

## Features

<table>
<tr>
<td align="center" width="33%">
<h3>🔧 Self-Building Integrations</h3>
Second builds itself: integrations are generated on demand with exact connection instructions.
</td>
<td align="center" width="33%">
<h3>🔌 Bring Your Own Agent</h3>
Use Claude Code, Codex, OpenCode, or your own harness. Switch runtimes per app or message.
</td>
<td align="center" width="33%">
<h3>🧱 App Runtime Included</h3>
Each app gets real-time data, audit logs, RBAC, agent RBAC, and governance in the workspace.
</td>
</tr>
<tr>
<td align="center">
<h3>👥 Multiplayer Agent Sessions</h3>
Talk with Claude Code or Codex, invite teammates into the session, and collaborate with shared context.
</td>
<td align="center">
<h3>🔒 Zero Trust Permissions</h3>
Agents get only approved tools, data, and integrations. Everything is scoped and audited.
</td>
<td align="center">
<h3>⚡ Real-Time Collaboration</h3>
Change streams and optimistic updates keep teams and agents synced as work happens.
</td>
</tr>
</table>

<br>

## Core Philosophy: Agent-Native Software

Every app built in Second treats **agents as first-class citizens**: they read and write to the same real-time DB your team works on, get scoped and secure tools to get the job done inside the apps you've built, and work alongside humans.

On top of that, Second handles the hard parts:

| Capability | How It Works |
|---|---|
| **Multi-agent orchestration** | Run multiple specialized agents per app: one for research, one for alerts, one for enrichment |
| **Long-running async work** | Agents run scheduled jobs, periodic research, and alerting, not just chat |
| **Live data persistence** | MongoDB-backed collections with Change Streams; data survives browser close, agent restarts, and worker churn |

## Second Is Right For You If

- ✅ Your team has Claude, Codex, or Lovable prototypes that need to become real production software.
- ✅ You need internal tools where humans and agents work on the same workflows.
- ✅ You need agents to work with real systems while keeping access scoped, approved, and auditable.
- ✅ You want to keep using your own agent harness (e.g. Claude Code or Codex) to ship powerful internal apps.
- ✅ You need RBAC, agent access control, approval flows, audit logs, integrations, and safe deployments from the start.
- ✅ You want agents inside the app, not off to the side in a separate chat window.
- ✅ You have security constraints that require local, self-hosted, or on-prem deployment.

## Problems Second Solves

| Without Second | With Second |
|---|---|
| Prototypes work in Claude, Codex, or Lovable, then stall before production. | Apps are generated inside a governed workspace with the runtime pieces already there. |
| Agents work in separate chats and lose the context your team is acting on. | Agents and humans share the same app, real-time DB, and interface. |
| Every integration becomes a one-off security project. | Second generates scoped tools and keeps secrets server-side. |
| Agent permissions are hard to explain, approve, and audit. | `agents.json`, RBAC, approvals, and audit logs make access explicit. |
| Every team rebuilds deployment, governance, and collaboration from scratch. | One workspace gives teams and platform engineers the same foundation. |

<br>

## What You Can Build

Second excels at apps where teams collaborate with agents on long-running, asynchronous workflows:

| Use Case | What Agents Do |
|:---|:---|
| **Competitor intelligence** | Monitor competitors, aggregate news, alert on pricing changes, collect case studies |
| **Lead enrichment pipelines** | Research and qualify leads while your team reviews and acts |
| **Content operations** | Draft, research, and organize while editors review in real-time |
| **Customer success dashboards** | Pull data from CRMs and support tools; teams act on insights |
| **Internal knowledge bases** | Continuously index and organize docs; teams search and annotate |
| **Compliance monitoring** | Scan for policy violations; approvers review and resolve |

### Example: Competitor Research

From a single prompt, build an app where agents:
- Produce a live **news feed** of latest competitor updates
- Run a scheduled job that **alerts on pricing changes**
- Maintain a **research overview** page with structured analysis
- Collect and store **PDFs and case studies** found across the web

Your team sees everything in one collaborative interface. Agents write to the same database your team reads from, no export, no copy-paste, no context switching.

The flexibility is unlimited. If your workflow involves humans and agents collaborating on structured data, Second handles the infrastructure so you can focus on the work.

<br>

## Security & Governance

Second is designed for enterprise teams that need complete control over what agents can access and do.

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

<br>

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

<br>

## Self-Hosting

Second runs on your infrastructure: your k8s cluster, your VPC, your rules.

<br>

### Deployment Options

| Method | Use Case |
|:---|:---|
| `npx --yes @second-inc/cli` | Local / single-machine (Apple Silicon) |
| `npm run start` | Docker Compose from source |
| `npm run release` | Docker Compose with prebuilt images |
| Kubernetes | Production on-prem / cloud |

<br>

### Production Requirements

| Component | Requirement |
|:---|:---|
| **MongoDB 8.0+** | Replica set (required for Change Streams) |
| **Redis 7+** | Stream resumption, pub/sub, OAuth state |
| **Auth provider** | External auth (WorkOS or custom) for `SECOND_AUTH_MODE=external` |
| **HTTPS** | Reverse proxy with TLS termination |
| **Agent runtime key** | `ANTHROPIC_API_KEY`, `CODEX_API_KEY`, or `OPENAI_API_KEY` |

<br>

### Key Environment Variables

```bash
# Web
SECOND_AUTH_MODE=external
MONGODB_URI=mongodb+srv://...
SECOND_PUBLIC_URL=https://second.your-domain.com
WORKER_URL=http://worker:3001
REDIS_URL=redis://redis:6379
INTERNAL_API_TOKEN=<strong-shared-secret>

# Worker
PORT=3001
INTERNAL_API_TOKEN=<same-shared-secret>
TOOL_EXECUTE_URL=http://web:3000/api/internal/tool-execute
ANTHROPIC_API_KEY=sk-ant-...
```

<br>

<details>
<summary>&nbsp;&nbsp;<strong>Production Hardening Checklist</strong></summary>
<br>

- [ ] MongoDB and Redis restricted to application network
- [ ] `INTERNAL_API_TOKEN` is a strong random secret (shared between web + worker)
- [ ] HTTPS with valid certificates
- [ ] External auth provider configured
- [ ] WorkOS Vault for OAuth/integration secrets (or `SECOND_TOKEN_ENCRYPTION_KEY` for local encryption)
- [ ] Agent runtime credentials provisioned per-workspace
- [ ] `bubblewrap` installed on Linux worker nodes for subprocess sandboxing
- [ ] Audit log retention policy configured

</details>

<br>

## Architecture

```
┌──────────────────────────────────────────────────────────────────┐
│                           Browser                                 │
│              useChat hook + real-time data subscriptions          │
└──────────────────────────────┬───────────────────────────────────┘
                               │
                      SSE streams + REST
                               │
┌──────────────────────────────▼───────────────────────────────────┐
│                       Web (Next.js)                               │
│     Auth · Validation · Workspace Context · API Routes · Guard   │
└────────────┬─────────────────────────────────────┬───────────────┘
             │                                     │
      POST /sessions                   Change Streams + REST
             │                                     │
┌────────────▼────────────┐           ┌────────────▼───────────────┐
│     Worker (Hono)       │           │    MongoDB (Replica Set)    │
│                         │           │                             │
│    Claude Agent SDK     │           │   apps · runs · app_data    │
│    Codex CLI            │───────────│   audit_events · members    │
│    OpenCode             │           │   integrations · creds      │
└────────────┬────────────┘           └─────────────────────────────┘
             │
      Server-side secret injection
             │
┌────────────▼────────────┐
│     Redis               │
│                         │
│    Stream resumption    │
│    Pub/sub events       │
│    OAuth state          │
└─────────────────────────┘
```

<br>

## CLI

```bash
npx --yes @second-inc/cli              # Start Second
npx --yes @second-inc/cli stop         # Stop all services
npx --yes @second-inc/cli reset        # Stop + delete all data
npx --yes @second-inc/cli --port 4000  # Custom port
npx --yes @second-inc/cli --disable-telemetry  # No analytics
```

<br>

## Platform Support

| Platform | Status |
|:---|:---|
| Apple Silicon (M1–M5) | **Available** |
| Intel Mac | Coming soon |
| Linux (x86_64) | Coming soon |
| Windows (WSL2) | Coming soon |

Source development (Docker mode) works on any platform with Docker Desktop.

<br>

## Contributing

We welcome contributions. See [CONTRIBUTING.md](CONTRIBUTING.md) and the
[docs](https://docs.second.so) for architecture details and development setup.
Report security issues privately; see [SECURITY.md](SECURITY.md).

```bash
git clone https://github.com/Second-Inc/second.git
cd second
npm run dev
```

<br>

<p align="center">
  <sub>Second is licensed under the <a href="LICENSE">Apache License 2.0</a>.</sub>
</p>
