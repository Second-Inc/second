export type IntegrationIconInput = {
  name?: string | null;
  domain?: string | null;
  endpointUrl?: string | null;
  iconUrl?: string | null;
  faviconUrl?: string | null;
  auth?: {
    providerKey?: string | null;
    scopes?: string[] | null;
  } | null;
};

function normalizeDomain(value?: string | null): string {
  if (!value) return "";
  return value
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/\/.*$/, "")
    .replace(/^www\./, "");
}

function hostname(value?: string | null): string {
  if (!value) return "";
  try {
    return normalizeDomain(new URL(value).hostname);
  } catch {
    return normalizeDomain(value);
  }
}

function safeHttpsUrl(value?: string | null): string | null {
  if (!value) return null;
  try {
    const url = new URL(value.trim());
    return url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
}

export function faviconUrl(domain: string, size = 32): string {
  return `https://www.google.com/s2/favicons?sz=${size}&domain=${normalizeDomain(domain)}`;
}

function hasAny(text: string, values: string[]): boolean {
  return values.some((value) => text.includes(value));
}

function providerFallbackDomain(providerKey: string): string | null {
  const domains: Record<string, string> = {
    asana: "asana.com",
    box: "box.com",
    dropbox: "dropbox.com",
    github: "github.com",
    gitlab: "gitlab.com",
    hubspot: "hubspot.com",
    jira: "atlassian.com",
    linear: "linear.app",
    notion: "notion.so",
    salesforce: "salesforce.com",
    slack: "slack.com",
    zoom: "zoom.us",
  };
  return domains[providerKey] ?? null;
}

export function integrationIconUrl(input: IntegrationIconInput): string {
  const explicit = safeHttpsUrl(input.iconUrl) ?? safeHttpsUrl(input.faviconUrl);
  if (explicit) return explicit;

  const domain = normalizeDomain(input.domain);
  const endpointHost = hostname(input.endpointUrl);
  const providerKey = (input.auth?.providerKey ?? "").trim().toLowerCase();
  const scopes = input.auth?.scopes ?? [];
  const text = [
    input.name ?? "",
    domain,
    endpointHost,
    providerKey,
    ...scopes,
  ]
    .join(" ")
    .toLowerCase();

  const isGoogle =
    providerKey === "google" ||
    domain.endsWith("googleapis.com") ||
    endpointHost.endsWith("googleapis.com");
  if (isGoogle) {
    if (hasAny(text, ["calendar", "/auth/calendar"])) {
      return faviconUrl("calendar.google.com", 32);
    }
    if (hasAny(text, ["gmail", "mail.google.com", "/auth/gmail"])) {
      return faviconUrl("mail.google.com", 32);
    }
    if (hasAny(text, ["drive", "/auth/drive"])) {
      return faviconUrl("drive.google.com", 32);
    }
    if (hasAny(text, ["sheets", "spreadsheets", "/auth/spreadsheets"])) {
      return faviconUrl("sheets.google.com", 32);
    }
    if (hasAny(text, ["docs", "documents", "/auth/documents"])) {
      return faviconUrl("docs.google.com", 32);
    }
    if (hasAny(text, ["slides", "presentations", "/auth/presentations"])) {
      return faviconUrl("slides.google.com", 32);
    }
    if (hasAny(text, ["meet"])) {
      return faviconUrl("meet.google.com", 32);
    }
    return faviconUrl("google.com", 32);
  }

  const isMicrosoft =
    providerKey === "microsoft" ||
    providerKey === "azure" ||
    endpointHost.endsWith("microsoft.com") ||
    endpointHost.endsWith("office.com") ||
    endpointHost === "graph.microsoft.com";
  if (isMicrosoft) {
    if (hasAny(text, ["outlook", "mail", "calendar"])) {
      return faviconUrl("outlook.office.com", 32);
    }
    if (hasAny(text, ["teams"])) {
      return faviconUrl("teams.microsoft.com", 32);
    }
    if (hasAny(text, ["onedrive"])) {
      return faviconUrl("onedrive.live.com", 32);
    }
    if (hasAny(text, ["sharepoint"])) {
      return faviconUrl("sharepoint.com", 32);
    }
    return faviconUrl("microsoft.com", 32);
  }

  const providerDomain = providerFallbackDomain(providerKey);
  if (providerDomain) return faviconUrl(providerDomain, 32);

  const fallbackDomain = domain || endpointHost;
  return fallbackDomain ? faviconUrl(fallbackDomain, 32) : faviconUrl("example.com", 32);
}
