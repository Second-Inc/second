# Second CLI

Run Second locally with one command.

```bash
npx --yes @second-inc/cli
```

Second is an open-source, self-hostable workspace for building secure internal tools where humans and agents work together.

## What is Second?

Second lets every team ship custom internal interfaces for managing agents and collaborating with them on async work.

It is a single, governed workspace. Instead of adapting your workflows to pre-built agent management interfaces, Second gives you the primitives to build the exact internal interfaces your team needs. Prompt an app, and Second generates a full internal interface with a real-time database, permissions, and audit logs out of the box.

Every app built on Second treats agents as first-class citizens. Agents read and write to the same real-time database your team is working on, get scoped and secure tools inside the apps you build, and work alongside humans on the same custom interfaces.

Think of it as an internal, secure, collaborative Lovable that runs on-prem and is purpose-built for long-running, asynchronous work with agents.

## Quick Start

```bash
npx --yes @second-inc/cli
```

The local CLI currently supports Apple Silicon Macs.

| Platform | Status |
|:---|:---|
| Apple Silicon Mac (M1-M4) | Available now |
| Intel Mac | Coming soon |
| Linux | Coming soon |
| Windows / WSL2 | Coming soon |

## CLI Commands

```bash
npx --yes @second-inc/cli                         # Start Second
npx --yes @second-inc/cli stop                    # Stop all services
npx --yes @second-inc/cli reset                   # Stop and delete all data
npx --yes @second-inc/cli --port 4000             # Custom port
npx --yes @second-inc/cli --disable-telemetry     # Disable analytics
```

## Bring Your Agent

Second lets you bring your own agent harness and switch runtimes and models per message, per app, without restarting conversations.

Current agent runtime support:

| Runtime | Status |
|:---|:---|
| Claude Code | Available |
| Codex | Available |
| OpenCode | Coming soon |

## Why Second?

Every team is hitting the same wall: you build a v1 of an internal tool with Codex, Claude, or Lovable. Then comes the "OK, now what?" phase:

- How do you deploy and share it safely?
- How do you make your software accessible for agents?
- What about real-time collaboration, RBAC, agent RBAC, secure integrations, audit logs, and cost management?

Second is the infrastructure for teams that want to build internal software with agents and still keep governance, security, and collaboration under control.

## Agent-Native Software

Every app treats agents as first-class citizens:

| Capability | How It Works |
|---|---|
| Shared real-time database | Agents read and write to the same live database as your team, with optimistic updates, change streams, and instant sync. |
| Scoped and secure tools | Each agent gets precisely the tools it needs through `agents.json`, nothing more. |
| Collaborative UI | Agents work alongside your team on the same custom-built interface. |
| Multi-agent orchestration | Run multiple specialized agents per app: one for research, one for alerts, one for enrichment. |
| Long-running async work | Agents run scheduled jobs, periodic research, and alerting, not just chat. |
| Live data persistence | MongoDB-backed collections with Change Streams; data survives browser close, agent restarts, and worker churn. |

## Security and Governance

Second is designed for enterprise teams that need control over what agents can access and do.

The platform follows a zero-trust architecture for agents. No agent gets implicit access to anything. Every capability, data collection, and integration must be explicitly declared, scoped, and approved before an agent can act.

| Feature | Description |
|:---|:---|
| Agent access control | Capabilities are defined in `agents.json`: approved collections, allowed tools, integration scopes. Changes require admin approval through cryptographic hash verification. |
| Role-based access control | Workspace roles and app-level permissions control who can create, review, publish, and collaborate. |
| Approval flows | Draft, review, and publish lifecycle for apps, agent configs, and integration grants. |
| Domain-locked tools | Custom HTTP tools are locked to declared domains. Private IP access is rejected. |
| Audit logs | App changes, agent tool calls, data writes, access denials, and integration usage are recorded. |
| Workspace isolation | Every query is scoped to `workspaceId`; cross-workspace access returns `404` to prevent resource enumeration. |
| Subprocess hardening | Infrastructure secrets are scrubbed from agent subprocess environments. |

## Self-Hosting

Second can run locally through this CLI, from source with Docker Compose, or in production on your own infrastructure.

| Method | Use Case |
|:---|:---|
| `npx --yes @second-inc/cli` | Local / single-machine on Apple Silicon |
| Docker Compose from source | Development and self-hosted evaluation |
| Kubernetes | Production on-prem or cloud deployment |

Production deployments typically require MongoDB, Redis, an auth provider, HTTPS, and agent runtime credentials.

## Useful Links

- Docs: https://docs.second.so
- Repository: https://github.com/Second-Inc/second
- License: Apache-2.0
