export type IntegrationRouteGrant = {
  id: string;
  name?: string | null;
  domain?: string | null;
  appName?: string | null;
  appId?: string | null;
  capabilityLabel?: string | null;
};

export function normalizeIntegrationDomain(domain: string): string {
  return domain
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/\/.*$/, "")
    .replace(/^www\./, "");
}

export function slugifyIntegrationRouteSegment(value: string): string {
  return (
    value
      .trim()
      .toLowerCase()
      .replace(/^https?:\/\//, "")
      .replace(/\/.*$/, "")
      .replace(/^www\./, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "integration"
  );
}

export function integrationRouteSegment<T extends IntegrationRouteGrant>(
  grant: T,
  allGrants: readonly T[],
): string {
  const base = slugifyIntegrationRouteSegment(
    grant.name || grant.domain || grant.id,
  );
  const sameBase = allGrants.filter(
    (candidate) =>
      slugifyIntegrationRouteSegment(
        candidate.name || candidate.domain || candidate.id,
      ) === base,
  );
  if (sameBase.length <= 1) return base;

  const appSegment = slugifyIntegrationRouteSegment(
    grant.appName || grant.appId || "app",
  );
  const withApp = `${base}-${appSegment}`;
  const sameApp = allGrants.filter(
    (candidate) =>
      `${slugifyIntegrationRouteSegment(
        candidate.name || candidate.domain || candidate.id,
      )}-${slugifyIntegrationRouteSegment(
        candidate.appName || candidate.appId || "app",
      )}` === withApp,
  );
  if (sameApp.length <= 1) return withApp;

  const withCapability = `${withApp}-${slugifyIntegrationRouteSegment(
    grant.capabilityLabel || "capability",
  )}`;
  const sameCapability = allGrants.filter(
    (candidate) =>
      `${slugifyIntegrationRouteSegment(
        candidate.name || candidate.domain || candidate.id,
      )}-${slugifyIntegrationRouteSegment(
        candidate.appName || candidate.appId || "app",
      )}-${slugifyIntegrationRouteSegment(
        candidate.capabilityLabel || "capability",
      )}` === withCapability,
  );
  if (sameCapability.length <= 1) return withCapability;

  return `${withCapability}-${grant.id.slice(-6)}`;
}

export function integrationRouteAliases(
  grant: IntegrationRouteGrant,
): string[] {
  return [
    grant.id,
    slugifyIntegrationRouteSegment(grant.name ?? ""),
    slugifyIntegrationRouteSegment(grant.domain ?? ""),
    slugifyIntegrationRouteSegment(
      normalizeIntegrationDomain(grant.domain ?? ""),
    ),
  ];
}
