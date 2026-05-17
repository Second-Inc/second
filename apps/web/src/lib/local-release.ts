const LOCAL_RELEASE_TIMEOUT_MS = 5_000;

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "::1", "[::1]"]);

type LocalReleaseError = {
  code: string;
  message: string;
};

type LocalReleaseConfig =
  | { enabled: false }
  | {
      enabled: true;
      ok: true;
      baseUrl: string;
      token: string;
      packageName?: string;
      currentVersion?: string;
      runtime?: string;
    }
  | {
      enabled: true;
      ok: false;
      packageName?: string;
      currentVersion?: string;
      runtime?: string;
      error: LocalReleaseError;
    };

export type LocalReleaseStatus = {
  enabled: boolean;
  reachable: boolean;
  packageName?: string;
  currentVersion?: string;
  latestVersion?: string | null;
  runtime?: string;
  updateAvailable: boolean;
  updating: boolean;
  checkedAt?: string;
  error?: LocalReleaseError;
};

export type LocalReleaseUpdateResult = {
  enabled: boolean;
  accepted: boolean;
  updating: boolean;
  alreadyUpdating?: boolean;
  error?: LocalReleaseError;
};

type ControlResponse = {
  ok: boolean;
  status: number;
  payload: Record<string, unknown>;
};

function readLocalReleaseConfig(): LocalReleaseConfig {
  const packageName = readEnvString("SECOND_RELEASE_PACKAGE");
  const currentVersion = readEnvString("SECOND_RELEASE_VERSION");
  const runtime = readEnvString("SECOND_RELEASE_RUNTIME");

  if (process.env.SECOND_LOCAL_INSTALL !== "1") {
    return { enabled: false };
  }

  const rawUrl = readEnvString("SECOND_LOCAL_CLI_URL");
  const token = readEnvString("SECOND_LOCAL_CLI_TOKEN");

  if (!rawUrl || !token) {
    return {
      enabled: true,
      ok: false,
      packageName,
      currentVersion,
      runtime,
      error: {
        code: "local_control_unconfigured",
        message: "Local updater is not configured for this process.",
      },
    };
  }

  const baseUrl = readLoopbackHttpOrigin(rawUrl);
  if (!baseUrl) {
    return {
      enabled: true,
      ok: false,
      packageName,
      currentVersion,
      runtime,
      error: {
        code: "invalid_local_control_url",
        message: "Local updater refused a non-loopback control URL.",
      },
    };
  }

  return {
    enabled: true,
    ok: true,
    baseUrl,
    token,
    packageName,
    currentVersion,
    runtime,
  };
}

export async function getLocalReleaseStatus(): Promise<LocalReleaseStatus> {
  const config = readLocalReleaseConfig();
  if (!config.enabled) return disabledStatus();

  if (!config.ok) {
    return {
      enabled: true,
      reachable: false,
      packageName: config.packageName,
      currentVersion: config.currentVersion,
      runtime: config.runtime,
      updateAvailable: false,
      updating: false,
      error: config.error,
    };
  }

  const response = await fetchControl(config, "/release/status", "GET");
  if (!response.ok) {
    return {
      enabled: true,
      reachable: response.status > 0,
      packageName: config.packageName,
      currentVersion: config.currentVersion,
      runtime: config.runtime,
      updateAvailable: false,
      updating: false,
      error: readControlError(response, "release_status_failed"),
    };
  }

  return {
    enabled: true,
    reachable: true,
    packageName: readString(response.payload.packageName) ?? config.packageName,
    currentVersion:
      readString(response.payload.currentVersion) ?? config.currentVersion,
    latestVersion: readNullableString(response.payload.latestVersion),
    runtime: readString(response.payload.runtime) ?? config.runtime,
    updateAvailable: response.payload.updateAvailable === true,
    updating: response.payload.updating === true,
    checkedAt: readString(response.payload.checkedAt),
  };
}

export async function installLocalReleaseUpdate(): Promise<LocalReleaseUpdateResult> {
  const config = readLocalReleaseConfig();
  if (!config.enabled) {
    return {
      enabled: false,
      accepted: false,
      updating: false,
      error: {
        code: "not_local_install",
        message: "Updates are only available in the local CLI runtime.",
      },
    };
  }

  if (!config.ok) {
    return {
      enabled: true,
      accepted: false,
      updating: false,
      error: config.error,
    };
  }

  const response = await fetchControl(config, "/update/install", "POST");
  return {
    enabled: true,
    accepted: response.ok && response.payload.accepted === true,
    updating: response.payload.updating === true,
    alreadyUpdating: response.payload.alreadyUpdating === true,
    error: response.ok ? undefined : readControlError(response, "update_failed"),
  };
}

function disabledStatus(): LocalReleaseStatus {
  return {
    enabled: false,
    reachable: false,
    updateAvailable: false,
    updating: false,
  };
}

async function fetchControl(
  config: Extract<LocalReleaseConfig, { ok: true }>,
  path: "/release/status" | "/update/install",
  method: "GET" | "POST",
): Promise<ControlResponse> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), LOCAL_RELEASE_TIMEOUT_MS);

  try {
    const response = await fetch(`${config.baseUrl}${path}`, {
      method,
      cache: "no-store",
      signal: controller.signal,
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${config.token}`,
      },
    });

    return {
      ok: response.ok,
      status: response.status,
      payload: await readJsonObject(response),
    };
  } catch (error) {
    const aborted = error instanceof Error && error.name === "AbortError";
    return {
      ok: false,
      status: 0,
      payload: {
        error: aborted ? "local_control_timeout" : "local_control_unreachable",
      },
    };
  } finally {
    clearTimeout(timeout);
  }
}

async function readJsonObject(response: Response): Promise<Record<string, unknown>> {
  try {
    const payload: unknown = await response.json();
    return isRecord(payload) ? payload : {};
  } catch {
    return {};
  }
}

function readControlError(
  response: ControlResponse,
  fallbackCode: string,
): LocalReleaseError {
  const code = readString(response.payload.error) ?? fallbackCode;
  const message =
    readString(response.payload.message) ??
    (response.status === 0
      ? "Local updater is not reachable yet."
      : "Local updater request failed.");

  return { code, message };
}

function readLoopbackHttpOrigin(value: string): string | null {
  try {
    const url = new URL(value);
    const hostname = url.hostname.toLowerCase();
    if (url.protocol !== "http:") return null;
    if (!LOOPBACK_HOSTS.has(hostname)) return null;
    if (url.username || url.password) return null;
    return url.origin;
  } catch {
    return null;
  }
}

function readEnvString(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value ? value : undefined;
}

function readNullableString(value: unknown): string | null | undefined {
  if (value === null) return null;
  return readString(value);
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
