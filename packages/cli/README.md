# Second CLI

The factory for custom internal software, purpose-built for human2agent work.

Run Second locally with one command:

```bash
npx --yes @second-inc/cli
```

## What is Second?

Second is a factory for shipping internal software built for human-agent collaboration.

Most platforms were not built for deep, multiplayer, asynchronous work with AI agents. They either treat agents as an afterthought bolted onto existing tools, or they're too opinionated and end up not fitting how your team actually works. Generally, multiplayer human-agent work is where coordination gets hard and things start to break.

**Second solves that:** imagine an on-prem, secure Lovable for building complete internal software (e.g. competitor research, lead enrichment, various pipelines) **that treats agents as first-class citizens:** agents read and write to the same real-time DB as your human team does, get dynamically generated, scoped tools to do the work inside the apps you've built - and most importantly work alongside your human team.

Second is open-source, self-hosted, and bring your own agent.

## Quick Start

```bash
npx --yes @second-inc/cli
```

The local CLI currently supports Apple Silicon Macs and Linux x64, including Windows via WSL2.

| Platform | Status |
|:---|:---|
| Apple Silicon Mac (M1-M5) | Available now |
| Linux x64 / Windows via WSL2 | Experimental |
| Intel Mac | Coming soon |
| Native Windows | Coming soon |

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

Every app you build in Second gets a real-time DB, audit logs, RBAC, agent RBAC, and governance tools built into the workspace.

Companies like Ramp and Deel have already figured out that teams are building amazing things internally with Claude, Codex, or Lovable, but most of these projects never reach production because of various reasons: security, integrations, governance, safe deployments, maintenance, agent access control, and so on.

To solve this, they built internal platforms for themselves. Second lets every organization have that.

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

Second is designed for enterprise teams that need control over what humans and agents can access and do.

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

Second can run locally through this CLI or in production on your own infrastructure.

For full environment setup, see the self-hosting docs: https://docs.second.so/self-hosting

## Useful Links

- Docs: https://docs.second.so
- Repository: https://github.com/Second-Inc/second
- License: Apache-2.0
