"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  BrainIcon,
  CheckIcon,
  CpuIcon,
  GaugeIcon,
  RefreshCwIcon,
  SearchIcon,
  SlidersHorizontalIcon,
  TerminalIcon,
  WrenchIcon,
  XCircleIcon,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { Slider } from "@/components/ui/slider";
import {
  normalizeOpenCodeVariant,
  openCodeVariantOptions,
  type OpenCodeDiscoveredModel,
  type OpenCodeModelDiscoveryResult,
  type OpenCodeModelSupportStatus,
} from "@/lib/agent/opencode-models";
import {
  normalizeRuntimeSettings,
  type AgentRuntimeSettings,
} from "@/lib/agent/runtime-registry";
import { cn } from "@/lib/utils";

type OpenCodeModelDialogProps = {
  open: boolean;
  value: AgentRuntimeSettings;
  onOpenChange: (open: boolean) => void;
  onChange: (value: AgentRuntimeSettings) => void;
  onModelsLoaded?: (models: OpenCodeDiscoveredModel[]) => void;
};

const GROUP_LABELS: Record<OpenCodeModelSupportStatus, string> = {
  supported: "Supported",
  recommended: "Recommended",
  available: "Available",
};

const SUPPORT_BADGE_VARIANT: Record<
  OpenCodeModelSupportStatus,
  "default" | "secondary" | "outline"
> = {
  supported: "default",
  recommended: "secondary",
  available: "outline",
};

const VARIANT_DESCRIPTIONS: Record<string, string> = {
  auto: "Use the model's OpenCode default.",
  none: "Disable extra reasoning when the model supports it.",
  low: "Faster responses with lighter reasoning.",
  medium: "Balanced speed and reasoning depth.",
  high: "Deeper reasoning for app-building work.",
  xhigh: "Extra reasoning for complex OpenAI-backed runs.",
  max: "Maximum reasoning level exposed by OpenCode.",
};

