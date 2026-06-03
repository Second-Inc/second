---
name: second-app-builder
description: Build and iterate local Second headless apps from Claude or Codex. Use when the user wants a visual GUI around a task, a local Second app, headless Second, app agents, agents.json, integration setup, or a governed local app preview.
---

# Second App Builder

Use Second as the local visual app runtime while the user keeps talking to you in their own Claude or Codex CLI.

## Core Loop

1. Start or reuse headless Second:

   ```bash
   npx --yes @second-inc/cli headless start --json
   ```

   Use `--name "<app name>"` for a new task and `--new` when the user clearly wants a separate app.

2. Parse the JSON response. It includes `appId`, `workspaceId`, `appDir`, `appUrl`, `launchUrl`, `previewCommand`, and `integrationsUrl`.

3. Save or update `.second-app.json` in the user's current project so later turns can keep improving the same app:

   ```json
   {
     "appId": "...",
     "appDir": "...",
     "appUrl": "..."
   }
   ```

4. Edit only the generated app workspace under `appDir`. Build the app as a Vite + React + TypeScript app. Use `src/lib/second-sdk.ts` for Second app data, app agents, and integration tools.

5. After meaningful edits, run:

   ```bash
   npx --yes @second-inc/cli headless preview --app <appId> --json
   ```

6. If preview returns build errors, fix files in `appDir` and rerun preview. Do not start a separate dev server.

7. Give the user the `appUrl`. If the browser has not been launched yet, use `launchUrl` or run:

   ```bash
   npx --yes @second-inc/cli headless open --app <appId>
   ```

## Continuing An Existing App

When the user asks to improve or change the app:

1. Read `.second-app.json` if it exists.
2. Run:

   ```bash
   npx --yes @second-inc/cli headless status --app <appId> --json
   ```

3. Edit files in `appDir`.
4. Run headless preview again.
5. Report the updated `appUrl`.

## App Agents

Create `agents.json` in `appDir` when the app needs app agents or app-callable backend actions.

Headless local preview validates and approves `agents.json` automatically through Second's local-only governance path. Do not ask the user to click Approve Agents in headless mode.

Keep `agents.json` minimal and explicit. Use mock data for unconfigured integrations. Do not put secrets, tokens, cookies, headers, or private credentials in `agents.json`.

## Integrations

Create `integration-setup.json` in `appDir` only when the app needs user-configured providers.

After preview, inspect the `integrations` object in the JSON output. If any item has `needsSetup: true`, tell the user to open the returned `integrations.url` or `integrationsUrl`. Do not ask for secret values in chat, and do not write secrets into files.

## Boundaries

- Talk to the user in the current Claude/Codex conversation; do not use Second's builder chat.
- Use the one local Second runtime and app-specific `appId`/`appUrl`; do not create one port per app.
- Edit only `appDir` and the local `.second-app.json` pointer unless the user explicitly asks for repo changes.
- Never edit `~/.second/secrets`, runtime state, Mongo/Redis files, or Second infrastructure files.
- Never expose local control tokens, internal API tokens, OAuth tokens, cookies, headers, or integration secret values.
