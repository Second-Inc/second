"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ClipboardIcon,
  Code2Icon,
  ExternalLinkIcon,
  Loader2Icon,
  RefreshCwIcon,
  ShieldCheckIcon,
} from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { useWorkspaceRealtimeEvent } from "@/components/workspace-realtime-provider";
import {
  DEFAULT_WORKSPACE_APP_RUNTIME_SETTINGS,
  type WorkspaceAppRuntimeSettings,
} from "@/lib/workspace-app-runtime-settings";
import type { AppRuntimeSettingsReadModel } from "@/lib/workspace-settings/read-models";
import {
  abortForNavigation,
  subscribeNavigationIntent,
} from "@/lib/navigation-intent";
import { cn } from "@/lib/utils";

type AppRuntimeSettingsClientProps = {
  workspaceId: string;
  initialData: AppRuntimeSettingsReadModel | null;
};

type SettingKey = keyof WorkspaceAppRuntimeSettings;

type SettingItem = {
  key: SettingKey;
  title: string;
  description: string;
  icon: React.ComponentType<{ className?: string }>;
  disabledWhenScriptsOff?: boolean;
};

const SETTINGS: SettingItem[] = [
  {
    key: "allowIframeScripts",
    title: "JavaScript",
    description:
      "Run generated React apps, SDK hooks, and user-authored client code in the preview iframe.",
    icon: Code2Icon,
  },
  {
    key: "allowIframeClipboard",
    title: "Clipboard writes",
    description:
      "Allow user-triggered copy actions from generated apps through navigator.clipboard.writeText.",
    icon: ClipboardIcon,
    disabledWhenScriptsOff: true,
  },
  {
    key: "allowIframeExternalLinks",
    title: "External links",
    description:
      "Allow generated apps to open external destinations in a new browser tab.",
    icon: ExternalLinkIcon,
  },
];

function sameSettings(
  a: WorkspaceAppRuntimeSettings,
  b: WorkspaceAppRuntimeSettings,
): boolean {
  return (
    a.allowIframeScripts === b.allowIframeScripts &&
    a.allowIframeClipboard === b.allowIframeClipboard &&
    a.allowIframeExternalLinks === b.allowIframeExternalLinks
  );
}

function SettingRow({
  item,
  checked,
  disabled,
  pending,
  effective,
  onChange,
}: {
  item: SettingItem;
  checked: boolean;
  disabled: boolean;
  pending: boolean;
  effective: boolean;
  onChange: (checked: boolean) => void;
}) {
  const Icon = item.icon;

  return (
    <div className="flex items-center gap-4 px-5 py-4">
      <div className="flex size-8 shrink-0 items-center justify-center rounded-md border border-border bg-background text-muted-foreground">
        <Icon className="size-4" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-sm font-medium tracking-tight">{item.title}</h2>
          <Badge variant={effective ? "secondary" : "outline"}>
            {effective ? "Allowed" : "Blocked"}
          </Badge>
          {item.disabledWhenScriptsOff && !effective && checked ? (
            <Badge variant="outline">Requires JavaScript</Badge>
          ) : null}
        </div>
        <p className="mt-1 max-w-2xl text-[13px] leading-relaxed text-muted-foreground">
          {item.description}
        </p>
      </div>
      <Switch
        checked={checked}
        disabled={disabled || pending}
        className={cn(
          "[--toggle-on:oklch(0.62_0.18_148)] [--toggle-ring:oklch(0.62_0.18_148_/_0.24)] dark:[--toggle-on:oklch(0.72_0.19_148)] dark:[--toggle-ring:oklch(0.72_0.19_148_/_0.24)]",
          "[&>span]:bg-white",
          checked &&
            "bg-[var(--toggle-on)] hover:bg-[var(--toggle-on)] focus-visible:ring-[var(--toggle-ring)]",
        )}
        aria-label={`${checked ? "Disable" : "Enable"} ${item.title}`}
        onCheckedChange={onChange}
      />
    </div>
  );
}

