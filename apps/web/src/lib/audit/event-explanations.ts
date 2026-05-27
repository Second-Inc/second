import type {
  AuditEventCategory,
  AuditSourceKind,
  AuditTargetType,
} from "@/lib/db/types";

export type AuditEventExplanationScope = "OSS v1" | "Enterprise later";

export type AuditEventExplanation = {
  area: string;
  events: string[];
  category: AuditEventCategory;
  source: AuditSourceKind;
  actor: string;
  target: AuditTargetType | string;
  canAnswer: string;
  notLogged: string;
  scope: AuditEventExplanationScope;
};

export const AUDIT_EVENT_EXPLANATIONS: AuditEventExplanation[] = [
  {
    area: "App creation and builder runs",
    events: [
      "app.created",
      "builder_run.created",
      "builder_run.started",
      "builder_run.completed",
      "builder_run.failed",
      "builder_run.claim_rejected",
      "builder_run.stale_stream_recovered",
      "builder_run.stopped",
      "builder_message.submitted",
    ],
    category: "apps",
    source: "web_server",
    actor: "user",
    target: "run",
    canAnswer:
      "Who started a build, when the builder run started, whether it completed or failed, and which app/run IDs are involved.",
    notLogged:
      "Prompt text, assistant text, model reasoning, full tool inputs or outputs.",
    scope: "OSS v1",
  },
  {
    area: "Source persistence",
    events: ["app.source_snapshot.updated"],
    category: "apps",
    source: "web_server",
    actor: "builder agent",
    target: "source_snapshot",
    canAnswer:
      "A build produced a durable snapshot, including file count, total byte size, content hash, artifact flag, and originating run.",
    notLogged: "Source code, compiled files, sourcemaps, prompt content.",
    scope: "OSS v1",
  },
  {
    area: "App metadata and sharing",
    events: [
      "app.renamed",
      "app.deleted",
      "app.visibility_changed",
      "app.teams_changed",
      "app.collaborator_added",
      "app.collaborator_removed",
      "app.collaborators_changed",
    ],
    category: "apps",
    source: "web_server",
    actor: "user",
    target: "app",
    canAnswer:
      "Who changed app identity or access, which teams/collaborators were affected, and whether visibility changed.",
    notLogged: "Full app document, source files, chat history.",
    scope: "OSS v1",
  },
  {
    area: "Review and publishing",
    events: [
      "review.requested",
      "review.approved",
      "review.changes_requested",
      "review.superseded",
      "app.published",
    ],
    category: "reviews",
    source: "web_server",
    actor: "user",
    target: "review",
    canAnswer:
      "Who sent an app to review, who approved it, when review became stale, and when a version was published.",
    notLogged:
      "Sensitive reviewer notes; only short safe summaries if product requires them.",
    scope: "OSS v1",
  },
  {
    area: "Members and teams",
    events: [
      "member.invited",
      "member.invitation_revoked",
      "member.role_changed",
      "member.removed",
      "team.created",
      "team.renamed",
      "team.deleted",
      "member.team_added",
      "member.team_removed",
    ],
    category: "members",
    source: "web_server",
    actor: "user",
    target: "member",
    canAnswer:
      "Who changed access, what role/team changed, who performed it, and when the membership surface changed.",
    notLogged: "Invitation tokens, provider secrets, raw external identity payloads.",
    scope: "OSS v1",
  },
  {
    area: "Integration setup",
    events: [
      "integration.requested",
      "integration.configured",
      "integration.secret_rotated",
      "integration.reset",
      "integration.deleted",
      "oauth.provider_configured",
      "oauth.provider_secret_rotated",
      "oauth.connected",
      "oauth.connect_failed",
      "oauth.revoked",
      "oauth.token_refreshed",
    ],
    category: "integrations",
    source: "web_server",
    actor: "user or builder agent",
    target: "integration",
    canAnswer:
      "Which app requested a provider, what scopes/secrets were requested by name, who configured or rotated static/OAuth credentials, which connected account changed, and whether setup or token refresh succeeded.",
    notLogged: "Secret values, OAuth tokens, request headers, provider API responses.",
    scope: "OSS v1",
  },
  {
    area: "Permission denials",
    events: ["access.denied"],
    category: "access",
    source: "web_server",
    actor: "user or worker",
    target: "workspace",
    canAnswer:
      "When a protected action was blocked, which permission boundary was hit, and whether the attempt came from a stale tab, direct API call, bug, or suspicious flow.",
    notLogged: "Cross-tenant resource existence, raw cookies, headers, session IDs.",
    scope: "OSS v1",
  },
  {
    area: "Workspace runtime settings",
    events: ["workspace.app_runtime_settings_updated"],
    category: "system",
    source: "web_server",
    actor: "user",
    target: "workspace",
    canAnswer:
      "Who changed generated app iframe sandbox capabilities, which setting names changed, and when the workspace policy changed.",
    notLogged: "Generated app source, prompts, clipboard contents, opened URLs.",
    scope: "OSS v1",
  },
  {
    area: "App-agent governance",
    events: ["app.agents_config.approved", "app.agents_config.stale"],
    category: "agents",
    source: "web_server",
    actor: "user or builder agent",
    target: "agent",
    canAnswer:
      "Which exact agents.json policy was approved, who approved it, which app it belongs to, and when a later edit made it stale.",
    notLogged:
      "Full prompts unless separately approved for display; raw tool endpoint headers or secrets.",
    scope: "OSS v1",
  },
  {
    area: "App-agent runs and tools",
    events: [
      "app_agent_run.created",
      "app_agent_run.started",
      "app_agent_run.completed",
      "app_agent_run.failed",
      "tool.custom.executed",
      "tool.custom.denied",
      "tool.custom.mocked",
      "tool.custom.failed",
      "app_agent_tool_failure.reported",
      "app_runtime_tool_failure.reported",
    ],
    category: "tools",
    source: "app_agent",
    actor: "app agent or user",
    target: "tool",
    canAnswer:
      "Which app or app agent used an approved tool/integration, whether it was live or mock, the outcome class, and whether a builder repair run was requested.",
    notLogged:
      "Full agent transcript, reasoning, raw request bodies, full responses, external records.",
    scope: "OSS v1",
  },
  {
    area: "App data writes",
    events: [
      "app_data.document.inserted",
      "app_data.document.updated",
      "app_data.document.deleted",
      "app_data.document.upserted",
    ],
    category: "app_data",
    source: "app_iframe",
    actor: "user or app agent",
    target: "app_data_document",
    canAnswer:
      "Which app collection changed, document ID, operation, source version, actor/source, changed field names, and before/after hashes.",
    notLogged: "Full document contents and sensitive field values.",
    scope: "OSS v1",
  },
  {
    area: "Audit-log usage",
    events: ["audit.viewed"],
    category: "audit",
    source: "web_server",
    actor: "user",
    target: "workspace",
    canAnswer:
      "Who opened the audit area or inspected details, using a rate-limited explicit view event.",
    notLogged: "Duplicated event payloads or exported file contents.",
    scope: "OSS v1",
  },
  {
    area: "Generated app audit SDK",
    events: ["app_event.recorded", "app_event.rejected"],
    category: "app_event",
    source: "app_iframe",
    actor: "generated app user",
    target: "app_event",
    canAnswer:
      "Business-level events emitted by generated apps, and invalid/unsafe client-origin audit payloads blocked before storage.",
    notLogged:
      "Unvalidated client claims as trusted facts, oversized payloads, sensitive metadata keys, raw user-entered secrets.",
    scope: "Enterprise later",
  },
  {
    area: "Export and SIEM evidence",
    events: [
      "audit.export_requested",
      "audit.export_completed",
      "audit.export_downloaded",
      "audit.siem_export_configured",
    ],
    category: "audit",
    source: "web_server",
    actor: "admin or owner",
    target: "audit_export",
    canAnswer:
      "Who exported audit evidence, the filter/time range, row count, manifest hash, and configured external evidence destination.",
    notLogged:
      "Export file contents duplicated back into audit metadata, SIEM credentials, webhook secrets.",
    scope: "Enterprise later",
  },
];
