"use client";

import * as Sentry from "@sentry/nextjs";
import {
  analyticsDistinctIdForConsent,
  readAnalyticsConsent,
  type AnalyticsConsent,
  type AnalyticsIdentity,
} from "@/lib/analytics";

type ReplayController = {
  stop?: () => Promise<void>;
  startBuffering?: () => void;
};

type ApplySentryConsentOptions = {
  updateReplayPrivacyClass?: boolean;
};

const REPLAY_ANONYMIZED_CLASS = "second-sentry-replay-anonymized";
const REPLAY_SENSITIVE_SELECTOR = [
  ".sentry-mask",
  "[data-sentry-mask]",
  "input[type='password']",
  "input[autocomplete='current-password']",
  "input[autocomplete='new-password']",
  "input[autocomplete='cc-number']",
  "input[autocomplete='cc-exp']",
  "input[autocomplete='cc-exp-month']",
  "input[autocomplete='cc-exp-year']",
  "input[autocomplete='cc-csc']",
].join(",");

export const sentryReplayMaskSelectors = [
  `.${REPLAY_ANONYMIZED_CLASS}`,
  REPLAY_SENSITIVE_SELECTOR,
];

export const sentryReplayBlockSelectors = [
  `.${REPLAY_ANONYMIZED_CLASS} img`,
  `.${REPLAY_ANONYMIZED_CLASS} picture`,
  `.${REPLAY_ANONYMIZED_CLASS} video`,
  `.${REPLAY_ANONYMIZED_CLASS} canvas`,
  `.${REPLAY_ANONYMIZED_CLASS} svg`,
];

let lastAnonymizedState: boolean | null = null;

function readReplayController(): ReplayController | null {
  const maybeSentry = Sentry as typeof Sentry & {
    getReplay?: () => ReplayController | undefined;
  };
  return maybeSentry.getReplay?.() ?? null;
}

function applyReplayPrivacyClass(consent: AnalyticsConsent): boolean {
  if (typeof document === "undefined") return false;

  const shouldAnonymize = consent.anonymizeUsageData;
  document.documentElement.classList.toggle(
    REPLAY_ANONYMIZED_CLASS,
    shouldAnonymize,
  );
  document.body?.classList.toggle(REPLAY_ANONYMIZED_CLASS, shouldAnonymize);

  const changed =
    lastAnonymizedState !== null && lastAnonymizedState !== shouldAnonymize;
  lastAnonymizedState = shouldAnonymize;
  return changed;
}

async function restartReplayBufferAfterPrivacyChange() {
  const replay = readReplayController();
  if (!replay?.stop || !replay.startBuffering) return;

  await replay.stop().catch(() => undefined);
  replay.startBuffering();
}

export function applySentryConsentState(
  consent: AnalyticsConsent = readAnalyticsConsent(),
  identity?: AnalyticsIdentity | null,
  options: ApplySentryConsentOptions = {},
) {
  const shouldUpdateReplayPrivacyClass =
    options.updateReplayPrivacyClass ?? true;
  const replayPrivacyChanged = shouldUpdateReplayPrivacyClass
    ? applyReplayPrivacyClass(consent)
    : false;
  const distinctId = analyticsDistinctIdForConsent(consent, identity ?? null);
  const distinctIdKind = consent.anonymizeUsageData
    ? "anonymous"
    : identity
      ? "user"
      : "anonymous";

  Sentry.setTag("second.analytics_anonymized", String(consent.anonymizeUsageData));
  Sentry.setTag("posthog_distinct_id", distinctId ?? undefined);
  Sentry.setTag("posthog_distinct_id_kind", distinctId ? distinctIdKind : undefined);

  if (!distinctId) {
    Sentry.setUser(null);
    Sentry.setContext("posthog", null);
  } else if (!consent.anonymizeUsageData && identity) {
    Sentry.setUser({
      id: identity.userId,
      email: identity.email,
      username: identity.displayName,
    });
    Sentry.setContext("posthog", {
      distinct_id: distinctId,
      distinct_id_kind: "user",
      anonymized: false,
      workspace_id: identity.workspaceId,
      workspace_role: identity.workspaceRole,
    });
  } else {
    Sentry.setUser({ id: distinctId });
    Sentry.setContext("posthog", {
      distinct_id: distinctId,
      distinct_id_kind: "anonymous",
      anonymized: true,
    });
  }

  if (replayPrivacyChanged) {
    void restartReplayBufferAfterPrivacyChange();
  }
}
