import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const ADD_INTEGRATIONS_SKILL = `---
name: add-integrations
description: Use this skill whenever you need to include, edit, add, or review integrations, custom API tools, app-callable integration actions, integration-setup.json, setup instructions, permissions, scopes, or named integration secrets. Read it before researching provider setup or API details.
---

# Add Integrations

Use this skill for every integration change, including adding custom tools, app-callable integration actions, editing a tool endpoint, adding scopes, changing named secrets, or writing setup instructions. Read it before researching the provider so the research follows Second's integration rules.

## First checks

1. Read the main prompt's \`Important: ENV: ...\` value and choose the setup flow that matches the runtime environment.
2. Call \`mcp__second__list_app_integration_keys\` before deciding whether this app's integration keys need setup.
3. Verify the current provider setup flow in official docs or official settings pages. Use direct official links whenever possible.
4. If requirements changed, rewrite \`integration-setup.json\` with the complete current requirements for this app and call \`mcp__second__present_integration_setup\` again.
5. For Google Calendar integrations, also read the \`google-calendar-integration\` skill when available and follow its setup, favicon, and date-handling rules.
6. For Slack integrations, also read the \`slack-integration\` skill when available and follow its scopes, channel membership, and setup rules.
7. For Explorium integrations, also read the \`explorium-integration\` skill when available and follow its match-then-enrich workflow, \`api_key\` header, placeholder, and setup rules.

## Integration completeness

Research the whole user-facing workflow, not only the first provider endpoint. Understanding an integration means understanding its **full access model** — having the right API scope does not guarantee access. Many providers have secondary access gates beyond API permissions. For example:

- **Slack**: A bot with \`channels:history\` scope cannot read channel messages unless it has joined the channel. Include \`channels:join\` scope, a join tool, and enforce join-before-read in the agent prompt — otherwise every \`conversations.history\` call silently returns \`not_in_channel\`.

Important: Extrapolate this to every integration: when setting up tools, scopes, and setup instructions, ask "what else must be true for this API call to succeed beyond having the right scope?" Research the provider's full access chain — membership, invitation, installation, delegation — and build all prerequisites into tools, scopes, agent prompt, and setup instructions from the start. Obviously do not over-engineer or add irrelevant steps, but do not miss critical hidden prerequisites either.

Important: If fetched data contains opaque IDs, handles, foreign keys, status codes, or other values that would be unclear in the UI, include the companion lookups, scopes, and mock data needed to resolve them into useful labels. For example, if a Slack tool fetches channel messages for display, it should also fetch the relevant user/profile names so the app does not show a feed of raw member IDs.

## Custom tool rules

- Use top-level \`appTools\` in \`agents.json\` when app code should call a deterministic provider API directly with \`callIntegrationTool\`. Use normal \`agents[].tools\` only when an AI agent needs the tool for reasoning, generation, or autonomous work.
- Top-level \`appTools\` use the same \`type: "custom"\`, \`integration\`, \`endpoint\`, \`mockData\`, static secret, OAuth, public API, \`domain\`, and \`keySlug\` rules as agent custom tools. If an app action and an agent tool use the same provider credentials, reuse the same \`domain\` + \`keySlug\` and put the complete union of requirements in \`integration-setup.json\`.
- Define the real HTTP request inside each custom tool's \`endpoint\`. Do not put the API request only in prose or only in the agent system prompt.
- For static API-key or bot-token integrations, use named secret placeholders like \`{{secrets.SERVICE_API_KEY}}\`; the secret name must match \`integration-setup.json\`.
- For OAuth integrations, declare \`integration.auth.type: "oauth2"\` in the custom tool and in \`integration-setup.json\`. Include \`providerKey\`, \`identity: "triggering_user"\`, official \`authorizationUrl\`, official \`tokenUrl\`, exact \`scopes\`, and any provider-required authorization params such as Google's \`access_type: "offline"\`. Do not include \`{{oauth.access_token}}\`, \`{{access_token}}\`, \`{{token}}\`, \`{{secrets.*}}\`, or an \`Authorization\` header; Second injects the access token server-side.
- For official public APIs that require no API key, OAuth client, or token, use a public unauthenticated custom tool. Keep \`integration.name\`, \`integration.domain\`, \`endpoint\`, and realistic \`mockData\`, but omit \`integration.auth\`, omit \`{{secrets.*}}\`, omit \`Authorization\` headers, and do not create \`integration-setup.json\` for that provider. Example: arXiv search can call \`https://export.arxiv.org/api/query\` with query input placeholders and no setup.
- For providers that need setup, give each provider request a stable app-scoped \`keySlug\` in both \`agents.json\` custom tools and \`integration-setup.json\`. Use \`default\` when the app only needs one key for that provider.
- Another app's configured credential does not satisfy this app. Only skip setup when \`mcp__second__list_app_integration_keys\` reports this app has a configured grant for the same provider, keySlug, auth mode, required permissions/scopes, and named secrets or OAuth provider config.
- Fetch the broad provider data the user asked for. Do not quietly filter to "my", "assigned to me", one team, one project, or one channel unless the user explicitly asked for that narrower slice.
- Use specific endpoints for lookups, searches, and per-record actions. For list/sync/feed apps, broad collection endpoints are correct when that matches the request.
- Keep mock data varied, realistic, and shaped like the provider's real response.

## Bounded response design

- App-callable integration actions return data to app code instead of an agent, so deterministic pagination and app-side grouping are preferred for bulk dashboards. Each individual action response is still bounded; do not design one unbounded request for thousands of records.
- Keep custom tool responses small enough for the agent to read directly. The agent receives the provider response before it can filter fields or write app data. \`responseSchema\` is descriptive only; it does not trim, project, or reshape runtime output.
- For search, content, crawl, enrichment, and RAG APIs, avoid unbounded full document/page body fields in multi-result tools. Prefer metadata, summaries, highlights, snippets, or explicit character limits.

IMPORTANT: TAKE THE FOLLOWING PRINCIPALS, AND APPLY TO THE TOOLS YOUR ARE BUILDING, IF APPLICABLE:
- If the app needs full text, split the workflow into two tools on the same agent: one compact search/list tool, then one bounded single-record contents/details tool.
- Exa example: do not use a multi-result Exa search body like \`"contents": { "text": true, "highlights": true }\` for result-card apps. Exa \`text: true\` returns full page text for each result, so 10 results can overflow the agent's tool output. For result cards, prefer \`"contents": { "highlights": { "numSentences": 2, "highlightsPerUrl": 1 } }\`. If short text is genuinely needed, use a cap such as \`"contents": { "text": { "maxCharacters": 1000 }, "highlights": true }\`.
- Exa two-tool pattern: \`exa_search\` should POST to \`https://api.exa.ai/search\` with \`query\`, \`numResults\`, and highlights/summaries only, returning compact result metadata. \`exa_get_contents\` should POST to \`https://api.exa.ai/contents\` with one URL or ID from a previous search result and \`"text": { "maxCharacters": 3000 }\` or another deliberate cap. In the agent system prompt, instruct the agent to call \`exa_search\` first and call \`exa_get_contents\` only for the specific selected/top URLs that need deeper text.

## Setup instruction style

- Keep instructions very short, direct, and true. Usually 2-4 steps is enough.
- Prefer a direct link to the exact settings page over navigation like "click your avatar, then settings".
- Use markdown links inside step descriptions when helpful.
- For direct provider/settings links, use this label format: \`[Provider | Settings section](https://...)\`. The UI renders this as a compact chip with the provider icon, the provider name, the settings section in muted text, and an external-link icon. Do not write the \`|\` outside the markdown link label.
- Example direct settings link: \`[Linear | Security & access](https://linear.app/settings/account/security)\`.
- Pasting the value into Second can be one of the steps, but keep it as one short final step.
- Do not add internal implementation notes, API schemas, broad explanations, or developer-only caveats.
- Do not pad the steps. If a direct link can replace two navigation steps, use the direct link.
- Use exact permission/scope names and exact secret names.
- For OAuth setup, do not write generic steps like "Create OAuth client". Include concrete provider-console links, the exact app/client type to create, where to add Second's redirect URI, the exact scopes to add, and the final Second action to paste client ID/client secret and connect the account.
- Group permissions by capability and risk:
  - \`Read-only\`: read, list, search, history, metadata, and user/profile lookup scopes.
  - \`Write\`: create, update, send, comment, upload, or mutate scopes.
  - \`Delete/Admin\`: delete, admin, workspace settings, permission management, or other destructive/high-risk scopes.

Good setup steps:

1. Go to [Linear | Security & access](https://linear.app/settings/account/security).
2. Click New API Key and name it "Second App".
3. Paste the key into this app's Linear integration key in Second.

Very good Google Calendar OAuth setup steps. Use this exact style for Google Calendar and do not change this example unless the official Google console flow changes. Second renders a copyable Redirect URI field directly below these setup steps in the same setup dialog, so refer to that field as "the Redirect URI shown below" instead of inventing or repeating the URI in prose:

1. Create or open a Google Cloud project: Go to [Google Cloud Console | New project](https://console.cloud.google.com/projectcreate) and create a new project or select an existing one.
2. Enable the Google Calendar API: In your project, go to [Google Cloud Console | Enable APIs](https://console.cloud.google.com/apis/library/calendar-json.googleapis.com) and click Enable for the Google Calendar API.
3. Create an OAuth 2.0 client: Go to [Google Cloud Console | Credentials](https://console.cloud.google.com/apis/credentials), click Create Credentials → OAuth client ID, choose Web application, click Add URI, then copy the Redirect URI shown below in Second and paste it there.
4. Paste credentials into Second: Copy the Client ID and Client Secret from the created OAuth client and paste them into this app's Google Calendar integration in Second.

Avoid this style:

1. Open Linear.
2. Click your avatar.
3. Go to Settings.
4. Search for API.
5. Create a key.
6. Paste it in Second.

## Environment choices

- \`ENV: local\`: prefer the simplest developer setup that works locally. Personal API keys are acceptable when the provider supports them.
- \`ENV: production\`: prefer team, workspace, admin-managed, bot/app tokens, service accounts, or shared API keys when the app is shared.
- OAuth is supported for user-scoped integrations. Use it when two users in the same workspace should see different provider data, such as Gmail, Google Calendar, Outlook, Zoom meetings, personal files, user DMs, or "my notifications".
- There is no fixed OAuth provider registry. Discover the provider's official authorization URL, token URL, scopes, and API endpoint from official docs, then write them into \`agents.json\` and \`integration-setup.json\` for admin approval.
- Do not use Gmail API keys, app passwords, pasted mailbox passwords, or one-hour access tokens as setup secrets. Gmail and Calendar need OAuth connected accounts.
- If a provider only supports a personal key in the current platform, say exactly what is needed and keep the setup concise.

## Google OAuth consent screen (Internal vs External)

When writing setup instructions for any Google OAuth integration (Gmail, Calendar, Drive, etc.), you must handle the consent screen type correctly. Getting this wrong will silently block the user from connecting.

**Rules:**
- **External** is usually for personal \`@gmail.com\` accounts that can ONLY use External — the Internal option does not even appear for them.
- **Internal** is only available when the Google Cloud project belongs to a Google Workspace organization. It is simpler (no test-user step, no token expiration quirks), but it only works for users within that Workspace org.
- Check the current user email and check whether they are using @gmail.com or: a company email that may be on Google Workspace. If they have a Google Workspace email, ask them to confirm whether their email is managed through Google Workspace (or: allow them to tell I don't know). If they have a personal @gmail.com email or are unsure, recommend External.
- When \`ENV: production\`, the user is more likely on a Google Workspace domain. In that case, ask the user to check their email type and domain, and recommend **Internal** if they have a Google Workspace email. If they have a personal \`@gmail.com\` email or are unsure, recommend **External**.

**Test user step is mandatory for External:**
When the user chooses External, Google puts the app in "Testing" mode by default. In this mode:
  - Only explicitly added test users can authorize. Without this step, the OAuth flow fails.
  - Tokens expire after 7 days, requiring reconnection.
  - Maximum 100 test users.

Therefore, when instructions include External, always include a step to add the user's Google email as a test user. Do not make this step conditional or easy to skip — it is required for External to work.

**Deciding which to recommend:**
1. Check the current user's email from onboarded context.
2. If the email is \`@gmail.com\` → recommend **External** and include the test user step as mandatory.
3. If the email is a custom domain → ask the user: "Is your \`@domain.com\` email managed through Google Workspace? If yes, choose Internal (simpler). If not or unsure, choose External." Accept "I don't know" as an answer — in that case, default to External.
4. In setup instructions, always write the **External + test user** path as the primary flow, with a brief note that Google Workspace users can choose Internal instead (and skip the test user step).

**Correct consent screen setup steps (use this pattern for all Google OAuth integrations):**
1. Configure the OAuth consent screen: Go to [Google Cloud Console | OAuth consent screen](https://console.cloud.google.com/apis/credentials/consent). Choose **External** (or **Internal** if your Google account is part of a Google Workspace organization). Fill in the app name and your email, then add the required scope(s).
2. Add yourself as a test user: On the OAuth consent screen under **Test users**, click **Add users** and enter the Google email you will connect. *(Google Workspace users who chose Internal can skip this step.)*

These two steps must appear before the "Create an OAuth 2.0 client" step in every Google OAuth setup flow.

## Google Calendar

- Use OAuth with \`identity: "triggering_user"\`; Google Calendar is user-specific.
- Use the official Google authorization URL \`https://accounts.google.com/o/oauth2/v2/auth\` and token URL \`https://oauth2.googleapis.com/token\`.
- For a read-only events viewer, prefer scope \`https://www.googleapis.com/auth/calendar.events.readonly\`.
- Use the Google Calendar icon URL \`https://upload.wikimedia.org/wikipedia/commons/thumb/a/a5/Google_Calendar_icon_%282020%29.svg/250px-Google_Calendar_icon_%282020%29.svg.png?download\` for the integration favicon/icon when possible.
- Calendar event dates are returned as \`start.dateTime\` for timed events or \`start.date\` for all-day events. When the agent writes events to app data, preserve the Google shape when possible. The app UI should still accept either the Google object shape or a flattened string.
- In app code, parse all-day \`YYYY-MM-DD\` dates with \`new Date(year, month - 1, day)\`, not \`new Date("YYYY-MM-DD")\`, so the date does not shift across timezones.
- Do not group by \`date.toDateString()\` and later parse that string back. Use a stable local \`YYYY-MM-DD\` key and parse it by splitting year/month/day.

## Linear

- For \`ENV: local\`, request a personal Linear API key.
- Verify with the official docs: https://linear.app/docs/api-and-webhooks
- Direct personal API key creation to \`[Linear | Security & access](https://linear.app/settings/account/security)\`.
- Do not use \`/settings/api\` for local personal API keys.
- Use secret name \`LINEAR_API_KEY\`.
- Use Linear GraphQL at \`https://api.linear.app/graphql\` with an \`Authorization\` header using \`{{secrets.LINEAR_API_KEY}}\`.
- Unless the user explicitly asks for only their own issues, do not filter Linear issues to the viewer or assignee. Fetch all relevant issues for the requested team, project, workspace, or query.
`;

