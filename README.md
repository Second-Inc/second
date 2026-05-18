<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="apps/web/public/favicon-dark.svg">
    <source media="(prefers-color-scheme: light)" srcset="apps/web/public/favicon-light.svg">
    <img alt="Second" src="apps/web/public/favicon-light.svg" width="72" height="67">
  </picture>
</p>

<h1 align="center">Second</h1>

<p align="center">
  The factory for custom internal software,<br>purpose-built for human–agent work.
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

Second lets every team ship custom internal software for managing agents and collaborating with them on async work.

Instead of adapting how you work to pre-built agent management software or generic SAAS, Second comes with the right primitives so every team can ship the exact interfaces and apps they need for managing and working alongside agents.

It's a single, beautifully governed workspace.

## Why Second?

When a team of humans and agents need to work together on actual workflows like research pipelines, enrichment, or monitoring - collaboration breaks. You need **control planes**: custom interfaces where your team sees what agents are doing, steers their work, and stays in control.

Most platforms get this wrong. They either treat agents as an afterthought bolted onto existing tools, or they're too opinionated — forcing you into their idea of how agent work should look (a kanban board, a chat thread, a static pipeline). We don't know what work you're doing, and we don't pretend to. Second is a factory: you build your own apps and interfaces.

**Think of it as an internal, self-hosted, collaborative Lovable, where humans and agents collaborate on the same custom apps your team builds.** Prompt an app → Second generates an agent control plane for your workflow: already deployed in your workspace, **with a real-time database, RBAC, and audit logs out of the box. Air-gapped on your k8s.**

> [!TIP]
> **Enterprise deployment?** See [Enterprise Deployment and Security](https://docs.second.so/enterprise) — covers customer-owned auth and OAuth apps, `agents.json` approval, secret injection, tenant isolation, and auditability.
>
> Need help with secure deployment, cost management, runtime setup, or production support? Contact [sales@second.so](mailto:sales@second.so).

## Core Philosophy: Agent-Native Software

Every app built in Second treats **agents as first-class citizens**: they read and write to the same real-time DB your team works on, get scoped and secure tools to get the job done inside the apps you've built, and work alongside humans.

On top of that, Second handles the hard parts:

| Capability | How It Works |
|---|---|
| **Multi-agent orchestration** | Run multiple specialized agents per app: one for research, one for alerts, one for enrichment |
| **Long-running async work** | Agents run scheduled jobs, periodic research, and alerting, not just chat |
| **Live data persistence** | MongoDB-backed collections with Change Streams; data survives browser close, agent restarts, and worker churn |

<br>

## The Wall Everyone Hits

You've already seen it happen.

Someone on your team builds something amazing with Claude Code, Codex, or Lovable. A prototype, an internal tool, an automation that genuinely works. Then they try to take it further — and hit the wall:

- How do you deploy and share it safely?
- How do you give agents scoped access to critical systems?
- What about real-time collaboration? RBAC? Agent RBAC?
- Secure integrations? Audit logs? Cost management?

There are beautiful initiatives happening inside organizations right now. Teams are building genuinely useful things with AI — literally anything is possible today — and most of it will never reach production. It'll never connect to critical systems. It'll never get the governance sign-off. It'll stay as demos, prototypes, and Slack messages that say *"check out what I built."*

Companies like **Ramp** and **Deel** have already figured this out — they built their own internal platforms.

**Second is the infrastructure to let every team do the same.**

<table>
  <tr>
    <td width="50%" valign="top">
      <h3>For Teams</h3>
      <ul>
        <li>Build custom apps from a single prompt</li>
        <li>Run multiple agents in parallel across workflows</li>
        <li>Real-time collaborative UI with agents and humans on the same page</li>
        <li>No code required — designed for non-technical teams</li>
      </ul>
    </td>
    <td width="50%" valign="top">
      <h3>For Platform Engineers</h3>
      <ul>
        <li>One-time workspace setup, unlimited apps</li>
        <li>Full governance: draft/review/publish lifecycle</li>
        <li>Fine-grained access control per app, per agent, per integration</li>
        <li>Deploy on your own k8s, air-gapped or on-prem</li>
      </ul>
    </td>
  </tr>
</table>

<br>

## Features

<table>
<tr>
<td align="center" width="33%">
<h3>🔌 Bring Your Own Agent</h3>
Any agent, any runtime, one workspace. Claude Code, Codex, OpenCode, and more. Switch per message, per app, without restarting conversations.
</td>
<td align="center" width="33%">
<h3>🔧 Self-Building Integrations</h3>
No MCP. Second builds scoped, custom tools on the fly for each agent. OAuth-connected, domain-locked, secrets injected server-side. Connects to literally anything.
</td>
<td align="center" width="33%">
<h3>☁️ Open Platform</h3>
Your cloud, your agents, your integrations. Runs on your k8s cluster, your VPC, your rules. No vendor lock-in, no data leaving your network.
</td>
</tr>
<tr>
<td align="center">
<h3>👥 Multiplayer Agent Sessions</h3>
Every workspace ships with multiplayer Claude Code and Codex sessions in your cloud, with scoped access control. Not a separate feature. Just how the platform works.
</td>
<td align="center">
<h3>🔒 Zero-Trust Governance</h3>
Agent RBAC, human RBAC, audit logs, approval flows. Nothing runs without explicit declaration and sign-off. Full tenant isolation per workspace.
</td>
<td align="center">
<h3>⚡ Real-Time Collaboration</h3>
Agents and humans on the same page, same database, same UI. Change streams, optimistic updates, instant sync. Data survives browser close, agent restarts, and worker churn.
</td>
</tr>
</table>

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
