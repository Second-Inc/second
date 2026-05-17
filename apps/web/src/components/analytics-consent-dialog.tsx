"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ComponentType,
} from "react";
import {
  BarChart3Icon,
  CheckIcon,
  ShieldCheckIcon,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import {
  captureAnalyticsEvent,
  identifyAnalyticsUser,
  readAnalyticsConsent,
  setAnalyticsIdentity,
  subscribeAnalyticsConsent,
  subscribeAnalyticsSettingsDialog,
  writeAnalyticsConsent,
  type AnalyticsConsent,
  type AnalyticsIdentity,
} from "@/lib/analytics";
import { applySentryConsentState } from "@/lib/sentry-client-consent";
import { cn } from "@/lib/utils";

type AnalyticsConsentDialogProps = {
  identity: AnalyticsIdentity;
};

type ConsentToggleRowProps = {
  icon: ComponentType<{ className?: string; strokeWidth?: number }>;
  title: string;
  description: string;
  checked: boolean;
  disabled?: boolean;
  onCheckedChange: (checked: boolean) => void;
};

const SETTINGS_UPDATED_VISIBLE_MS = 3000;

function onboardingEventStorageKey(identity: AnalyticsIdentity): string {
  return `second:analytics:onboarding-finished:v2:${identity.userId}:${identity.workspaceId}`;
}

function ConsentToggleRow({
  icon: Icon,
  title,
  description,
  checked,
  disabled = false,
  onCheckedChange,
}: ConsentToggleRowProps) {
  return (
    <div
      className={cn(
        "flex items-center gap-4",
        disabled && "opacity-60",
      )}
      data-disabled={disabled || undefined}
    >
      <div className="flex size-7 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
        <Icon className="size-3.5" strokeWidth={1.8} />
      </div>
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium tracking-tight">{title}</div>
        <p className="mt-1 max-w-sm text-[12px] leading-relaxed text-muted-foreground">
          {description}
        </p>
      </div>
      <Switch
        checked={checked}
        disabled={disabled}
        aria-label={title}
        className={cn(
          "[--toggle-on:oklch(0.62_0.18_148)] [--toggle-ring:oklch(0.62_0.18_148_/_0.24)] dark:[--toggle-on:oklch(0.72_0.19_148)] dark:[--toggle-ring:oklch(0.72_0.19_148_/_0.24)]",
          "[&>span]:bg-white",
          checked &&
            "bg-[var(--toggle-on)] hover:bg-[var(--toggle-on)] focus-visible:ring-[var(--toggle-ring)]",
        )}
        onCheckedChange={onCheckedChange}
      />
    </div>
  );
}

export function AnalyticsConsentDialog({
  identity,
}: AnalyticsConsentDialogProps) {
  const [consent, setConsent] = useState<AnalyticsConsent>(() =>
    readAnalyticsConsent(),
  );
  const [loaded, setLoaded] = useState(false);
  const [open, setOpen] = useState(false);
  const [settingsUpdatedVisible, setSettingsUpdatedVisible] = useState(false);
  const settingsUpdatedTimerRef = useRef<number | null>(null);

  useEffect(() => {
    setAnalyticsIdentity(identity);
    applySentryConsentState(readAnalyticsConsent(), identity);
    void identifyAnalyticsUser();
  }, [identity]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setConsent(readAnalyticsConsent());
      setLoaded(true);
    }, 0);

    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    return subscribeAnalyticsConsent((nextConsent) => {
      setConsent(nextConsent);
      applySentryConsentState(nextConsent, identity);
    });
  }, [identity]);

  useEffect(() => {
    return subscribeAnalyticsSettingsDialog(() => {
      setOpen(true);
    });
  }, []);

  useEffect(() => {
    return () => {
      if (settingsUpdatedTimerRef.current !== null) {
        window.clearTimeout(settingsUpdatedTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (!loaded || !consent.shareUsageData) return;

    if (!consent.anonymizeUsageData) {
      void identifyAnalyticsUser();
    }

    try {
      const key = onboardingEventStorageKey(identity);
      if (window.localStorage.getItem(key)) return;

      void captureAnalyticsEvent("onboarding finished", {
        user_id: identity.userId,
        workspace_id: identity.workspaceId,
        workspace_role: identity.workspaceRole,
      }).then((captured) => {
        if (!captured) return;
        window.localStorage.setItem(key, "1");
      });
    } catch {
      // Onboarding telemetry is best-effort and must never block the app.
    }
  }, [
    consent.anonymizeUsageData,
    consent.shareUsageData,
    identity,
    loaded,
  ]);

  const persistConsent = useCallback((nextConsent: AnalyticsConsent) => {
    const saved = writeAnalyticsConsent(nextConsent);
    setConsent(saved);
  }, []);

  const showSettingsUpdated = useCallback(() => {
    setSettingsUpdatedVisible(true);

    if (settingsUpdatedTimerRef.current !== null) {
      window.clearTimeout(settingsUpdatedTimerRef.current);
    }

    settingsUpdatedTimerRef.current = window.setTimeout(() => {
      settingsUpdatedTimerRef.current = null;
      setSettingsUpdatedVisible(false);
    }, SETTINGS_UPDATED_VISIBLE_MS);
  }, []);

  const updateConsent = useCallback(
    (patch: Partial<AnalyticsConsent>) => {
      persistConsent({
          ...consent,
          ...patch,
          dismissed: true,
        });
      showSettingsUpdated();
    },
    [consent, persistConsent, showSettingsUpdated],
  );

  const handleOpenChange = useCallback(
    (nextOpen: boolean) => {
      setOpen(nextOpen);
      if (!nextOpen && loaded && !consent.dismissed) {
        persistConsent({
          ...consent,
          dismissed: true,
        });
      }
    },
    [consent, loaded, persistConsent],
  );

  if (!loaded) return null;

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="overflow-hidden p-0 sm:max-w-md">
        <div
          className="flex items-center justify-center px-8 py-10 bg-gradient-to-br from-sky-50 via-indigo-50 to-violet-50 dark:from-sky-950/30 dark:via-indigo-950/20 dark:to-violet-950/30"
          aria-hidden="true"
        >
          <div className="flex size-11 items-center justify-center rounded-xl bg-white shadow-sm ring-1 ring-black/[0.06] dark:bg-white/10 dark:ring-white/10">
            <BarChart3Icon className="size-5 text-foreground" strokeWidth={1.7} />
          </div>
        </div>

        <div className="flex flex-col gap-6 px-6 pb-5 pt-4">
          <DialogHeader>
            <DialogTitle className="text-lg font-medium">
              Usage data
            </DialogTitle>
            <DialogDescription className="text-sm text-muted-foreground">
              Second collects product analytics and diagnostic error reports to improve the
              experience. Control how much details is shared below.
            </DialogDescription>
          </DialogHeader>

          <ConsentToggleRow
            icon={ShieldCheckIcon}
            title="Anonymize usage and diagnostics data"
            description="Avoid user, workspace, app, prompt, and agent identifiers."
            checked={consent.anonymizeUsageData}
            onCheckedChange={(checked) => {
              updateConsent({ anonymizeUsageData: checked });
            }}
          />

          {settingsUpdatedVisible ? (
            <div className="flex items-center gap-1.5 text-[12px] text-muted-foreground">
              <CheckIcon className="size-3.5 text-muted-foreground" strokeWidth={2} />
              <span>Settings updated</span>
            </div>
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}