const GOOGLE_CALENDAR_INTEGRATION_SKILL = `---
name: google-calendar-integration
description: Use this skill when building Google Calendar integrations, Google Calendar OAuth setup instructions, Google Calendar event viewers, or UI code that renders Google Calendar event dates.
---

# Google Calendar Integration

Use this with the add-integrations skill for Google Calendar apps.

## Setup instructions

Use this exact setup style for Google Calendar unless Google's official console flow changes. Second renders a copyable Redirect URI field directly below these setup steps in the same setup dialog, so refer to that field as "the Redirect URI shown below" instead of inventing or repeating the URI in prose:

1. Create or open a Google Cloud project: Go to [Google Cloud Console | New project](https://console.cloud.google.com/projectcreate) and create a new project or select an existing one.
2. Enable the Google Calendar API: In your project, go to [Google Cloud Console | Enable APIs](https://console.cloud.google.com/apis/library/calendar-json.googleapis.com) and click Enable for the Google Calendar API.
3. Create an OAuth 2.0 client: Go to [Google Cloud Console | Credentials](https://console.cloud.google.com/apis/credentials), click Create Credentials → OAuth client ID, choose Web application, click Add URI, then copy the Redirect URI shown below in Second and paste it there.
4. Paste credentials into Second: Copy the Client ID and Client Secret from the created OAuth client and paste them into this app's Google Calendar integration in Second.

Use this icon URL for Google Calendar:
https://upload.wikimedia.org/wikipedia/commons/thumb/a/a5/Google_Calendar_icon_%282020%29.svg/250px-Google_Calendar_icon_%282020%29.svg.png?download

## Date handling

Google Calendar events may have timed dates as { dateTime } or all-day dates as { date }. App data may also contain flattened strings if the agent writes simplified records.

When building the UI:
- Accept start/end as either an object or string.
- Parse date-only YYYY-MM-DD values with new Date(year, month - 1, day), not new Date("YYYY-MM-DD").
- Use stable local YYYY-MM-DD keys for grouping.
- Do not group with date.toDateString() and parse it back later.
`;