function formatTokenLimit(value: number | undefined): string | null {
  if (!value) return null;
  if (value >= 1_000_000) {
    return `${Number(value / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
  }
  if (value >= 1_000) return `${Math.round(value / 1_000)}K`;
  return String(value);
}

function formatVariant(value: string): string {
  if (value === "auto") return "Auto";
  if (value === "xhigh") return "Extra high";
  return value.slice(0, 1).toUpperCase() + value.slice(1);
}

function variantDescription(value: string): string {
  return VARIANT_DESCRIPTIONS[value] ?? "OpenCode model variant.";
}

function modelMatches(model: OpenCodeDiscoveredModel, query: string): boolean {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return true;
  return [
    model.id,
    model.name,
    model.providerId,
    model.family ?? "",
    model.supportLabel,
  ].some((candidate) => candidate.toLowerCase().includes(normalized));
}

function modelBrand(model: OpenCodeDiscoveredModel): {
  initials: string;
  label: string;
} {
  const haystack = `${model.id} ${model.name} ${model.family ?? ""}`.toLowerCase();

  if (haystack.includes("deepseek")) return { initials: "DS", label: "DeepSeek" };
  if (haystack.includes("mimo")) return { initials: "MI", label: "MiMo" };
  if (haystack.includes("nemotron") || haystack.includes("nvidia")) {
    return { initials: "NV", label: "NVIDIA" };
  }
  if (haystack.includes("north")) return { initials: "NO", label: "North" };
  if (haystack.includes("qwen")) return { initials: "QW", label: "Qwen" };
  if (haystack.includes("kimi") || haystack.includes("moonshot")) {
    return { initials: "KM", label: "Kimi" };
  }
  if (haystack.includes("minimax")) return { initials: "MM", label: "MiniMax" };
  if (haystack.includes("glm") || haystack.includes("zai")) {
    return { initials: "GL", label: "GLM" };
  }
  if (haystack.includes("pickle")) return { initials: "BP", label: "Big Pickle" };
  if (haystack.includes("claude") || haystack.includes("anthropic")) {
    return { initials: "AN", label: "Anthropic" };
  }
  if (haystack.includes("codex")) return { initials: "CX", label: "Codex" };
  if (haystack.includes("gpt") || haystack.includes("openai")) {
    return { initials: "AI", label: "OpenAI" };
  }

  return {
    initials: model.providerId.slice(0, 2).toUpperCase(),
    label: model.providerId,
  };
}

function ModelGlyph({
  model,
  selected,
}: {
  model: OpenCodeDiscoveredModel;
  selected?: boolean;
}) {
  const brand = modelBrand(model);

  return (
    <div
      className={cn(
        "flex size-9 shrink-0 items-center justify-center rounded-md border font-mono text-[11px] font-semibold",
        selected
          ? "border-primary bg-primary text-primary-foreground"
          : "border-border bg-muted text-muted-foreground",
      )}
      title={brand.label}
    >
      {brand.initials}
    </div>
  );
}

function LoadingRows() {
  return (
    <div className="flex flex-col gap-2 p-3">
      {Array.from({ length: 6 }, (_, index) => (
        <div key={index} className="flex items-center gap-3 rounded-lg border p-3">
          <Skeleton className="size-9 rounded-md" />
          <div className="flex min-w-0 flex-1 flex-col gap-2">
            <Skeleton className="h-3 w-1/2" />
            <Skeleton className="h-3 w-3/4" />
          </div>
        </div>
      ))}
    </div>
  );
}

export function OpenCodeModelDialog({
  open,
  value,
  onOpenChange,
  onChange,
  onModelsLoaded,
}: OpenCodeModelDialogProps) {
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<OpenCodeModelDiscoveryResult | null>(null);

  const loadModels = useCallback(async (refresh = false) => {
    setLoading(true);
    try {
      const res = await fetch(
        `/api/runtime/opencode/models${refresh ? "?refresh=1" : ""}`,
        { cache: "no-store" },
      );
      const data = (await res.json()) as OpenCodeModelDiscoveryResult;
      setResult(data);
      onModelsLoaded?.(data.models ?? []);
    } catch {
      setResult({
        available: false,
        models: [],
        totalCount: 0,
        filteredOutCount: 0,
        refreshed: false,
        error: "Could not load OpenCode models.",
      });
    } finally {
      setLoading(false);
    }
  }, [onModelsLoaded]);

  useEffect(() => {
    if (!open || result) return;
    void loadModels();
  }, [loadModels, open, result]);

  const selectedModel =
    result?.models.find((model) => model.id === value.model) ?? null;
  const selectedVariant = normalizeOpenCodeVariant(
    value.params.variant,
    selectedModel,
  );
  const variantOptions = openCodeVariantOptions(selectedModel);
  const variantIndex = Math.max(0, variantOptions.indexOf(selectedVariant));
  const filteredModels = useMemo(
    () => (result?.models ?? []).filter((model) => modelMatches(model, query)),
    [query, result?.models],
  );

  const groupedModels = useMemo(() => {
    const groups: Record<OpenCodeModelSupportStatus, OpenCodeDiscoveredModel[]> = {
      supported: [],
      recommended: [],
      available: [],
    };
    for (const model of filteredModels) {
      groups[model.supportStatus].push(model);
    }
    return groups;
  }, [filteredModels]);

  function selectModel(model: OpenCodeDiscoveredModel) {
    onChange(
      normalizeRuntimeSettings({
        runtimeId: "opencode",
        model: model.id,
        params: {
          variant: normalizeOpenCodeVariant(value.params.variant, model),
        },
      }),
    );
  }

  function selectVariant(variant: string) {
    onChange(
      normalizeRuntimeSettings({
        runtimeId: "opencode",
        model: value.model,
        params: {
          ...value.params,
          variant,
        },
      }),
    );
  }

  const selectedContext = formatTokenLimit(selectedModel?.contextLimit);
  const selectedOutput = formatTokenLimit(selectedModel?.outputLimit);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[min(760px,calc(100vh-2rem))] flex-col overflow-hidden p-0 sm:max-w-4xl">
        <div className="border-b px-5 py-4 pr-12">
          <DialogHeader>
            <DialogTitle>Configure OpenCode</DialogTitle>
            <DialogDescription>
              Pick a tool-call capable model from your OpenCode catalog and set
              its intelligence level.
            </DialogDescription>
          </DialogHeader>
          <div className="mt-3 flex flex-wrap gap-1.5">
            <Badge variant="secondary">
              <WrenchIcon data-icon="inline-start" />
              Tool-call models
            </Badge>
            {result ? (
              <Badge variant="outline">{result.models.length} available</Badge>
            ) : null}
            {result?.filteredOutCount ? (
              <Badge variant="outline">
                {result.filteredOutCount} hidden without tools
              </Badge>
            ) : null}
          </div>
        </div>

        <div className="grid min-h-0 flex-1 md:grid-cols-[minmax(0,1fr)_20rem]">
          <div className="flex min-h-0 flex-col border-b md:border-r md:border-b-0">
            <div className="flex items-center gap-2 border-b p-3">
              <div className="flex min-w-0 flex-1 items-center gap-2 rounded-md border bg-background px-2">
                <SearchIcon className="size-3.5 shrink-0 text-muted-foreground" />
                <Input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Search models, providers, families"
                  className="h-8 border-0 bg-transparent px-0 focus-visible:ring-0"
                />
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={loading}
                onClick={() => void loadModels(true)}
              >
                <RefreshCwIcon data-icon="inline-start" />
                Refresh
              </Button>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto">
              {loading && !result ? (
                <LoadingRows />
              ) : result?.error ? (
                <div className="flex flex-col items-center gap-2 px-6 py-12 text-center">
                  <XCircleIcon className="size-5 text-destructive" />
                  <div className="text-xs font-medium text-destructive">
                    {result.error}
                  </div>
                </div>
              ) : filteredModels.length === 0 ? (
                <div className="flex flex-col items-center gap-2 px-6 py-12 text-center">
                  <SearchIcon className="size-5 text-muted-foreground" />
                  <div className="text-xs font-medium">No matching models</div>
                  <div className="max-w-72 text-[11px] leading-relaxed text-muted-foreground">
                    OpenCode only exposes models with tool calling here.
                  </div>
                </div>
              ) : (
                <div className="flex flex-col gap-2 p-2">
                  {(["supported", "recommended", "available"] as const).map(
                    (group, groupIndex) =>
                      groupedModels[group].length > 0 ? (
                        <div key={group} className="flex flex-col gap-1">
                          {groupIndex > 0 ? <Separator className="my-1" /> : null}
                          <div className="flex items-center justify-between px-2 py-1">
                            <div className="text-[11px] font-medium uppercase tracking-normal text-muted-foreground">
                              {GROUP_LABELS[group]}
                            </div>
                            <Badge variant="outline">
                              {groupedModels[group].length}
                            </Badge>
                          </div>
                          {groupedModels[group].map((model) => {
                            const selected = model.id === value.model;
                            const contextLimit = formatTokenLimit(model.contextLimit);
                            const outputLimit = formatTokenLimit(model.outputLimit);

                            return (
                              <button
                                key={model.id}
                                type="button"
                                className={cn(
                                  "group flex w-full items-start gap-3 rounded-lg border px-3 py-2.5 text-left outline-none transition-colors hover:border-border hover:bg-muted/60 focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30",
                                  selected && "border-primary bg-muted",
                                )}
                                onClick={() => selectModel(model)}
                              >
                                <ModelGlyph model={model} selected={selected} />
                                <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                                  <div className="flex min-w-0 items-center gap-2">
                                    <span className="truncate text-xs font-medium">
                                      {model.name}
                                    </span>
                                    {selected ? (
                                      <CheckIcon className="size-3.5 shrink-0" />
                                    ) : null}
                                  </div>
                                  <div className="truncate font-mono text-[11px] text-muted-foreground">
                                    {model.id}
                                  </div>
                                  <div className="flex flex-wrap gap-1">
                                    <Badge
                                      variant={
                                        SUPPORT_BADGE_VARIANT[model.supportStatus]
                                      }
                                    >
                                      {model.supportLabel}
                                    </Badge>
                                    {model.reasoning ? (
                                      <Badge variant="outline">
                                        <BrainIcon data-icon="inline-start" />
                                        Reasoning
                                      </Badge>
                                    ) : null}
                                    {contextLimit ? (
                                      <Badge variant="outline">
                                        {contextLimit} ctx
                                      </Badge>
                                    ) : null}
                                    {outputLimit ? (
                                      <Badge variant="outline">
                                        {outputLimit} out
                                      </Badge>
                                    ) : null}
                                  </div>
                                </div>
                              </button>
                            );
                          })}
                        </div>
                      ) : null,
                  )}
                </div>
              )}
            </div>
          </div>

          <aside className="flex min-h-0 flex-col bg-muted/20">
            {selectedModel ? (
              <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-4">
                <div className="flex items-start gap-3">
                  <ModelGlyph model={selectedModel} selected />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium">
                      {selectedModel.name}
                    </div>
                    <div className="mt-1 truncate font-mono text-[11px] text-muted-foreground">
                      {selectedModel.id}
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <div className="rounded-md border bg-background p-2">
                    <div className="flex items-center gap-1 text-[11px] text-muted-foreground">
                      <CpuIcon className="size-3" />
                      Context
                    </div>
                    <div className="mt-1 font-mono text-xs">
                      {selectedContext ? `${selectedContext} tokens` : "Unknown"}
                    </div>
                  </div>
                  <div className="rounded-md border bg-background p-2">
                    <div className="flex items-center gap-1 text-[11px] text-muted-foreground">
                      <TerminalIcon className="size-3" />
                      Output
                    </div>
                    <div className="mt-1 font-mono text-xs">
                      {selectedOutput ? `${selectedOutput} tokens` : "Unknown"}
                    </div>
                  </div>
                </div>

                <div className="rounded-lg border bg-background p-3">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="flex items-center gap-1.5 text-xs font-medium">
                        <GaugeIcon className="size-3.5" />
                        Intelligence
                      </div>
                      <div className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
                        {variantDescription(selectedVariant)}
                      </div>
                    </div>
                    <Badge variant="outline">
                      <SlidersHorizontalIcon data-icon="inline-start" />
                      {formatVariant(selectedVariant)}
                    </Badge>
                  </div>

                  <div className="mt-4">
                    <Slider
                      min={0}
                      max={Math.max(0, variantOptions.length - 1)}
                      step={1}
                      value={[variantIndex]}
                      disabled={variantOptions.length < 2}
                      onValueChange={([nextIndex]) => {
                        const option = variantOptions[nextIndex];
                        if (option) selectVariant(option);
                      }}
                    />
                    <div className="mt-2 flex justify-between gap-2">
                      {variantOptions.map((variant) => (
                        <button
                          key={variant}
                          type="button"
                          className={cn(
                            "truncate text-[10px] text-muted-foreground outline-none hover:text-foreground focus-visible:text-foreground",
                            selectedVariant === variant && "font-medium text-foreground",
                          )}
                          onClick={() => selectVariant(variant)}
                        >
                          {formatVariant(variant)}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>

                <div className="flex flex-wrap gap-1">
                  <Badge variant={SUPPORT_BADGE_VARIANT[selectedModel.supportStatus]}>
                    {selectedModel.supportLabel}
                  </Badge>
                  {selectedModel.reasoning ? (
                    <Badge variant="outline">
                      <BrainIcon data-icon="inline-start" />
                      Reasoning
                    </Badge>
                  ) : null}
                  <Badge variant="outline">
                    {selectedModel.variants.length > 0
                      ? `${selectedModel.variants.length} variants`
                      : "Default variant"}
                  </Badge>
                </div>

                <div className="text-[11px] leading-relaxed text-muted-foreground">
                  {selectedModel.description}
                </div>
              </div>
            ) : (
              <div className="flex flex-1 flex-col items-center justify-center gap-2 p-6 text-center">
                <SlidersHorizontalIcon className="size-5 text-muted-foreground" />
                <div className="text-xs font-medium">Choose a model</div>
                <div className="max-w-56 text-[11px] leading-relaxed text-muted-foreground">
                  Select an OpenCode model to configure its intelligence level.
                </div>
              </div>
            )}
          </aside>
        </div>

        <DialogFooter className="border-t px-4 py-3 sm:items-center sm:justify-between">
          <div className="text-[11px] text-muted-foreground">
            {result
              ? `${result.models.length} usable models${
                  result.filteredOutCount
                    ? `, ${result.filteredOutCount} hidden without tool calls`
                    : ""
                }`
              : ""}
          </div>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Done
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
