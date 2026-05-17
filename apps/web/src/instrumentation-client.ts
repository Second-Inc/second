import * as Sentry from "@sentry/nextjs";
import { readAnalyticsConsent } from "@/lib/analytics";
import {
  browserAllowsSentry,
  readSentryDsn,
  readSentryEnvironment,
  readSentryRelease,
  scrubSentryEvent,
} from "@/lib/sentry-public-config";
import {
  applySentryConsentState,
  sentryReplayBlockSelectors,
  sentryReplayMaskSelectors,
} from "@/lib/sentry-client-consent";

const dsn = readSentryDsn();
const initialConsent = readAnalyticsConsent();
const initiallyAnonymized = initialConsent.anonymizeUsageData;

Sentry.init({
  dsn,
  enabled:
    Boolean(dsn) &&
    browserAllowsSentry() &&
    initialConsent.shareUsageData,
  environment: readSentryEnvironment(),
  release: readSentryRelease(),
  sendDefaultPii: false,
  integrations: [
    Sentry.replayIntegration({
      maskAllText: initiallyAnonymized,
      maskAllInputs: initiallyAnonymized,
      blockAllMedia: initiallyAnonymized,
      mask: sentryReplayMaskSelectors,
      block: sentryReplayBlockSelectors,
    }),
  ],
  replaysSessionSampleRate: 0,
  replaysOnErrorSampleRate: 1.0,
  beforeSend(event) {
    if (!browserAllowsSentry()) return null;
    if (!readAnalyticsConsent().shareUsageData) return null;
    return scrubSentryEvent(event);
  },
});

applySentryConsentState(initialConsent, null, {
  updateReplayPrivacyClass: false,
});

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
