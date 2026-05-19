"use client";

export type AnalyticsConsent = {
  shareUsageData: boolean;
  anonymizeUsageData: boolean;
  recordScreen: boolean;
  dismissed: boolean;
};

export type AnalyticsIdentity = {
  userId: string;
  email: string;
  displayName: string;
  workspaceId: string;
  workspaceRole: string;
};

export type AnalyticsProperties = Record<string, unknown>;

const CONSENT_STORAGE_KEY = "second:analytics-consent:v1";
const ANONYMOUS_ID_STORAGE_KEY = "second:analytics-anonymous-id:v1";
const CONSENT_EVENT_NAME = "second:analytics-consent-changed";
const SETTINGS_OPEN_EVENT_NAME = "second:analytics-settings-open";
const MAX_TEXT_PROPERTY_LENGTH = 2000;

const DEFAULT_CONSENT: AnalyticsConsent = {
  shareUsageData: true,
  anonymizeUsageData: true,
  recordScreen: false,
  dismissed: false,
};

const ANONYMIZED_OMIT_KEYS = new Set([
  "user_id",
  "user_email",
  "user_name",
  "workspace_id",
  "workspace_role",
  "app_id",
  "app_name",
  "run_id",
  "agent_id",
  "agent_name",
  "agent_ids",
  "agent_names",
  "agents",
  "message",
  "prompt",
  "error",
  "error_message",
  "suggestion_title",
  "suggestion_titles",
  "suggestions",
  "page_url",
  "pathname",
  "referrer",
]);

let currentIdentity: AnalyticsIdentity | null = null;
let lastIdentifyKey: string | null = null;
let memoryAnonymousDistinctId: string | null = null;

function analyticsRouteShape(pathname: string): string {
  const segments = pathname.split("/").filter(Boolean);

  if (segments[0] === "w" && segments[1]) {
    segments[1] = ":workspace";
  }

  for (let index = 0; index < segments.length; index += 1) {
    const segment = segments[index];
    if (/^[a-f0-9]{24}$/i.test(segment)) {
      segments[index] = ":objectId";
    } else if (/^[0-9a-f]{8}-[0-9a-f-]{27,}$/i.test(segment)) {
      segments[index] = ":uuid";
    }
  }

  const settingsIndex = segments.indexOf("settings");
  if (
    settingsIndex >= 0 &&
    segments[settingsIndex + 1] === "integrations" &&
    segments[settingsIndex + 2]
  ) {
    segments[settingsIndex + 2] = ":integration";
  }

  return segments.length > 0 ? `/${segments.join("/")}` : "/";
}

function analyticsSurface(pathname: string): AnalyticsProperties {
  const segments = pathname.split("/").filter(Boolean);

  if (segments[0] === "onboarding") {
    return {
      surface: "onboarding",
      onboarding_step: segments[1] ?? "intro",
    };
  }

  if (segments[0] !== "w") {
    return { surface: "public" };
  }

  const section = segments[2];
  if (!section) return { surface: "workspace_home" };

  if (section === "apps") {
    const appSection = segments[4] ?? "chat";
    return {
      surface: appSection === "agents" ? "app_agents" : "app_chat",
      app_section: appSection,
    };
  }

  if (section === "settings") {
    return {
      surface: "settings",
      settings_section: segments[3] ?? "overview",
    };
  }

  if (section === "agents") return { surface: "workspace_agents" };
  if (section === "library") return { surface: "library" };
  if (section === "reviews") return { surface: "reviews" };

  return {
    surface: "workspace",
    workspace_section: section,
  };
}

function currentRouteAnalyticsProperties(): AnalyticsProperties {
  if (typeof window === "undefined") return {};

  return {
    route_shape: analyticsRouteShape(window.location.pathname),
    ...analyticsSurface(window.location.pathname),
    viewport_width: window.innerWidth,
    viewport_height: window.innerHeight,
  };
}

function browserStorage(): Storage | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function normalizeConsent(value: unknown): AnalyticsConsent {
  const record =
    value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  const wasExplicitlyDisabled = record.shareUsageData === false;
  const anonymizeUsageData = wasExplicitlyDisabled
    ? true
    : record.anonymizeUsageData !== false;
  return {
    shareUsageData: true,
    anonymizeUsageData,
    recordScreen: record.recordScreen === true && !anonymizeUsageData,
    dismissed: record.dismissed === true,
  };
}

