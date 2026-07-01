"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import {
  CheckIcon,
  ChevronLeftIcon,
  ExternalLinkIcon,
  GitBranchIcon,
  KeyRoundIcon,
  Loader2Icon,
  LockIcon,
  MoreHorizontalIcon,
  RefreshCwIcon,
  Trash2Icon,
  TriangleAlertIcon,
} from "lucide-react";
import { toast } from "sonner";
import {
  Alert,
  AlertAction,
  AlertDescription,
} from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { useWorkspaceRealtimeEvent } from "@/components/workspace-realtime-provider";
import type { SourceControlSettingsReadModel } from "@/lib/workspace-settings/read-models";
import {
  abortForNavigation,
  subscribeNavigationIntent,
} from "@/lib/navigation-intent";
import { cn } from "@/lib/utils";

type GitHubSourceControlClientProps = {
  workspaceId: string;
  initialData: SourceControlSettingsReadModel | null;
};

type SetupChoice = {
  name: string;
  selection: string;
  description: string;
};

type SetupImage = {
  id?: string;
  src: string;
  alt: string;
};

type SetupStep = {
  title: string;
  description: string;
  url?: string;
  choices?: SetupChoice[];
  image?: SetupImage;
};

const SETUP_STEPS: SetupStep[] = [
  {
    title: "Choose the repository owner",
    description:
      "Use the GitHub user or organization that should own Second app repositories.",
  },
  {
    title: "Create a fine-grained token",
    description:
      "Create the token for that owner. Organization approval may be required.",
    url: "https://github.com/settings/personal-access-tokens/new",
  },
  {
    title: "Set repository access",
    description:
      "Choose All repositories for the normal setup, because Second creates new app repositories over time.",
    image: {
      id: "repository-access",
      src: "/images/source-control/github-repository-access.png",
      alt: "GitHub fine-grained token Repository access section with All repositories selected.",
    },
  },
  {
    title: "Add repository permissions",
    description:
      "In Add permissions, stay on Repositories and add these permissions:",
    choices: [
      {
        name: "Administration",
        selection: "Read and write",
        description: "Allows Second to create app repositories.",
      },
      {
        name: "Contents",
        selection: "Read and write",
        description: "Allows Second to commit app source files.",
      },
    ],
    image: {
      id: "permissions",
      src: "/images/source-control/github-permissions.png",
      alt: "GitHub fine-grained token Permissions section with repository permissions selected.",
    },
  },
  {
    title: "Save the connection",
    description:
      "Paste the owner and token below. Second stores the token server-side and never returns it to the browser or worker.",
  },
];

function statusBadge(status: string) {
  if (status === "valid") {
    return (
      <Badge variant="secondary">
        <CheckIcon data-icon="inline-start" />
        Connected
      </Badge>
    );
  }
  if (status === "invalid" || status === "revoked") {
    return (
      <Badge variant="destructive">
        <TriangleAlertIcon data-icon="inline-start" />
        Reconnect
      </Badge>
    );
  }
  return <Badge variant="outline">Not connected</Badge>;
}

function GitHubLogo({ className }: { className?: string }) {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src="/icons/source-control-github.svg"
      alt=""
      className={cn("shrink-0 text-foreground", className)}
    />
  );
}

function SetupChoices({ choices }: { choices: SetupChoice[] }) {
  return (
    <div className="mt-3 grid gap-2 sm:grid-cols-2">
      {choices.map((choice) => (
        <div
          key={choice.name}
          className="rounded-md border border-border/70 bg-muted/20 p-3"
        >
          <div className="flex flex-wrap items-center gap-2">
            <div className="text-[13px] font-medium leading-none">
              {choice.name}
            </div>
            <Badge
              variant="secondary"
              className="h-5 rounded-md px-1.5 text-[11px] font-medium leading-none"
            >
              {choice.selection}
            </Badge>
          </div>
          <p className="mt-2 text-[12px] leading-relaxed text-muted-foreground">
            {choice.description}
          </p>
        </div>
      ))}
    </div>
  );
}

