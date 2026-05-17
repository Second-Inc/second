"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  ArrowUp,
  Sparkles,
  Upload,
} from "lucide-react";
import { AppLoader } from "@/components/app-loader";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { ModelSelector } from "@/components/model-selector";
import { SkillPicker, SkillChips } from "@/components/skill-picker";
import { AgentSelector } from "@/components/agent-selector";
import { ImportAppDialog } from "@/components/import-app-dialog";
import { RuntimeParameterSelectors } from "@/components/runtime-parameter-selectors";
import {
  AttachmentDropOverlay,
  ComposerAttachmentList,
  createComposerAttachment,
  useWindowFileDrop,
  type ComposerAttachment,
} from "@/components/composer-attachments";
import {
  MAX_ATTACHMENT_FILE_BYTES,
  MAX_ATTACHMENT_FILES,
  MAX_ATTACHMENT_TOTAL_BYTES,
  formatAttachmentSize,
} from "@/lib/attachments";
import {
  DEFAULT_RUNTIME_SETTINGS,
  normalizeRuntimeSettings,
  readPreferredRuntimeSettings,
  writePreferredRuntimeSettings,
} from "@/lib/agent/runtime-registry";
import {
  captureAnalyticsEvent,
  runtimeModelFamily,
  textAnalyticsProperties,
} from "@/lib/analytics";

type SkillRef = {
  _id: string;
  slug: string;
  displayName: string;
  description: string;
};

type AgentSelection = {
  _id: string;
  displayName: string;
};

type AppComposerProps = {
  workspaceId: string;
  value: string;
  onChange: (value: string) => void;
  textareaRef: React.RefObject<HTMLTextAreaElement | null>;
  initialAgentId?: string | null;
  initialAgent?: AgentSelection | null;
};

const SUGGESTION_PROMPT = "Suggest something for us to build!";
const IMPORT_EXISTING_APP_PROMPT =
  "Convert this project into a fully functional second app. Identify key files first and map the data schemas.";
const AGENT_SELECTED_HINT_DELAY_MS = 1100;