export function readAnalyticsConsent(): AnalyticsConsent {
  const storage = browserStorage();
  if (!storage) return DEFAULT_CONSENT;

  try {
    const raw = storage.getItem(CONSENT_STORAGE_KEY);
    if (!raw) return DEFAULT_CONSENT;
    return normalizeConsent(JSON.parse(raw));
  } catch {
    return DEFAULT_CONSENT;
  }
}

export function writeAnalyticsConsent(
  nextConsent: AnalyticsConsent,
): AnalyticsConsent {
  const normalized = normalizeConsent(nextConsent);
  const storage = browserStorage();

  try {
    storage?.setItem(
      CONSENT_STORAGE_KEY,
      JSON.stringify({
        ...normalized,
        updatedAt: new Date().toISOString(),
      }),
    );
  } catch {
    // Analytics consent is client-only and best-effort.
  }

  if (typeof window !== "undefined") {
    window.dispatchEvent(
      new CustomEvent<AnalyticsConsent>(CONSENT_EVENT_NAME, {
        detail: normalized,
      }),
    );
  }

  return normalized;
}

export function subscribeAnalyticsConsent(
  callback: (consent: AnalyticsConsent) => void,
): () => void {
  if (typeof window === "undefined") return () => {};

  const handleCustomEvent = (event: Event) => {
    callback(
      normalizeConsent(
        (event as CustomEvent<AnalyticsConsent>).detail,
      ),
    );
  };
  const handleStorageEvent = (event: StorageEvent) => {
    if (event.key !== CONSENT_STORAGE_KEY) return;
    callback(readAnalyticsConsent());
  };

  window.addEventListener(CONSENT_EVENT_NAME, handleCustomEvent);
  window.addEventListener("storage", handleStorageEvent);
  return () => {
    window.removeEventListener(CONSENT_EVENT_NAME, handleCustomEvent);
    window.removeEventListener("storage", handleStorageEvent);
  };
}

export function openAnalyticsSettingsDialog(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(SETTINGS_OPEN_EVENT_NAME));
}

export function subscribeAnalyticsSettingsDialog(
  callback: () => void,
): () => void {
  if (typeof window === "undefined") return () => {};

  window.addEventListener(SETTINGS_OPEN_EVENT_NAME, callback);
  return () => {
    window.removeEventListener(SETTINGS_OPEN_EVENT_NAME, callback);
  };
}

export function setAnalyticsIdentity(identity: AnalyticsIdentity): void {
  currentIdentity = identity;
}

function createAnonymousDistinctId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return `anon_${crypto.randomUUID()}`;
  }

  const random = Math.random().toString(36).slice(2);
  return `anon_${Date.now().toString(36)}_${random}`;
}

export function readOrCreateAnalyticsAnonymousId(): string {
  if (memoryAnonymousDistinctId) return memoryAnonymousDistinctId;

  const storage = browserStorage();
  try {
    const existing = storage?.getItem(ANONYMOUS_ID_STORAGE_KEY);
    if (existing?.startsWith("anon_")) {
      memoryAnonymousDistinctId = existing;
      return existing;
    }

    const next = createAnonymousDistinctId();
    storage?.setItem(ANONYMOUS_ID_STORAGE_KEY, next);
    memoryAnonymousDistinctId = next;
    return next;
  } catch {
    const next = createAnonymousDistinctId();
    memoryAnonymousDistinctId = next;
    return next;
  }
}

export function resetAnalyticsAnonymousId(): void {
  memoryAnonymousDistinctId = null;
  try {
    browserStorage()?.removeItem(ANONYMOUS_ID_STORAGE_KEY);
  } catch {
    // Analytics identity reset is best-effort.
  }
}

export function analyticsDistinctIdForConsent(
  consent: AnalyticsConsent = readAnalyticsConsent(),
  identity: AnalyticsIdentity | null = currentIdentity,
): string | null {
  if (!consent.shareUsageData) return null;
  if (consent.anonymizeUsageData || !identity) {
    return readOrCreateAnalyticsAnonymousId();
  }
  return identity.userId;
}

