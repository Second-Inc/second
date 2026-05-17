import * as Sentry from "@sentry/nextjs";
import {
  readSentryDsn,
  readSentryEnvironment,
  readSentryRelease,
  scrubSentryEvent,
} from "@/lib/sentry-public-config";

const dsn = readSentryDsn();

Sentry.init({
  dsn,
  enabled: Boolean(dsn),
  environment: readSentryEnvironment(),
  release: readSentryRelease(),
  sendDefaultPii: false,
  tracesSampleRate: 0,
  beforeSend(event) {
    return scrubSentryEvent(event);
  },
});