const SLACK_INTEGRATION_SKILL = `---
name: slack-integration
description: Use this skill when building Slack integrations that read channel messages, fetch channel history, create Slack digest or summary apps, or set up Slack bot tokens with correct scopes.
---

# Slack Integration

Use this with the add-integrations skill for Slack apps.

## Critical: channel membership requirement

Slack bots are NOT members of channels by default. The \`conversations.history\` API returns a \`not_in_channel\` error if the bot has not joined the channel first. This is the single most common failure when building Slack reader apps.

**Every Slack app that reads channel messages must:**

1. Include the \`channels:join\` bot scope alongside read scopes.
2. Include a \`slack_join_channel\` custom tool that calls \`POST https://slack.com/api/conversations.join\` with body \`{"channel": "{{channel}}"}\`.
3. Enforce join-before-read in the agent system prompt with a critical rule section. The agent must call \`slack_join_channel\` for each channel BEFORE calling \`slack_conversations_history\`. Process channels sequentially: join → read history → process → next channel. Do not batch all joins or all history reads together.

Example critical rule for the agent system prompt:

  === CRITICAL RULE ===
  You MUST call slack_join_channel for EVERY channel BEFORE calling
  slack_conversations_history for that channel. The bot is NOT a member of any
  channel by default. If you skip this step, conversations.history will return
  'not_in_channel' and you will get zero messages.

## Scopes

Standard bot token scopes for a Slack reader app:

- **Read-only**: \`channels:read\`, \`channels:history\`, \`users:read\`
- **Write** (required even for reading channel history): \`channels:join\`
- **Write** (for posting messages): \`chat:write\`

\`channels:join\` is categorized as a write scope but is required even for read-only channel history apps. Always include it when the app reads messages.

## Setup instructions

- Use a Bot User OAuth Token (starts with \`xoxb-\`).
- Use secret name \`SLACK_BOT_TOKEN\`.
- Direct the user to [Slack | API apps](https://api.slack.com/apps).
- After adding new scopes, instruct the user to click **Reinstall to Workspace** — Slack requires reinstallation to apply scope changes to the bot token.

Setup instruction example for a Slack reader app (adjust scopes as needed):

1. Go to [Slack | API apps](https://api.slack.com/apps) and create a new app (From scratch) or open the existing app you want Second to use.
2. Under **OAuth & Permissions → Bot Token Scopes**, add: \`channels:read\`, \`channels:history\`, \`channels:join\`, \`users:read\`.
3. Click **Install to Workspace** - where Workspace is your workspace name. If you already installed the app before adding scopes, click **Reinstall to Workspace** to apply the new scopes.
4. Copy the **Bot User OAuth Token** (starts with \`xoxb-\`) and paste it into this app's Slack integration in Second.

Permission groups:
- **Read-only**: \`channels:read\`, \`channels:history\`, \`users:read\` — list channels, read message history, resolve user names.
- **Write**: \`channels:join\` — join public channels to read their history. \`chat:write\` — post messages (only if the app sends messages).

## User name resolution

Slack messages reference users by opaque IDs like \`<@U12345>\`. Any Slack app that displays messages must:

1. Include a \`slack_users_list\` tool calling \`GET https://slack.com/api/users.list\` with the \`users:read\` scope.
2. Instruct the agent to build a user ID → display name map and resolve all \`<@USERID>\` mentions before writing data to the app's database.

## Private channels and DMs

- For private channels, use \`groups:read\`, \`groups:history\` scopes instead.
- For DMs/IMs, use \`im:read\`, \`im:history\` scopes.
- The membership requirement applies to private channels too — the bot must be invited by a channel member.
`;

