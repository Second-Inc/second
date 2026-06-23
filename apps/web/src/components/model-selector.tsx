"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import {
  Check,
  ChevronDown,
  Code2,
  Info,
  Plus,
  Settings2Icon,
  Terminal,
} from "lucide-react";
import { OpenCodeModelDialog } from "@/components/opencode-model-dialog";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  AGENT_RUNTIMES,
  getDefaultRuntimeSettings,
  getModelDisplayName,
  getRuntime,
  normalizeRuntimeSettings,
  type AgentRuntimeSettings,
} from "@/lib/agent/runtime-registry";
import type { OpenCodeDiscoveredModel } from "@/lib/agent/opencode-models";

type ModelSelectorProps = {
  value: AgentRuntimeSettings;
  onChange: (value: AgentRuntimeSettings) => void;
  side?: "top" | "bottom";
};

export function ModelSelector({
  value,
  onChange,
  side = "top",
}: ModelSelectorProps) {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [openCodeDialogOpen, setOpenCodeDialogOpen] = useState(false);
  const [openCodeModels, setOpenCodeModels] = useState<OpenCodeDiscoveredModel[]>([]);
  const selectedRuntime = getRuntime(value.runtimeId);
  const selectedModel = selectedRuntime.models.find((m) => m.id === value.model);
  const selectedOpenCodeModel = value.runtimeId === "opencode"
    ? openCodeModels.find((model) => model.id === value.model)
    : null;
  const selectedLabel =
    selectedModel?.name ?? selectedOpenCodeModel?.name ?? getModelDisplayName(value.model);

  useEffect(() => {
    if (value.runtimeId !== "opencode" && !openCodeDialogOpen) return;

    let cancelled = false;
    void fetch("/api/runtime/opencode/models", { cache: "no-store" })
      .then((res) => res.json())
      .then((data: { models?: OpenCodeDiscoveredModel[] }) => {
        if (!cancelled && Array.isArray(data.models)) {
          setOpenCodeModels(data.models);
        }
      })
      .catch(() => {});

    return () => {
      cancelled = true;
    };
  }, [openCodeDialogOpen, value.runtimeId]);

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="default"
            className="gap-1 text-muted-foreground"
          >
            {selectedLabel}
            <ChevronDown className="size-3" strokeWidth={2} />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" side={side} className="min-w-72">
          <DropdownMenuRadioGroup
            value={`${value.runtimeId}:${value.model}`}
            onValueChange={(nextValue) => {
              const separator = nextValue.indexOf(":");
              const runtimeId = nextValue.slice(0, separator);
              const model = nextValue.slice(separator + 1);
              const runtime = AGENT_RUNTIMES.find(
                (entry) => entry.id === runtimeId,
              );
              if (!runtime || !model) return;
              onChange(
                normalizeRuntimeSettings({
                  ...getDefaultRuntimeSettings(runtime.id),
                  model,
                }),
              );
            }}
          >
            {AGENT_RUNTIMES.map((runtime, index) => (
              <div key={runtime.id}>
                {index > 0 ? <DropdownMenuSeparator /> : null}
                <DropdownMenuLabel className="flex items-center gap-2">
                  {runtime.icon ? (
                    <Image
                      src={runtime.icon}
                      alt=""
                      width={16}
                      height={16}
                      className="rounded-sm"
                    />
                  ) : (
                    <Code2 className="size-3.5 text-muted-foreground" />
                  )}
                  {runtime.name}
                </DropdownMenuLabel>
                {runtime.models.map((model) => (
                  <DropdownMenuRadioItem
                    key={`${runtime.id}:${model.id}`}
                    value={`${runtime.id}:${model.id}`}
                  >
                    <div className="flex min-w-0 flex-col">
                      <span className="text-xs">{model.name}</span>
                      <span className="text-[11px] text-muted-foreground">
                        {model.description}
                      </span>
                    </div>
                    {"experimental" in model && model.experimental ? (
                      <span className="ml-auto rounded-full bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                        Experimental
                      </span>
                    ) : null}
                  </DropdownMenuRadioItem>
                ))}
                {runtime.id === "opencode" &&
                value.runtimeId === "opencode" &&
                !runtime.models.some((model) => model.id === value.model) ? (
                  <DropdownMenuRadioItem
                    key={`opencode:${value.model}`}
                    value={`opencode:${value.model}`}
                  >
                    <div className="flex min-w-0 flex-col">
                      <span className="text-xs">
                        {selectedOpenCodeModel?.name ?? value.model}
                      </span>
                      <span className="text-[11px] text-muted-foreground">
                        {selectedOpenCodeModel?.description ?? "OpenCode model"}
                      </span>
                    </div>
                  </DropdownMenuRadioItem>
                ) : null}
                {runtime.id === "opencode" ? (
                  <DropdownMenuItem
                    onSelect={() => {
                      setOpenCodeDialogOpen(true);
                    }}
                  >
                    <Settings2Icon />
                    <span>Configure OpenCode</span>
                  </DropdownMenuItem>
                ) : null}
              </div>
            ))}
          </DropdownMenuRadioGroup>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => setDialogOpen(true)}>
            <Plus />
            <span>Add provider</span>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      {/* Provider setup dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="overflow-hidden p-0 sm:max-w-md">
          {/* Header */}
          <div className="border-b px-5 py-4 pr-12">
            <DialogHeader>
              <DialogTitle>Providers</DialogTitle>
              <DialogDescription>
                Configure which AI providers Second can use.
              </DialogDescription>
            </DialogHeader>
          </div>

          {/* Body */}
          <div className="flex flex-col gap-3 p-5">
            {/* Local mode note */}
            <div className="flex items-center gap-3 rounded-xl border px-4 py-3">
              <div className="flex size-9 shrink-0 items-center justify-center rounded-lg border bg-muted/40">
                <Info className="size-4 text-muted-foreground" strokeWidth={1.7} />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-[12px] font-medium text-foreground">
                  You are in local mode
                </p>
                <p className="mt-0.5 text-[11px] leading-relaxed text-muted-foreground">
                  In enterprise deployments, providers are pre-configured with
                  your infrastructure settings.{" "}
                  <a
                    href="https://second.so"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="font-medium text-primary underline underline-offset-2"
                  >
                    Learn more
                  </a>
                </p>
              </div>
            </div>

            <div className="px-1 pt-1 text-[12px] font-medium text-foreground">
              Configured
            </div>

            {AGENT_RUNTIMES.map((runtime) => (
              <div key={runtime.id} className="flex flex-col gap-3 rounded-lg border p-4">
                <div className="flex items-center gap-3">
                  {runtime.icon ? (
                    <Image
                      src={runtime.icon}
                      alt={runtime.shortName}
                      width={24}
                      height={24}
                      className="rounded"
                    />
                  ) : (
                    <div className="flex size-6 items-center justify-center rounded border bg-muted">
                      <Terminal className="size-3.5 text-muted-foreground" />
                    </div>
                  )}
                  <span className="flex-1 text-sm font-medium">{runtime.name}</span>
                  {runtime.id === selectedRuntime.id ? (
                    <div className="flex items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-0.5 text-emerald-600 dark:text-emerald-400">
                      <Check className="size-3" strokeWidth={2.5} />
                      <span className="text-[11px] font-medium">Selected</span>
                    </div>
                  ) : null}
                </div>
                <div className="text-xs leading-relaxed text-muted-foreground">
                  <a
                    href={runtime.docsUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="underline underline-offset-2"
                  >
                    Setup docs
                  </a>
                  {" — "}
                  {runtime.description}
                </div>
              </div>
            ))}
          </div>
        </DialogContent>
      </Dialog>

      <OpenCodeModelDialog
        open={openCodeDialogOpen}
        value={value.runtimeId === "opencode" ? value : getDefaultRuntimeSettings("opencode")}
        onOpenChange={setOpenCodeDialogOpen}
        onChange={onChange}
        onModelsLoaded={setOpenCodeModels}
      />
    </>
  );
}