function analyticsIdentifyKey(
  identity: AnalyticsIdentity,
  consent: AnalyticsConsent,
): string | null {
  if (!consent.shareUsageData || consent.anonymizeUsageData) return null;
  return [
    identity.userId,
    identity.email,
    identity.displayName,
    identity.workspaceId,
    identity.workspaceRole,
  ].join(":");
}

export function identifyAnalyticsUser(): Promise<boolean> {
  const consent = readAnalyticsConsent();
  if (!currentIdentity || !consent.shareUsageData || consent.anonymizeUsageData) {
    lastIdentifyKey = null;
    return Promise.resolve(false);
  }
  if (typeof window === "undefined") return Promise.resolve(false);

  const identifyKey = analyticsIdentifyKey(currentIdentity, consent);
  if (!identifyKey) return Promise.resolve(false);
  if (lastIdentifyKey === identifyKey) return Promise.resolve(true);

  const body = JSON.stringify({
    workspaceId: currentIdentity.workspaceId,
  });

  return fetch("/api/analytics/identify", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body,
    credentials: "same-origin",
    cache: "no-store",
    keepalive: body.length < 60_000,
  })
    .then((response) => {
      const identified = response.ok;
      if (identified) lastIdentifyKey = identifyKey;
      return identified;
    })
    .catch(() => false);
}

function preparedProperties(
  properties: AnalyticsProperties,
  consent: AnalyticsConsent,
): AnalyticsProperties {
  const next: AnalyticsProperties = {
    ...properties,
    anonymized: consent.anonymizeUsageData,
    analytics_consent_version: 1,
  };

  for (const [key, value] of Object.entries(next)) {
    if (value === undefined) delete next[key];
  }

  if (!consent.anonymizeUsageData) return next;

  for (const key of Object.keys(next)) {
    if (
      ANONYMIZED_OMIT_KEYS.has(key) ||
      key.endsWith("_id") ||
      key.endsWith("_ids") ||
      key.endsWith("_email") ||
      key.endsWith("_name") ||
      key.endsWith("_names")
    ) {
      delete next[key];
    }
  }

  return next;
}

export function textAnalyticsProperties(
  key: "message" | "prompt",
  value: string | null | undefined,
): AnalyticsProperties {
  const text = value?.trim() ?? "";
  if (!text) {
    return {
      [`${key}_length`]: 0,
      [`${key}_included`]: false,
      [`${key}_truncated`]: false,
    };
  }

  const truncated = text.length > MAX_TEXT_PROPERTY_LENGTH;
  return {
    [key]: truncated ? text.slice(0, MAX_TEXT_PROPERTY_LENGTH) : text,
    [`${key}_length`]: text.length,
    [`${key}_included`]: true,
    [`${key}_truncated`]: truncated,
  };
}

export function runtimeModelFamily(
  model: string | null | undefined,
): string | undefined {
  const normalized = model?.toLowerCase().trim();
  if (!normalized) return undefined;
  if (normalized.startsWith("claude")) return "claude";
  if (normalized.startsWith("gpt") || normalized.startsWith("o")) return "openai";
  if (normalized.startsWith("gemini")) return "gemini";
  return normalized.split(/[-_:./]/)[0] || "other";
}

export function captureAnalyticsEvent(
  eventName: string,
  properties: AnalyticsProperties = {},
): Promise<boolean> {
  const consent = readAnalyticsConsent();
  if (!consent.shareUsageData) return Promise.resolve(false);
  if (typeof window === "undefined") return Promise.resolve(false);

  const latestConsent = readAnalyticsConsent();
  if (!latestConsent.shareUsageData) return Promise.resolve(false);

  const prepared = preparedProperties(
    {
      workspace_id: currentIdentity?.workspaceId,
      workspace_role: currentIdentity?.workspaceRole,
      page_url: window.location.href,
      pathname: window.location.pathname,
      ...currentRouteAnalyticsProperties(),
      ...properties,
    },
    latestConsent,
  );
  const body = JSON.stringify({
    event: eventName,
    anonymousDistinctId: latestConsent.anonymizeUsageData
      ? readOrCreateAnalyticsAnonymousId()
      : undefined,
    properties: prepared,
  });

  return fetch("/api/analytics/capture", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body,
    credentials: "same-origin",
    cache: "no-store",
    keepalive: body.length < 60_000,
  })
    .then((response) => response.ok)
    .catch(() => false);
}
