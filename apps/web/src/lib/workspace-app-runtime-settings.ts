export type WorkspaceAppRuntimeSettings = {
  allowIframeScripts: boolean;
  allowIframeClipboard: boolean;
  allowIframeExternalLinks: boolean;
};

export const DEFAULT_WORKSPACE_APP_RUNTIME_SETTINGS: WorkspaceAppRuntimeSettings = {
  allowIframeScripts: true,
  allowIframeClipboard: true,
  allowIframeExternalLinks: true,
};

export function normalizeWorkspaceAppRuntimeSettings(
  value: Partial<WorkspaceAppRuntimeSettings> | null | undefined,
): WorkspaceAppRuntimeSettings {
  return {
    allowIframeScripts:
      typeof value?.allowIframeScripts === "boolean"
        ? value.allowIframeScripts
        : DEFAULT_WORKSPACE_APP_RUNTIME_SETTINGS.allowIframeScripts,
    allowIframeClipboard:
      typeof value?.allowIframeClipboard === "boolean"
        ? value.allowIframeClipboard
        : DEFAULT_WORKSPACE_APP_RUNTIME_SETTINGS.allowIframeClipboard,
    allowIframeExternalLinks:
      typeof value?.allowIframeExternalLinks === "boolean"
        ? value.allowIframeExternalLinks
        : DEFAULT_WORKSPACE_APP_RUNTIME_SETTINGS.allowIframeExternalLinks,
  };
}
