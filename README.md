<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="apps/web/public/favicon-dark.svg">
    <source media="(prefers-color-scheme: light)" srcset="apps/web/public/favicon-light.svg">
    <img alt="Second" src="apps/web/public/favicon-light.svg" width="72" height="67">
  </picture>
</p>

<h1 align="center">Second</h1>

<p align="center">
  A factory for custom internal interfaces<br>where humans and agents work together.
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

---

<br>

## What is Second?

Second is a factory for building custom internal software, where humans and AI agents collaborate on real work, on the same shared custom interfaces.

Instead of adapting your workflows to pre-built agent management interfaces or generic SAAS, Second comes with the right primitives — so every team can ship the exact interfaces they need for managing and collaborating with agents.

It's a single, beautifully governed workspace.

Prompt an app, and Second generates an agent control plane for your workflow — already deployed in your workspace, with a real-time database, permissions, and audit logs out of the box. Air-gapped on your k8s.

Above all, every app built on Second treats agents as first-class citizens. They read and write to the same real-time DB your team is working on, get scoped and secure tools to get the job done inside the apps you've built, and work alongside humans on the same custom interfaces.

> [!TIP]
> **Enterprise deployment?** See [Enterprise Deployment and Security](https://docs.second.so/enterprise) — covers customer-owned auth and OAuth apps, `agents.json` approval, secret injection, tenant isolation, and auditability.
>
> Need help with secure deployment, cost management, runtime setup, or production support? Contact [sales@second.so](mailto:sales@second.so).

<strong>Think of it as:</strong> An internal, secure, and collaborative Lovable that runs on-prem — purpose-built for long-running, asynchronous work with agents.

<br>

---

<br>

## Bring Your Agent

Bring your own agent harness, switch runtimes and models per message, per app, without restarting conversations.

<table>
  <tr>
    <td width="120" align="center">
      <img src="apps/web/public/icons/claude-code.svg" width="28" height="28" alt="Claude Code">
    </td>
    <td width="120" align="center">
      <img src="apps/web/public/icons/codex.svg" width="28" height="28" alt="Codex">
    </td>
    <td width="120" align="center">
      <img src="apps/web/public/icons/opencode.svg" width="28" height="28" alt="OpenCode">
    </td>
  </tr>
  <tr>
    <td align="center"><sub><strong>Claude Code</strong></sub></td>
    <td align="center"><sub><strong>Codex</strong></sub></td>
    <td align="center"><sub><strong>OpenCode</strong></sub></td>
  </tr>
  <tr>
    <td align="center"><sub>✅</sub></td>
    <td align="center"><sub>✅</sub></td>
    <td align="center"><sub>Coming soon</sub></td>
  </tr>
</table>


---

## Why Second?

Every team is hitting the same wall: you build a v1 of an internal tool with Codex, Claude, or Lovable. Then comes the **"Ok, now what?"** phase:

- How do you deploy and share it safely?
- How do you make your software accessible for agents?
- What about real-time collaboration? RBAC? Agent RBAC?
- Secure integrations? Audit logs? Cost management?

Companies like **Ramp** and **Deel** have built their own custom platforms to solve this.

**Second is the infrastructure to let everyone else do the same.**

<table>
  <tr>
    <td width="50%" valign="top">
      <h3>For Teams</h3>
      <ul>
        <li>Build custom apps from a single prompt</li>
        <li>Run multiple agents in parallel across workflows</li>
        <li>Real-time collaborative UI with agents and humans on the same page</li>
        <li>No code required, designed for non-technical teams</li>
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

---

## Quick Start

One command, designed to run fully locally and stay free forever.

```bash
npx --yes @second-inc/cli
```

**Supported platforms**

| Platform | Status |
|:---|:---|
| Apple Silicon Mac (M1-M4) | **Available now** |
| Intel Mac | Coming soon |
| Linux | Coming soon |
| Windows / WSL2 | Coming soon |

<br>

<details>
<summary>&nbsp;&nbsp;<strong>CLI Commands</strong></summary>
<br>

```bash
npx --yes @second-inc/cli              # Start Second
npx --yes @second-inc/cli stop         # Stop all services
npx --yes @second-inc/cli reset        # Stop + delete all data
npx --yes @second-inc/cli --port 4000  # Custom port
npx --yes @second-inc/cli --disable-telemetry  # No analytics
```

</details>

<details>
<summary>&nbsp;&nbsp;<strong>Development from Source</strong></summary>
<br>

**Prerequisites:** Node.js 20+, npm 10+, Docker Desktop

```bash
git clone https://github.com/Second-Inc/second.git
cd second
npm run dev
```

This starts MongoDB + Redis in Docker, and the web + worker processes on your host. Open the URL printed by the script or check `.second-dev.txt`.

</details>

<br>

---

## Agent-Native Software

This is the core paradigm of Second. Every app treats agents as **first-class citizens**:

| Capability | How It Works |
|---|---|
| **Shared real-time database** | Agents read and write to the same live database as your team, with optimistic updates, change streams, and instant sync |
| **Scoped & secure tools** | Each agent gets precisely the tools it needs via `agents.json`, nothing more |
| **Collaborative UI** | Agents work alongside your team on the same custom-built interface |
| **Multi-agent orchestration** | Run multiple specialized agents per app: one for research, one for alerts, one for enrichment |
| **Long-running async work** | Agents run scheduled jobs, periodic research, and alerting, not just chat |
| **Live data persistence** | MongoDB-backed collections with Change Streams; data survives browser close, agent restarts, and worker churn |

### Example: Competitor Research

From a single prompt, build an app where agents:
- Produce a live **news feed** of latest competitor updates
- Run a scheduled job that **alerts on pricing changes**
- Maintain a **research overview** page with structured analysis
- Collect and store **PDFs and case studies** found across the web

Your team sees everything in one collaborative interface. Agents write to the same database your team reads from, with no export, no copy-paste, and no context switching.

---


## Security & Governance

Second is designed for enterprise teams that need complete control over what agents can access and do.

**The platform follows a zero-trust architecture for agents.** No agent is granted implicit access to anything. Every capability, every data collection, every integration must be explicitly declared, scoped, and approved before an agent can act.


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

---

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

---

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

---

<br>

## What You Can Build

Second excels at apps where teams collaborate with agents on long-running, asynchronous workflows:

<br>

| Use Case | What Agents Do |
|:---|:---|
| **Competitor intelligence** | Monitor competitors, aggregate news, alert on pricing changes, collect case studies |
| **Lead enrichment pipelines** | Research and qualify leads while your team reviews and acts |
| **Content operations** | Draft, research, and organize while editors review in real-time |
| **Customer success dashboards** | Pull data from CRMs and support tools; teams act on insights |
| **Internal knowledge bases** | Continuously index and organize docs; teams search and annotate |
| **Compliance monitoring** | Scan for policy violations; approvers review and resolve |

<br>

The flexibility is unlimited. If your workflow involves humans and agents collaborating on structured data, Second handles the infrastructure so you can focus on the work.

<br>

---

<br>

## Platform Support

| Platform | Status |
|:---|:---|
| Apple Silicon (M1–M4) | **Available** |
| Intel Mac | Coming soon |
| Linux (x86_64) | Coming soon |
| Windows (WSL2) | Coming soon |

Source development (Docker mode) works on any platform with Docker Desktop.

<br>

---

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

---

<p align="center">
  <sub>Second is licensed under the <a href="LICENSE">Apache License 2.0</a>.</sub>
</p>
