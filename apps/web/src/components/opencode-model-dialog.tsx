"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  CheckIcon,
  RefreshCwIcon,
  SearchIcon,
  SlidersHorizontalIcon,
  TerminalIcon,
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
  available: "Other tool-call models",
};

const SUPPORT_BADGE_VARIANT: Record<
  OpenCodeModelSupportStatus,
  "default" | "secondary" | "outline"
> = {
  supported: "default",
  recommended: "secondary",
  available: "outline",
};

function formatLimit(value: number | undefined): string | null {
  if (!value) return null;
  if (value >= 1_000_000) return `${Number(value / 1_000_000).toFixed(1).replace(/\.0$/, "")}M ctx`;
  if (value >= 1_000) return `${Math.round(value / 1_000)}K ctx`;
  return `${value} ctx`;
}

function formatVariant(value: string): string {
  if (value === "auto") return "Auto";
  if (value === "xhigh") return "Extra high";
  return value.slice(0, 1).toUpperCase() + value.slice(1);
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
  ].some((value) => value.toLowerCase().includes(normalized));
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

  const selectedModel = result?.models.find((model) => model.id === value.model) ?? null;
  const selectedVariant = normalizeOpenCodeVariant(
    value.params.variant,
    selectedModel,
  );
  const variantOptions = openCodeVariantOptions(selectedModel);
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

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[min(720px,calc(100vh-2rem))] flex-col overflow-hidden p-0 sm:max-w-2xl">
        <div className="border-b px-5 py-4 pr-12">
          <DialogHeader>
            <DialogTitle>OpenCode models</DialogTitle>
            <DialogDescription>
              Select a tool-call capable model from the installed OpenCode setup.
            </DialogDescription>
          </DialogHeader>
        </div>

        <div className="flex min-h-0 flex-1 flex-col">
          <div className="flex items-center gap-2 border-b px-4 py-3">
            <SearchIcon className="size-3.5 text-muted-foreground" />
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search models"
              className="h-8 border-0 bg-transparent px-0 focus-visible:ring-0"
            />
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

          {selectedModel ? (
            <div className="border-b px-4 py-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <TerminalIcon className="size-3.5 text-muted-foreground" />
                    <div className="truncate text-xs font-medium">
                      {selectedModel.name}
                    </div>
                    <Badge variant={SUPPORT_BADGE_VARIANT[selectedModel.supportStatus]}>
                      {selectedModel.supportLabel}
                    </Badge>
                  </div>
                  <div className="mt-1 truncate font-mono text-[11px] text-muted-foreground">
                    {selectedModel.id}
                  </div>
                </div>
                <Badge variant="outline">
                  <SlidersHorizontalIcon data-icon="inline-start" />
                  {formatVariant(selectedVariant)}
                </Badge>
              </div>

              <div className="mt-3 flex flex-wrap gap-1.5">
                {variantOptions.map((variant) => (
                  <Button
                    key={variant}
                    type="button"
                    size="xs"
                    variant={selectedVariant === variant ? "default" : "outline"}
                    onClick={() => selectVariant(variant)}
                  >
                    {formatVariant(variant)}
                  </Button>
                ))}
              </div>
            </div>
          ) : null}

          <div className="min-h-0 flex-1 overflow-y-auto px-2 py-2">
            {loading && !result ? (
              <div className="px-3 py-8 text-center text-xs text-muted-foreground">
                Loading OpenCode models...
              </div>
            ) : result?.error ? (
              <div className="px-3 py-8 text-center text-xs text-destructive">
                {result.error}
              </div>
            ) : filteredModels.length === 0 ? (
              <div className="px-3 py-8 text-center text-xs text-muted-foreground">
                No matching tool-call models.
              </div>
            ) : (
              (["supported", "recommended", "available"] as const).map((group) =>
                groupedModels[group].length > 0 ? (
                  <div key={group} className="flex flex-col gap-1">
                    <div className="px-2.5 py-1.5 text-xs font-medium text-muted-foreground">
                      {GROUP_LABELS[group]}
                    </div>
                    {groupedModels[group].map((model) => {
                      const selected = model.id === value.model;
                      const contextLimit = formatLimit(model.contextLimit);
                      const outputLimit = formatLimit(model.outputLimit);

                      return (
                        <button
                          key={model.id}
                          type="button"
                          className={cn(
                            "flex w-full items-start gap-3 rounded-md px-2.5 py-2 text-left outline-none transition-colors hover:bg-muted focus-visible:bg-muted",
                            selected && "bg-muted",
                          )}
                          onClick={() => selectModel(model)}
                        >
                          <div className="flex min-w-0 flex-1 flex-col gap-1">
                            <div className="flex min-w-0 items-center gap-2">
                              <span className="truncate text-xs font-medium">
                                {model.name}
                              </span>
                              <Badge
                                variant={SUPPORT_BADGE_VARIANT[model.supportStatus]}
                              >
                                {model.supportLabel}
                              </Badge>
                              {model.reasoning ? (
                                <Badge variant="outline">Reasoning</Badge>
                              ) : null}
                            </div>
                            <div className="truncate font-mono text-[11px] text-muted-foreground">
                              {model.id}
                            </div>
                            <div className="flex flex-wrap gap-1 text-[11px] text-muted-foreground">
                              {contextLimit ? <span>{contextLimit}</span> : null}
                              {outputLimit ? <span>{outputLimit} out</span> : null}
                              {model.variants.length > 0 ? (
                                <span>{model.variants.length} variants</span>
                              ) : (
                                <span>default variant</span>
                              )}
                            </div>
                          </div>
                          {selected ? (
                            <CheckIcon className="mt-1 size-3.5 text-foreground" />
                          ) : null}
                        </button>
                      );
                    })}
                    <Separator className="my-1" />
                  </div>
                ) : null,
              )
            )}
          </div>
        </div>

        <DialogFooter className="border-t px-4 py-3">
          <div className="mr-auto text-[11px] text-muted-foreground">
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
