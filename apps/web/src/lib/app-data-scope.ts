export type AppSourceVersion = "draft" | "published";

const DRAFT_DATA_SUFFIX = "__draft";

export function normalizeAppSourceVersion(
  value: string | null | undefined,
): AppSourceVersion {
  return value === "draft" ? "draft" : "published";
}

export function appDataScopeId(
  appId: string,
  sourceVersion: AppSourceVersion,
): string {
  return sourceVersion === "draft" ? `${appId}${DRAFT_DATA_SUFFIX}` : appId;
}