export function AppComposer({
  workspaceId,
  value,
  onChange,
  textareaRef,
  initialAgentId = null,
  initialAgent = null,
}: AppComposerProps) {
  const router = useRouter();
  const resolvedInitialAgentId = initialAgent?._id ?? initialAgentId;
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [runtimePreferenceLoaded, setRuntimePreferenceLoaded] = useState(false);
  const [runtimeSettings, setRuntimeSettings] = useState(DEFAULT_RUNTIME_SETTINGS);
  const [selectedSkills, setSelectedSkills] = useState<SkillRef[]>([]);
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(
    resolvedInitialAgentId,
  );
  const [selectedAgent, setSelectedAgent] = useState<AgentSelection | null>(
    initialAgent,
  );
  const [showAgentSelectedHint, setShowAgentSelectedHint] = useState(
    Boolean(resolvedInitialAgentId),
  );
  const [agentSelectedHintReady, setAgentSelectedHintReady] = useState(false);
  const [agentSelectorOpen, setAgentSelectorOpen] = useState(false);
  const [attachments, setAttachments] = useState<ComposerAttachment[]>([]);
  const [importDialogOpen, setImportDialogOpen] = useState(false);
  const composerWindowRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleSkillSelect = (skill: SkillRef) => {
    setSubmitError(null);
    setSelectedSkills((prev) =>
      prev.some((s) => s._id === skill._id) ? prev : [...prev, skill],
    );
  };

  const handleSkillRemove = (skillId: string) => {
    setSubmitError(null);
    setSelectedSkills((prev) => prev.filter((s) => s._id !== skillId));
  };

  const handleAgentChange = useCallback((agentId: string | null) => {
    setSubmitError(null);
    setSelectedAgentId(agentId);
    setShowAgentSelectedHint(false);
  }, []);

  const handleSelectedAgentChange = useCallback(
    (agent: AgentSelection | null) => {
      setSelectedAgent(agent ? {
        _id: agent._id,
        displayName: agent.displayName,
      } : null);
    },
    [],
  );

  const handleSuggestSomething = useCallback(() => {
    setSubmitError(null);
    onChange(SUGGESTION_PROMPT);
    requestAnimationFrame(() => {
      const textarea = textareaRef.current;
      textarea?.focus();
      textarea?.setSelectionRange(SUGGESTION_PROMPT.length, SUGGESTION_PROMPT.length);
    });
  }, [onChange, textareaRef]);

  const handleImportPrompt = useCallback(() => {
    setSubmitError(null);
    setShowAgentSelectedHint(false);
    onChange(IMPORT_EXISTING_APP_PROMPT);
    requestAnimationFrame(() => {
      const textarea = textareaRef.current;
      textarea?.focus();
      textarea?.setSelectionRange(
        IMPORT_EXISTING_APP_PROMPT.length,
        IMPORT_EXISTING_APP_PROMPT.length,
      );
    });
  }, [onChange, textareaRef]);

  useEffect(() => {
    const nextAgentId = initialAgent?._id ?? initialAgentId;
    setSelectedAgentId(nextAgentId);
    if (initialAgent) {
      setSelectedAgent(initialAgent);
    } else if (!nextAgentId) {
      setSelectedAgent(null);
    }
    setShowAgentSelectedHint(Boolean(nextAgentId));
  }, [initialAgent, initialAgentId]);

  useEffect(() => {
    setRuntimeSettings(readPreferredRuntimeSettings());
    setRuntimePreferenceLoaded(true);
  }, []);

  useEffect(() => {
    if (!showAgentSelectedHint || !selectedAgent) {
      setAgentSelectedHintReady(false);
      return;
    }

    setAgentSelectedHintReady(false);
    const timeout = window.setTimeout(() => {
      setAgentSelectedHintReady(true);
    }, AGENT_SELECTED_HINT_DELAY_MS);

    return () => window.clearTimeout(timeout);
  }, [selectedAgent, showAgentSelectedHint]);

  useEffect(() => {
    if (!showAgentSelectedHint) return;

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (composerWindowRef.current?.contains(target)) return;
      setShowAgentSelectedHint(false);
    };

    document.addEventListener("pointerdown", handlePointerDown, true);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown, true);
    };
  }, [showAgentSelectedHint]);

  useEffect(() => {
    if (!runtimePreferenceLoaded) return;
    const normalized = normalizeRuntimeSettings(runtimeSettings);
    if (
      normalized.runtimeId !== runtimeSettings.runtimeId ||
      normalized.model !== runtimeSettings.model ||
      JSON.stringify(normalized.params) !== JSON.stringify(runtimeSettings.params)
    ) {
      setRuntimeSettings(normalized);
      writePreferredRuntimeSettings(normalized);
      return;
    }
    writePreferredRuntimeSettings(runtimeSettings);
  }, [runtimePreferenceLoaded, runtimeSettings]);

  const addFiles = useCallback((files: File[]) => {
    setSubmitError(null);
    const remainingSlots = MAX_ATTACHMENT_FILES - attachments.length;
    if (remainingSlots <= 0) {
      toast.error(`You can attach up to ${MAX_ATTACHMENT_FILES} files.`);
      return 0;
    }

    const currentBytes = attachments.reduce((sum, item) => sum + item.size, 0);
    const accepted: File[] = [];
    let nextBytes = currentBytes;

    for (const file of files.slice(0, remainingSlots)) {
      if (file.size > MAX_ATTACHMENT_FILE_BYTES) {
        toast.error(`${file.name} is too large.`, {
          description: `Each file can be up to ${formatAttachmentSize(MAX_ATTACHMENT_FILE_BYTES)}.`,
        });
        continue;
      }
      if (nextBytes + file.size > MAX_ATTACHMENT_TOTAL_BYTES) {
        toast.error("Attachment upload is too large.", {
          description: `Total attachments can be up to ${formatAttachmentSize(MAX_ATTACHMENT_TOTAL_BYTES)}.`,
        });
        break;
      }
      accepted.push(file);
      nextBytes += file.size;
    }

    if (files.length > remainingSlots) {
      toast.error(`Only ${remainingSlots} more file${remainingSlots === 1 ? "" : "s"} can be attached.`);
    }
    if (accepted.length === 0) return 0;
    setAttachments((current) => [
      ...current,
      ...accepted.map(createComposerAttachment),
    ]);
    return accepted.length;
  }, [attachments]);

  const isDraggingFiles = useWindowFileDrop({
    enabled: !isSubmitting,
    onFiles: addFiles,
  });

  const removeAttachment = useCallback((id: string) => {
    setSubmitError(null);
    setAttachments((current) => current.filter((item) => item.id !== id));
  }, []);

  const canSubmit = Boolean(value.trim() || attachments.length > 0);
  const agentSelectedHintOpen =
    agentSelectedHintReady &&
    showAgentSelectedHint &&
    Boolean(selectedAgent) &&
    !agentSelectorOpen;

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();

    const prompt = value.trim() || "Use the attached files.";
    if (!prompt || !canSubmit || isSubmitting) return;

    setShowAgentSelectedHint(false);
    setIsSubmitting(true);
    setSubmitError(null);

    const appName = "New app";

    try {
      if (attachments.length > 0) {
        setAttachments((current) =>
          current.map((attachment) => ({
            ...attachment,
            status: attachment.file ? "uploading" : attachment.status,
            error: undefined,
          })),
        );
      }

      const appRes =
        attachments.length > 0
          ? await (() => {
              const formData = new FormData();
              formData.append("response", "json");
              formData.append("appName", appName);
              formData.append("prompt", prompt);
              formData.append("runtimeId", runtimeSettings.runtimeId);
              formData.append("runtimeModel", runtimeSettings.model);
              formData.append(
                "runtimeParams",
                JSON.stringify(runtimeSettings.params),
              );
              formData.append("createInitialRun", "true");
              if (selectedAgentId) {
                formData.append("selectedAgentId", selectedAgentId);
              }
              formData.append(
                "selectedSkillIds",
                JSON.stringify(selectedSkills.map((skill) => skill._id)),
              );
              formData.append(
                "attachmentIds",
                JSON.stringify(attachments.map((attachment) => attachment.id)),
              );
              for (const attachment of attachments) {
                if (attachment.file) {
                  formData.append("files", attachment.file, attachment.name);
                }
              }
              return fetch(`/api/workspaces/${workspaceId}/apps`, {
                method: "POST",
                body: formData,
              });
            })()
          : await fetch(`/api/workspaces/${workspaceId}/apps`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                appName,
                prompt,
                runtimeId: runtimeSettings.runtimeId,
                runtimeModel: runtimeSettings.model,
                runtimeParams: runtimeSettings.params,
                createInitialRun: true,
                selectedAgentId,
                selectedSkillIds: selectedSkills.map((skill) => skill._id),
              }),
            });

      if (!appRes.ok) {
        const payload = (await appRes.json().catch(() => null)) as
          | { error?: string }
          | null;

        if (payload?.error === "agent_not_found") {
          setSelectedAgentId(null);
          throw new Error(
            "This agent changed and needs approval before it can run.",
          );
        }

        if (payload?.error === "skill_not_found") {
          throw new Error(
            "One of the selected skills is no longer available to you.",
          );
        }

        throw new Error("Failed to create app.");
      }

      const app = await appRes.json();
      const appId = app.id;
      if (!app.initialRun?.id) {
        throw new Error("Failed to create initial run");
      }
      const initialRunStatus = app.initialRun.status ?? "pending";
      captureAnalyticsEvent("chat initiated", {
        workspace_id: workspaceId,
        app_id: appId,
        app_name: app.name ?? appName,
        run_id: app.initialRun.id,
        source: "workspace_home",
        agent_type: selectedAgentId ? "workspace_agent" : "builder",
        agent_id: selectedAgentId,
        agent_name: selectedAgent?.displayName,
        runtime_id: runtimeSettings.runtimeId,
        runtime_model: runtimeSettings.model,
        runtime_model_family: runtimeModelFamily(runtimeSettings.model),
        selected_skill_count: selectedSkills.length,
        attachment_count: attachments.length,
        ...textAnalyticsProperties("message", prompt),
      });

      window.dispatchEvent(
        new CustomEvent("second:app-created", {
          detail: {
            workspaceId,
            app: {
              _id: appId,
              name: app.name ?? appName,
              runStatus: initialRunStatus,
              toolRecoveryStatus: null,
              publishStatus: "draft",
              hasPublishedVersion: false,
              canManage: true,
            },
          },
        }),
      );

      // 3. Navigate to the app page (which will auto-send the first message).
      // The sidebar is updated optimistically above so we do not need a
      // post-navigation refresh that can interrupt chat initialization.
      router.push(`/w/${workspaceId}/apps/${appId}`);
    } catch (err) {
      console.error("Failed to create app:", err);
      setSubmitError(
        err instanceof Error ? err.message : "Failed to create app.",
      );
      setAttachments((current) =>
        current.map((attachment) =>
          attachment.status === "uploading"
            ? {
                ...attachment,
                status: "error",
                error: "Upload failed. Remove the file or try again.",
              }
            : attachment,
        ),
      );
      setIsSubmitting(false);
    }
  };

  return (
    <div className="flex w-full max-w-[720px] flex-col items-center gap-4">
      <AttachmentDropOverlay visible={isDraggingFiles} />
      <form onSubmit={handleSubmit} className="w-full">
        {/* Gradient border wrapper */}
        <div className="relative rounded-2xl">
          {/* One-time swoosh + glow on page load */}
          <div className="composer-gradient-border absolute -inset-[1px] rounded-2xl" />
          <div className="composer-focus-glow absolute -inset-1.5 rounded-2xl" />

          <div
            ref={composerWindowRef}
            className="relative flex flex-col rounded-2xl bg-[var(--composer-bg)]"
            style={{ boxShadow: "var(--composer-shadow)" }}
          >

            {/* Skill chips */}
            {selectedSkills.length > 0 && (
              <div className="px-[18px] pt-3">
                <SkillChips
                  skills={selectedSkills}
                  onRemove={handleSkillRemove}
                />
              </div>
            )}
            <ComposerAttachmentList
              attachments={attachments}
              onRemove={removeAttachment}
              className="px-[18px] pt-3"
            />
            <textarea
              ref={textareaRef}
              name="prompt"
              placeholder={
                selectedAgentId
                  ? "Ask your agent anything..."
                  : "Describe your app or workflow..."
              }
              rows={3}
              value={value}
              onChange={(e) => {
                setSubmitError(null);
                setShowAgentSelectedHint(false);
                onChange(e.target.value);
              }}
              onKeyDown={(e) => {
                if (e.key !== "Enter" || (!e.metaKey && !e.ctrlKey)) return;
                e.preventDefault();
                e.currentTarget.form?.requestSubmit();
              }}
              disabled={isSubmitting}
              className="w-full resize-none bg-transparent px-[22px] pt-[18px] pb-2 text-sm outline-none placeholder:text-muted-foreground disabled:opacity-50"
              style={{ fontFamily: "inherit" }}
            />
            <div className="flex items-center justify-between px-3.5 pb-3 pt-1">
              <div className="flex items-center gap-1">
                <Tooltip open={agentSelectedHintOpen}>
                  <TooltipTrigger asChild>
                    <div className="inline-flex">
                      <AgentSelector
                        workspaceId={workspaceId}
                        value={selectedAgentId}
                        onChange={handleAgentChange}
                        onSelectedAgentChange={handleSelectedAgentChange}
                        onOpenChange={(open) => {
                          setAgentSelectorOpen(open);
                          if (open) setShowAgentSelectedHint(false);
                        }}
                        side="bottom"
                      />
                    </div>
                  </TooltipTrigger>
                  <TooltipContent
                    side="top"
                    sideOffset={8}
                    className="font-medium"
                  >
                    {selectedAgent?.displayName} is now selected.
                  </TooltipContent>
                </Tooltip>
                <div className="mx-0.5 h-4 w-px bg-border" />
                <SkillPicker
                  workspaceId={workspaceId}
                  selectedSkills={selectedSkills}
                  onSelect={handleSkillSelect}
                  onRemove={handleSkillRemove}
                  side="bottom"
                />
                <ModelSelector
                  value={runtimeSettings}
                  onChange={(next) => {
                    setSubmitError(null);
                    setRuntimeSettings(next);
                  }}
                />
                <RuntimeParameterSelectors
                  value={runtimeSettings}
                  onChange={(next) => {
                    setSubmitError(null);
                    setRuntimeSettings(next);
                  }}
                  side="bottom"
                />
              </div>

              <Button
                type="submit"
                size="icon-lg"
                className="rounded-full bg-foreground text-background hover:bg-foreground/80"
                disabled={isSubmitting || !canSubmit}
                aria-label={isSubmitting ? (selectedAgentId ? "Starting" : "Building") : "Submit"}
              >
                {isSubmitting ? (
                  <AppLoader size="xs" interactive={false} />
                ) : (
                  <ArrowUp className="size-4" strokeWidth={2.5} />
                )}
              </Button>
            </div>
            {submitError && (
              <p
                role="alert"
                className="px-[18px] pb-3 text-xs text-destructive"
              >
                {submitError}
              </p>
            )}
          </div>
        </div>
      </form>
      <input
        ref={fileInputRef}
        type="file"
        multiple
        className="hidden"
        onChange={(event) => {
          const acceptedCount = addFiles(
            Array.from(event.currentTarget.files ?? []),
          );
          if (acceptedCount > 0) handleImportPrompt();
          event.currentTarget.value = "";
        }}
      />

      <ImportAppDialog
        open={importDialogOpen}
        onOpenChange={setImportDialogOpen}
        onUpload={() => {
          captureAnalyticsEvent("import existing app triggered", {
            workspace_id: workspaceId,
            trigger: "upload_files",
          });
          fileInputRef.current?.click();
        }}
      />

      <div className="flex flex-wrap justify-center gap-2">
        <Button
          type="button"
          variant="outline"
          size="default"
          className="rounded-full"
          onClick={() => {
            captureAnalyticsEvent("import existing app clicked", {
              workspace_id: workspaceId,
            });
            setImportDialogOpen(true);
          }}
          disabled={isSubmitting}
        >
          <Upload className="size-3" strokeWidth={1.8} />
          Import existing app
          <span className="ml-0.5 flex items-center gap-1 opacity-60" aria-hidden="true">
            <Image
              src="/icons/lovable.svg"
              alt=""
              width={12}
              height={12}
              className="size-3 grayscale"
            />
            <Image
              src="/icons/base44-icon.svg"
              alt=""
              width={12}
              height={12}
              className="size-3 grayscale"
            />
          </span>
        </Button>
        <Button
          type="button"
          variant="outline"
          size="default"
          className="rounded-full"
          onClick={handleSuggestSomething}
          disabled={isSubmitting}
        >
          <Sparkles className="size-3" strokeWidth={1.8} />
          Suggest something for me
          <Badge
            variant="outline"
            className="ml-1 border-transparent bg-[#eaf8ef] px-1.5 text-[10px] text-emerald-700 dark:bg-emerald-400/10 dark:text-emerald-300"
          >
            Recommended
          </Badge>
        </Button>
      </div>
    </div>
  );
}