const EXPLORIUM_INTEGRATION_SKILL = `---
name: explorium-integration
description: Use this skill when building integrations that use Explorium for prospect matching, contact enrichment, professional profile enrichment, or business firmographics.
---

# Explorium Integration

- Use this skill when building integrations that use Explorium for prospect matching, contact enrichment, professional profile enrichment business firmographics, etc.

- Read it before designing Explorium custom tools, writing agent prompts, or creating setup instructions.

- Crucial: The information here is accurate, but it is guidance, not a fixed template. Adapt it to the user's actual request and use case - you definetly might need to research more online!

## API Architecture — Match → Enrich (Two-Step)

Explorium uses a two-step workflow: first MATCH to get an entity ID, then ENRICH using that ID. Never try to enrich without matching first.

- Prospects: \`POST /v1/prospects/match\` → returns \`prospect_id\` → use in \`/v1/prospects/profiles/enrich\` and \`/v1/prospects/contacts_information/enrich\`
- Businesses: \`POST /v1/businesses/match\` → returns \`business_id\` → use in \`/v1/businesses/firmographics/enrich\`

## Authentication

- Method: API key in a custom header (NOT Authorization Bearer)
- Header name: \`api_key\` (lowercase, with underscore)
- Secret name: \`EXPLORIUM_API_KEY\`
- Example header: \`"api_key": "{{secrets.EXPLORIUM_API_KEY}}"\`
- Do NOT use \`Authorization: Bearer\`. Explorium uses its own \`api_key\` header.

## Critical: Placeholder Fields Must Always Be Passed

The Second runtime requires ALL \`{{placeholder}}\` values referenced in an endpoint body to be provided by the agent. If the agent omits a field, the call fails with \`"Missing tool input value(s): <field_name>"\`.

Rule: If a tool's endpoint body contains multiple optional placeholders, the tool description MUST instruct the agent to always pass ALL fields, using empty string \`""\` for unknowns.

Example tool description:

"You MUST always pass ALL four fields: full_name, company_name, email, linkedin. Use empty string \`""\` for any field you don't have. Example: {"full_name": "John Smith", "company_name": "Acme Inc", "email": "", "linkedin": ""}"

Example system prompt reinforcement:

CRITICAL: When calling explorium_match_prospect, you must ALWAYS pass ALL four fields (full_name, company_name, email, linkedin) — use empty string \`""\` for any field you don't have. Never omit fields.

## Available Endpoints

### 1. Match Prospect

- URL: \`POST https://api.explorium.ai/v1/prospects/match\`
- Body:

\`\`\`json
{
  "prospects_to_match": [
    {
      "full_name": "{{full_name}}",
      "company_name": "{{company_name}}",
      "email": "{{email}}",
      "linkedin": "{{linkedin}}"
    }
  ]
}
\`\`\`

- Returns: \`matched_prospects[].prospect_id\` (40-char hex string)
- Miss indicator: \`response_context.request_status === "miss"\` and \`total_matches === 0\`

### 2. Enrich Prospect Profile

- URL: \`POST https://api.explorium.ai/v1/prospects/profiles/enrich\`
- Body: \`{ "prospect_id": "{{prospect_id}}" }\`
- Returns: \`data.full_name\`, \`data.job_title\`, \`data.job_seniority_level\`, \`data.company_name\`, \`data.company_website\`, \`data.linkedin\`, \`data.city\`, \`data.country_name\`, \`data.experience[]\`, \`data.education[]\`, \`data.skills[]\`

### 3. Enrich Prospect Contacts (emails & phones)

- URL: \`POST https://api.explorium.ai/v1/prospects/contacts_information/enrich\`
- Body: \`{ "prospect_id": "{{prospect_id}}" }\`
- Returns: \`data.professions_email\`, \`data.professional_email_status\`, \`data.emails[]\` (each with email, type, status), \`data.mobile_phone\`, \`data.phone_numbers[]\`
- Important: This is a SEPARATE endpoint from profile enrichment. You must call BOTH to get complete data. The profile endpoint does NOT return email/phone.

### 4. Match Business

- URL: \`POST https://api.explorium.ai/v1/businesses/match\`
- Body:

\`\`\`json
{
  "businesses_to_match": [
    {
      "company_name": "{{company_name}}",
      "website": "{{website}}"
    }
  ]
}
\`\`\`

- Returns: \`matched_businesses[].business_id\`

### 5. Enrich Business Firmographics

- URL: \`POST https://api.explorium.ai/v1/businesses/firmographics/enrich\`
- Body: \`{ "business_id": "{{business_id}}" }\`
- Returns: \`data.name\`, \`data.business_description\`, \`data.website\`, \`data.linkedin_profile\`, \`data.country_name\`, \`data.city_name\`, \`data.naics_description\`, \`data.linkedin_industry_category\`, \`data.number_of_employees_range\`, \`data.yearly_revenue_range\`

## Agent Prompt Workflow Pattern

Always instruct the agent to follow this order:

0. Before matching, verify you have at least \`full_name\` + \`company_name\`. If \`company_name\` is missing but email is available, extract the domain as a company signal. If neither company nor email is available, set status to \`not_found\` and skip enrichment — a name-only match will fail.
1. Match prospect (get \`prospect_id\`)
2. Enrich profile (get title, LinkedIn, company info)
3. Enrich contacts (get emails, phones) — do NOT skip this
4. Optionally enrich business firmographics (get company size, industry, revenue)

## Mock Data Patterns

Mock data must include:

- Success case: \`response_context.request_status: "success"\` with populated data
- Another success case: Different person/company for variety
- Miss case: \`response_context.request_status: "miss"\` with \`data: null\` and \`entity_id: null\`

All mock responses include a \`response_context\` object:

\`\`\`json
{
  "response_context": {
    "correlation_id": "abc-123",
    "request_status": "success",
    "time_took_in_seconds": 1.2
  }
}
\`\`\`

## Integration Setup

- Domain: \`explorium.ai\`
- Key type: Static secret (API key)
- Secret name: \`EXPLORIUM_API_KEY\`
- Free tier: 100 credits, valid 90 days
- Signup: https://www.explorium.ai/signup
- Admin panel (for API key): https://admin.explorium.ai
- API docs: https://developers.explorium.ai/reference/introduction

Setup instruction style:

\`\`\`json
{
  "steps": [
    {
      "title": "Create an Explorium account",
      "description": "Go to [Explorium | Sign up](https://www.explorium.ai/signup) and create a free account. The free tier includes 100 credits valid for 90 days."
    },
    {
      "title": "Copy your API key",
      "description": "Once logged in, go to [Explorium | Admin Panel](https://admin.explorium.ai) and copy your API key from the dashboard."
    },
    {
      "title": "Paste the API key into Second",
      "description": "Copy the API key and paste it into this app's Explorium integration in Second."
    }
  ]
}
\`\`\`

## Permission Groups

Group by capability:

- Read-only: \`prospects/match\`, \`prospects/profiles/enrich\`, \`prospects/contacts_information/enrich\`, \`businesses/match\`, \`businesses/firmographics/enrich\`
- Write (if future use): any data push or update endpoints

## Common Pitfalls

1. Missing fields error: Agent omits optional fields → runtime rejects. Always require all fields with empty string fallback.
2. Skipping contacts endpoint: Profile enrichment does NOT return emails/phones. Must call contacts_information/enrich separately.
3. Using Authorization header: Explorium uses \`api_key\` header, not \`Authorization: Bearer\`.
4. Trying to enrich without matching: Always match first to get the entity ID. There is no "enrich by name" shortcut.
5. Expecting email from profile: The \`/profiles/enrich\` endpoint returns job title, experience, education — NOT contact details. For email/phone, you MUST use \`/contacts_information/enrich\`.
6. Name-only matching fails: Explorium almost never matches on \`full_name\` alone — it needs \`full_name\` + \`company_name\` at minimum for a reliable match. If the lead has no company, the match will likely return a miss. The agent system prompt should instruct: "If the lead has no company_name, try to infer it from their email domain or other context before calling match. Do not attempt a match with only full_name — it will almost certainly return a miss."
`;