export default function RuntimeSettingsClient({
  workspaceId,
  initialData,
}: AppRuntimeSettingsClientProps) {
  const [settings, setSettings] = useState<WorkspaceAppRuntimeSettings>(
    initialData?.settings ?? DEFAULT_WORKSPACE_APP_RUNTIME_SETTINGS,
  );
  const [canManage, setCanManage] = useState(initialData?.canManage ?? false);
  const [loading, setLoading] = useState(!initialData);
  const [saving, setSaving] = useState<SettingKey | null>(null);
  const [error, setError] = useState<string | null>(null);

  const fetchSettings = useCallback(async (options?: { signal?: AbortSignal }) => {
    try {
      const res = await fetch(
        `/api/workspaces/${workspaceId}/runtime-settings`,
        {
          cache: "no-store",
          signal: options?.signal,
        },
      );
      if (options?.signal?.aborted) return;
      if (!res.ok) {
        setError("Could not load app runtime settings.");
        return;
      }
      const data = (await res.json()) as AppRuntimeSettingsReadModel;
      if (options?.signal?.aborted) return;
      setSettings(data.settings);
      setCanManage(data.canManage);
      setError(null);
    } catch {
      if (!options?.signal?.aborted) {
        setError("Could not load app runtime settings.");
      }
    } finally {
      if (!options?.signal?.aborted) setLoading(false);
    }
  }, [workspaceId]);

  useEffect(() => {
    if (initialData) return;
    const controller = new AbortController();
    const unsubscribeNavigation = subscribeNavigationIntent(() => {
      abortForNavigation(controller);
    });
    void fetchSettings({ signal: controller.signal });
    return () => {
      unsubscribeNavigation();
      abortForNavigation(controller, "App runtime settings unmounted.");
    };
  }, [fetchSettings, initialData]);

  useWorkspaceRealtimeEvent(useCallback((event) => {
    if (
      event.workspaceId !== workspaceId ||
      event.scope !== "workspace-settings"
    ) {
      return;
    }
    void fetchSettings();
  }, [fetchSettings, workspaceId]));

  const allDefaults = useMemo(
    () => sameSettings(settings, DEFAULT_WORKSPACE_APP_RUNTIME_SETTINGS),
    [settings],
  );

  const updateSetting = useCallback(async (
    key: SettingKey,
    checked: boolean,
  ) => {
    if (!canManage || saving) return;

    const previous = settings;
    const next = { ...settings, [key]: checked };
    setSettings(next);
    setSaving(key);
    setError(null);

    try {
      const res = await fetch(
        `/api/workspaces/${workspaceId}/runtime-settings`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(next),
        },
      );
      if (!res.ok) {
        setSettings(previous);
        setError("Could not save app runtime settings.");
        toast.error("Could not save app runtime settings.");
        return;
      }
      const data = (await res.json()) as AppRuntimeSettingsReadModel;
      setSettings(data.settings);
      setCanManage(data.canManage);
    } catch {
      setSettings(previous);
      setError("Could not save app runtime settings.");
      toast.error("Could not save app runtime settings.");
    } finally {
      setSaving(null);
    }
  }, [canManage, saving, settings, workspaceId]);

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className="px-8 pt-8 pb-5">
        <div className="mx-auto max-w-5xl">
          <div
            data-second-desktop-drag-region
            className="flex items-start justify-between gap-4"
          >
            <div>
              <h1 className="text-lg font-semibold tracking-tight">
                Runtime settings
              </h1>
              <p className="mt-0.5 text-[13px] text-muted-foreground">
                Control the iframe capabilities granted to apps built inside this workspace.
              </p>
            </div>
            {!canManage ? (
              <Badge variant="outline">Admin or owner required</Badge>
            ) : allDefaults ? (
              <Badge variant="secondary">Default</Badge>
            ) : (
              <Badge variant="outline">Customized</Badge>
            )}
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-8">
        <div className="mx-auto flex max-w-5xl flex-col gap-5 pb-10">
          <div className="rounded-lg border border-border bg-card">
            <div className="flex items-center gap-3 border-b border-border bg-muted/30 px-5 py-3">
              <ShieldCheckIcon className="size-4 text-muted-foreground" />
              <div className="min-w-0">
                <h2 className="text-sm font-medium tracking-tight">
                  Iframe sandbox
                </h2>
                <p className="text-[12px] text-muted-foreground">
                  Second still keeps generated apps isolated from the parent workspace.
                </p>
              </div>
              {loading ? (
                <Loader2Icon className="ml-auto size-4 animate-spin text-muted-foreground" />
              ) : null}
            </div>

            {loading ? (
              <div className="flex items-center justify-center py-16">
                <Loader2Icon className="size-5 animate-spin text-muted-foreground" />
              </div>
            ) : (
              <div className="flex flex-col divide-y divide-border">
                {SETTINGS.map((item) => {
                  const checked = settings[item.key];
                  const effective =
                    item.disabledWhenScriptsOff && !settings.allowIframeScripts
                      ? false
                      : checked;

                  return (
                    <SettingRow
                      key={item.key}
                      item={item}
                      checked={checked}
                      disabled={!canManage}
                      pending={saving !== null}
                      effective={effective}
                      onChange={(value) => updateSetting(item.key, value)}
                    />
                  );
                })}
              </div>
            )}
          </div>

          {error ? (
            <div className="flex items-center gap-3 rounded-lg border border-border bg-muted/30 px-4 py-3">
              <p className="flex-1 text-xs text-muted-foreground">{error}</p>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-7"
                onClick={() => fetchSettings()}
              >
                <RefreshCwIcon data-icon="inline-start" />
                Retry
              </Button>
            </div>
          ) : null}

          <p
            className={cn(
              "max-w-3xl text-[12px] leading-relaxed text-muted-foreground",
              !canManage && "text-muted-foreground/70",
            )}
          >
            Disabling JavaScript is a hardening option for static previews and
            will stop generated React apps, app data hooks, agent hooks, and
            copy buttons from running.
          </p>
        </div>
      </div>
    </div>
  );
}