function SetupScreenshot({ image }: { image: SetupImage }) {
  return (
    <figure
      id={image.id}
      className="mt-3 overflow-hidden rounded-lg border border-border/70 bg-background p-1.5 shadow-lg"
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={image.src}
        alt={image.alt}
        className="block w-full rounded-md"
      />
    </figure>
  );
}

export default function GitHubSourceControlClient({
  workspaceId,
  initialData,
}: GitHubSourceControlClientProps) {
  const [data, setData] = useState<SourceControlSettingsReadModel | null>(
    initialData,
  );
  const [loading, setLoading] = useState(!initialData);
  const [saving, setSaving] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [targetOwner, setTargetOwner] = useState(
    initialData?.connection?.targetOwner ?? "",
  );
  const [token, setToken] = useState("");
  const [repoNamePrefix, setRepoNamePrefix] = useState(
    initialData?.connection?.repoNamePrefix ?? "",
  );
  const [defaultVisibility, setDefaultVisibility] =
    useState<"private" | "public">(
      initialData?.connection?.defaultVisibility ?? "private",
    );

  const sourceControlHref = `/w/${workspaceId}/settings/source-control`;

  const fetchSettings = useCallback(async (options?: { signal?: AbortSignal }) => {
    try {
      const response = await fetch(
        `/api/workspaces/${workspaceId}/source-control`,
        {
          cache: "no-store",
          signal: options?.signal,
        },
      );
      if (options?.signal?.aborted) return;
      if (!response.ok) {
        setError("Could not load source control settings.");
        return;
      }
      const next = (await response.json()) as SourceControlSettingsReadModel;
      if (options?.signal?.aborted) return;
      setData(next);
      setTargetOwner(next.connection?.targetOwner ?? "");
      setRepoNamePrefix(next.connection?.repoNamePrefix ?? "");
      setDefaultVisibility(next.connection?.defaultVisibility ?? "private");
      setError(null);
    } catch {
      if (!options?.signal?.aborted) {
        setError("Could not load source control settings.");
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
      abortForNavigation(controller, "GitHub source control settings unmounted.");
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

  const save = useCallback(async () => {
    if (!data?.canManage || saving) return;
    if (!targetOwner.trim()) {
      setError("Enter the GitHub user or organization that will own app repos.");
      return;
    }
    if (!data.connection && !token.trim()) {
      setError("Paste a GitHub personal access token.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const response = await fetch(
        `/api/workspaces/${workspaceId}/source-control/github`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            targetOwner,
            token: token.trim() || undefined,
            defaultVisibility,
            repoNamePrefix: repoNamePrefix.trim() || null,
            sourceStorageMode:
              data.connection?.sourceStorageMode === "source_control"
                ? "source_control"
                : "mongo",
          }),
        },
      );
      const body = (await response.json().catch(() => null)) as
        | { message?: string }
        | null;
      if (!response.ok) {
        const message = body?.message ?? "Could not connect GitHub.";
        setError(message);
        toast.error(message);
        return;
      }
      setToken("");
      toast.success("GitHub source control connected.");
      await fetchSettings();
    } catch {
      setError("Could not connect GitHub.");
      toast.error("Could not connect GitHub.");
    } finally {
      setSaving(false);
    }
  }, [
    data?.canManage,
    data?.connection,
    defaultVisibility,
    fetchSettings,
    repoNamePrefix,
    saving,
    targetOwner,
    token,
    workspaceId,
  ]);

  const disconnect = useCallback(async () => {
    if (!data?.canManage || disconnecting) return;
    setDisconnecting(true);
    setError(null);
    try {
      const response = await fetch(
        `/api/workspaces/${workspaceId}/source-control/github`,
        { method: "DELETE" },
      );
      if (!response.ok) {
        setError("Could not disconnect GitHub.");
        toast.error("Could not disconnect GitHub.");
        return;
      }
      setToken("");
      toast.success("GitHub source control disconnected.");
      await fetchSettings();
    } catch {
      setError("Could not disconnect GitHub.");
      toast.error("Could not disconnect GitHub.");
    } finally {
      setDisconnecting(false);
    }
  }, [data?.canManage, disconnecting, fetchSettings, workspaceId]);

  const canManage = data?.canManage ?? false;
  const connection = data?.connection ?? null;
  const status = connection?.status ?? "not_configured";

  if (loading) {
    return (
      <div className="flex h-full flex-col overflow-hidden">
        <div className="flex flex-1 items-center justify-center">
          <Loader2Icon className="size-5 animate-spin text-muted-foreground" />
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className="flex-1 overflow-y-auto px-8 py-8">
        <div
          className="mx-auto max-w-3xl pb-12 opacity-0 animate-fade-in-up"
          style={{ animationDuration: "0.25s" }}
        >
          <Button asChild variant="ghost" size="sm" className="-ml-2 gap-1.5">
            <Link href={sourceControlHref}>
              <ChevronLeftIcon data-icon="inline-start" />
              Source Control
            </Link>
          </Button>

          <div className="mt-8 flex items-start justify-between gap-4">
            <div className="flex min-w-0 items-start gap-4">
              <div className="flex size-16 shrink-0 items-center justify-center rounded-xl border border-border bg-white p-3 shadow-sm">
                <GitHubLogo className="size-10" />
              </div>
              <div className="min-w-0">
                <h1 className="text-2xl font-semibold tracking-tight">
                  Connect GitHub source control
                </h1>
                <div className="mt-2 flex min-h-6 flex-wrap items-center gap-2 text-sm text-muted-foreground">
                  <span className="inline-flex h-6 items-center leading-none text-foreground">
                    GitHub
                  </span>
                  <span className="inline-flex h-6 items-center font-mono text-xs mt-[1px] leading-none">
                    github.com
                  </span>
                  {statusBadge(status)}
                </div>
              </div>
            </div>

            {connection ? (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    disabled={!canManage || disconnecting}
                  >
                    <MoreHorizontalIcon />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem
                    onClick={disconnect}
                    disabled={!canManage || disconnecting}
                  >
                    {disconnecting ? (
                      <Loader2Icon className="animate-spin" />
                    ) : (
                      <Trash2Icon />
                    )}
                    Disconnect
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            ) : null}
          </div>

          {error ? (
            <Alert variant="destructive" className="mt-5">
              <TriangleAlertIcon />
              <AlertDescription>{error}</AlertDescription>
              <AlertAction>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => fetchSettings()}
                >
                  <RefreshCwIcon data-icon="inline-start" />
                  Retry
                </Button>
              </AlertAction>
            </Alert>
          ) : null}

          <form
            className="mt-8 flex flex-col gap-6"
            onSubmit={(event) => {
              event.preventDefault();
              void save();
            }}
          >
            <div className="flex flex-col gap-5 rounded-lg border border-border/70 p-4">
              {SETUP_STEPS.map((step, index) => (
                <div key={step.title} className="flex gap-3">
                  <div className="flex size-6 shrink-0 items-center justify-center rounded-full border border-border text-[11px] font-medium text-muted-foreground">
                    {index + 1}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="text-[13px] font-medium leading-relaxed">
                      {step.title}
                    </div>
                    <p className="mt-0.5 text-[13px] leading-relaxed text-muted-foreground">
                      {step.description}
                    </p>
                    {step.choices ? (
                      <SetupChoices choices={step.choices} />
                    ) : null}
                    {step.image ? <SetupScreenshot image={step.image} /> : null}
                    {step.url ? (
                      <Button
                        asChild
                        variant="link"
                        size="sm"
                        className="mt-1 h-auto px-0"
                      >
                        <a href={step.url} target="_blank" rel="noreferrer">
                          Open link
                          <ExternalLinkIcon data-icon="inline-end" />
                        </a>
                      </Button>
                    ) : null}
                  </div>
                </div>
              ))}
            </div>

            <FieldGroup className="gap-6 rounded-lg border border-border/70 p-4">
              <Field data-disabled={!canManage || saving}>
                <FieldLabel htmlFor="source-control-owner">Owner</FieldLabel>
                <Input
                  id="source-control-owner"
                  value={targetOwner}
                  onChange={(event) => setTargetOwner(event.target.value)}
                  placeholder="acme"
                  disabled={!canManage || saving}
                />
                <FieldDescription>
                  GitHub user or organization that owns Second app repositories.
                </FieldDescription>
              </Field>

              <Field data-disabled={!canManage || saving}>
                <FieldLabel htmlFor="source-control-token">
                  Personal access token
                </FieldLabel>
                <Input
                  id="source-control-token"
                  value={token}
                  onChange={(event) => setToken(event.target.value)}
                  placeholder={
                    connection
                      ? "Leave blank to keep current token"
                      : "github_pat_..."
                  }
                  type="password"
                  disabled={!canManage || saving}
                  data-sentry-mask
                />
                <FieldDescription>
                  Stored in {data?.runtime.secretStorage ?? "secret storage"}.
                </FieldDescription>
              </Field>
            </FieldGroup>

            <FieldGroup className="gap-6 rounded-lg border border-border/70 p-4">
              <Field data-disabled={!canManage || saving}>
                <FieldLabel htmlFor="source-control-repo-prefix">
                  Repo name prefix
                </FieldLabel>
                <Input
                  id="source-control-repo-prefix"
                  value={repoNamePrefix}
                  onChange={(event) => setRepoNamePrefix(event.target.value)}
                  placeholder="second"
                  disabled={!canManage || saving}
                />
                <FieldDescription>
                  Optional prefix for new app repositories.
                </FieldDescription>
              </Field>

              <Field data-disabled={!canManage || saving}>
                <FieldLabel>Default visibility</FieldLabel>
                <div className="flex gap-2">
                  {(["private", "public"] as const).map((visibility) => (
                    <Button
                      key={visibility}
                      type="button"
                      variant={
                        defaultVisibility === visibility ? "secondary" : "outline"
                      }
                      size="lg"
                      disabled={!canManage || saving}
                      onClick={() => setDefaultVisibility(visibility)}
                    >
                      {visibility === "private" ? (
                        <LockIcon data-icon="inline-start" />
                      ) : (
                        <GitBranchIcon data-icon="inline-start" />
                      )}
                      {visibility}
                    </Button>
                  ))}
                </div>
                <FieldDescription>
                  Private is the recommended default for internal apps.
                </FieldDescription>
              </Field>
            </FieldGroup>

            {!canManage ? (
              <p className="rounded-md border border-amber-500/30 bg-amber-500/10 px-2.5 py-2 text-xs text-amber-700 dark:text-amber-300">
                An admin or owner must configure source control.
              </p>
            ) : null}

            <div className="flex items-center justify-end gap-2">
              {connection?.connectedAccountLogin ? (
                <span className="mr-auto font-mono text-[11px] text-muted-foreground">
                  @{connection.connectedAccountLogin} -{" "}
                  {connection.targetOwner}
                </span>
              ) : null}
              <Button
                type="submit"
                size="lg"
                className="px-5 text-sm"
                disabled={!canManage || saving}
              >
                {saving ? (
                  <Loader2Icon
                    data-icon="inline-start"
                    className="animate-spin"
                  />
                ) : (
                  <KeyRoundIcon data-icon="inline-start" />
                )}
                {connection ? "Save connection" : "Connect GitHub"}
              </Button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