export function ensureBuilderSkills(workingDirectory: string): void {
  const skills = [
    { name: "add-integrations", body: ADD_INTEGRATIONS_SKILL },
    { name: "google-calendar-integration", body: GOOGLE_CALENDAR_INTEGRATION_SKILL },
    { name: "slack-integration", body: SLACK_INTEGRATION_SKILL },
    { name: "explorium-integration", body: EXPLORIUM_INTEGRATION_SKILL },
  ];

  for (const skill of skills) {
    const skillDir = join(workingDirectory, ".claude", "skills", skill.name);
    mkdirSync(skillDir, { recursive: true });
    writeFileSync(join(skillDir, "SKILL.md"), skill.body, "utf-8");
  }
}

export type RuntimeSkill = {
  slug: string;
  displayName: string;
  description: string;
  bodyMarkdown: string;
  revisionNumber: number;
  revisionHash: string;
};

function safeSkillSlug(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 56) || "skill";
}

function yamlString(value: string): string {
  return JSON.stringify(value.replace(/\r\n?/g, "\n"));
}

function runtimeSkillMarkdown(skill: RuntimeSkill): string {
  const slug = safeSkillSlug(skill.slug);
  return [
    "---",
    `name: ${slug}`,
    `description: ${yamlString(skill.description || skill.displayName)}`,
    "---",
    "",
    `# ${skill.displayName}`,
    "",
    `Revision: ${skill.revisionNumber}`,
    `Hash: ${skill.revisionHash}`,
    "",
    skill.bodyMarkdown.trim(),
    "",
  ].join("\n");
}

function clearGeneratedSkills(root: string): void {
  if (!existsSync(root)) return;
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory() || !entry.name.startsWith("second-")) continue;
    rmSync(join(root, entry.name), { recursive: true, force: true });
  }
}

export function ensureRuntimeSkills(
  workingDirectory: string,
  skills: RuntimeSkill[],
): void {
  const targets = [
    join(workingDirectory, ".claude", "skills"),
    join(workingDirectory, ".agents", "skills"),
  ];

  for (const target of targets) {
    mkdirSync(target, { recursive: true });
    clearGeneratedSkills(target);
  }

  for (const skill of skills) {
    const dirName = `second-${safeSkillSlug(skill.slug)}`;
    const content = runtimeSkillMarkdown(skill);
    for (const target of targets) {
      const skillDir = join(target, dirName);
      mkdirSync(skillDir, { recursive: true });
      writeFileSync(join(skillDir, "SKILL.md"), content, "utf-8");
    }
  }
}
