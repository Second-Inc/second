"use client";

import type { PostHog, PostHogConfig } from "posthog-js";
import type {
  AnalyticsConsent,
  AnalyticsIdentity,
} from "@/lib/analytics";

type AnalyticsBrowserConfig = {
  posthogToken: string;
  posthogHost: string;
};

type PostHogModule = typeof import("posthog-js");

let configPromise: Promise<AnalyticsBrowserConfig | null> | null = null;
let clientPromise: Promise<PostHog | null> | null = null;
let client: PostHog | null = null;
let initializedConfigKey: string | null = null;
let activeRecordingKey: string | null = null;
let desiredRecordingKey: string | null = null;

function shouldRecordScreen(
  consent: AnalyticsConsent,
  identity: AnalyticsIdentity | null | undefined,
): identity is AnalyticsIdentity {
  return Boolean(
    identity &&
      consent.shareUsageData &&
      consent.recordScreen &&
      !consent.anonymizeUsageData,
  );
}

function configKey(config: AnalyticsBrowserConfig): string {
  return `${config.posthogHost}:${config.posthogToken}`;
}

function recordingKey(identity: AnalyticsIdentity): string {
  return [
    identity.userId,
    identity.email,
    identity.displayName,
    identity.workspaceId,
    identity.workspaceRole,
  ].join(":");
}

function readAnalyticsBrowserConfig(): Promise<AnalyticsBrowserConfig | null> {
  if (configPromise) return configPromise;

  configPromise = fetch("/api/analytics/config", {
    method: "GET",
    credentials: "same-origin",
    cache: "no-store",
  })
    .then(async (response) => {
      if (!response.ok) return null;
      const json = (await response.json().catch(() => null)) as
        | Partial<AnalyticsBrowserConfig>
        | null;
      const posthogToken = json?.posthogToken?.trim() ?? "";
      const posthogHost = json?.posthogHost?.trim() ?? "";
      if (!posthogToken || !posthogHost) return null;
      return { posthogToken, posthogHost };
    })
    .then((config) => {
      if (!config) configPromise = null;
      return config;
    })
    .catch(() => {
      configPromise = null;
      return null;
    });

  return configPromise;
}

async function loadPostHogClient(): Promise<PostHog | null> {
  const config = await readAnalyticsBrowserConfig();
  if (!config) return null;

  if (client && initializedConfigKey === configKey(config)) {
    return client;
  }

  if (clientPromise) return clientPromise;

  clientPromise = import("posthog-js")
    .then((posthogModule: PostHogModule) => {
      const posthog = posthogModule.default;
      const nextConfig: Partial<PostHogConfig> = {
        api_host: config.posthogHost,
        defaults: "2026-01-30",
        autocapture: false,
        capture_pageview: false,
        capture_pageleave: false,
        capture_dead_clicks: false,
        disable_session_recording: true,
        disable_surveys: true,
        mask_all_text: false,
        mask_all_element_attributes: false,
        session_recording: {
          blockSelector: null,
          maskAllInputs: false,
          maskTextSelector: null,
          strictMinimumDuration: false,
        },
      };

      posthog.init(config.posthogToken, nextConfig);
      client = posthog;
      initializedConfigKey = configKey(config);
      return posthog;
    })
    .catch(() => null)
    .finally(() => {
      clientPromise = null;
    });

  return clientPromise;
}

function stopPostHogScreenRecording() {
  desiredRecordingKey = null;
  activeRecordingKey = null;

  if (!client) return;

  try {
    client.stopSessionRecording();
    client.reset();
  } catch {
    // Screen recording is best-effort and must not affect product usage.
  }
}

async function startPostHogScreenRecording(
  identity: AnalyticsIdentity,
  key: string,
) {
  const posthog = await loadPostHogClient();
  if (!posthog || desiredRecordingKey !== key) return;

  if (activeRecordingKey && activeRecordingKey !== key) {
    try {
      posthog.stopSessionRecording();
      posthog.reset();
    } catch {
      // Continue with the fresh identify/start attempt below.
    }
  }

  try {
    posthog.identify(identity.userId, {
      email: identity.email,
      name: identity.displayName,
      user_id: identity.userId,
      workspace_id: identity.workspaceId,
      workspace_role: identity.workspaceRole,
      second_oss: true,
      screen_recording_consent: true,
    });
    posthog.startSessionRecording({
      sampling: true,
      linked_flag: true,
      url_trigger: true,
      event_trigger: true,
    });
    activeRecordingKey = key;
  } catch {
    activeRecordingKey = null;
  }
}

export function applyPostHogScreenRecordingConsent(
  consent: AnalyticsConsent,
  identity: AnalyticsIdentity | null | undefined,
) {
  if (typeof window === "undefined") return;

  if (!shouldRecordScreen(consent, identity)) {
    stopPostHogScreenRecording();
    return;
  }

  const key = recordingKey(identity);
  desiredRecordingKey = key;

  if (activeRecordingKey === key) return;

  void startPostHogScreenRecording(identity, key);
}
