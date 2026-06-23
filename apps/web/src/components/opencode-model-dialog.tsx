"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Image from "next/image";
import { Slider as SliderPrimitive } from "radix-ui";
import {
  AlertCircleIcon,
  BrainIcon,
  CheckIcon,
  CircleIcon,
  CircleSlashIcon,
  CpuIcon,
  EyeIcon,
  FeatherIcon,
  FileTextIcon,
  GaugeIcon,
  RabbitIcon,
  RefreshCwIcon,
  RocketIcon,
  SearchIcon,
  ShieldCheckIcon,
  SparklesIcon,
  StarIcon,
  Wand2Icon,
  WrenchIcon,
  ZapIcon,
  type LucideIcon,
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
import { Skeleton } from "@/components/ui/skeleton";
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

type StatusMeta = {
  label: string;
  icon: LucideIcon;
  dot: string;
  chip: string;
  callout: string;
  iconColor: string;
};

const STATUS_META: Record<OpenCodeModelSupportStatus, StatusMeta> = {
  supported: {
    label: "Supported",
    icon: ShieldCheckIcon,
    dot: "bg-emerald-500",
    chip: "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
    callout: "border-emerald-500/25 bg-emerald-500/[0.07]",
    iconColor: "text-emerald-600 dark:text-emerald-400",
  },
  recommended: {
    label: "Recommended",
    icon: StarIcon,
    dot: "bg-amber-500",
    chip: "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-400",
    callout: "border-amber-500/25 bg-amber-500/[0.07]",
    iconColor: "text-amber-600 dark:text-amber-400",
  },
  available: {
    label: "Available",
    icon: CircleIcon,
    dot: "bg-muted-foreground/50",
    chip: "border-border bg-muted text-muted-foreground",
    callout: "border-border bg-muted/40",
    iconColor: "text-muted-foreground",
  },
};

const STATUS_ORDER = ["supported", "recommended", "available"] as const;

type VariantMeta = { label: string; description: string; icon: LucideIcon };

const VARIANT_META: Record<string, VariantMeta> = {
  auto: { label: "Auto", description: "Use the model's OpenCode default.", icon: Wand2Icon },
  none: { label: "None", description: "Disable extra reasoning when supported.", icon: CircleSlashIcon },
  minimal: { label: "Minimal", description: "Minimal reasoning for the fastest replies.", icon: FeatherIcon },
  low: { label: "Low", description: "Faster responses with lighter reasoning.", icon: RabbitIcon },
  medium: { label: "Medium", description: "Balanced speed and reasoning depth.", icon: GaugeIcon },
  high: { label: "High", description: "Deeper reasoning for app-building work.", icon: BrainIcon },
  xhigh: { label: "Extra high", description: "Extra reasoning for complex OpenAI-backed runs.", icon: ZapIcon },
  max: { label: "Max", description: "Maximum reasoning level exposed by OpenCode.", icon: RocketIcon },
};

const BRAND_ACCENTS = [
  "text-blue-600 dark:text-blue-400",
  "text-violet-600 dark:text-violet-400",
  "text-emerald-600 dark:text-emerald-400",
  "text-amber-600 dark:text-amber-400",
  "text-rose-600 dark:text-rose-400",
  "text-cyan-600 dark:text-cyan-400",
  "text-fuchsia-600 dark:text-fuchsia-400",
];

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

function variantMeta(value: string): VariantMeta {
  return (
    VARIANT_META[value] ?? {
      label: formatVariant(value),
      description: "OpenCode model variant.",
      icon: GaugeIcon,
    }
  );
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

function brandAccent(label: string): string {
  let hash = 0;
  for (let index = 0; index < label.length; index += 1) {
    hash = (hash * 31 + label.charCodeAt(index)) >>> 0;
  }
  return BRAND_ACCENTS[hash % BRAND_ACCENTS.length];
}

function logoUrl(providerId: string): string {
  return `https://models.dev/logos/${encodeURIComponent(providerId)}.svg`;
}

const logoStatusCache = new Map<string, "loaded" | "error">();

function useLogoStatus(url: string): "loading" | "loaded" | "error" {
  const [, bumpVersion] = useState(0);

  useEffect(() => {
    if (logoStatusCache.has(url)) return;

    let active = true;
    const image = new window.Image();
    const resolve = (status: "loaded" | "error") => {
      logoStatusCache.set(url, status);
      if (active) bumpVersion((version) => version + 1);
    };
    image.onload = () => resolve("loaded");
    image.onerror = () => resolve("error");
    image.src = url;

    return () => {
      active = false;
    };
  }, [url]);

  return logoStatusCache.get(url) ?? "loading";
}

function ModelLogo({
  model,
  size = "md",
  selected,
}: {
  model: OpenCodeDiscoveredModel;
  size?: "md" | "lg";
  selected?: boolean;
}) {
  const url = logoUrl(model.providerId);
  const status = useLogoStatus(url);
  const brand = modelBrand(model);

  const tileSize = size === "lg" ? "size-11 rounded-xl" : "size-9 rounded-lg";
  const glyphSize = size === "lg" ? "size-6" : "size-5";
  const initialsSize = size === "lg" ? "text-sm" : "text-[11px]";

  return (
    <div
      title={brand.label}
      className={cn(
        "flex shrink-0 items-center justify-center overflow-hidden border transition-colors",
        tileSize,
        selected
          ? "border-primary/60 bg-primary"
          : "border-border bg-gradient-to-b from-muted/30 to-muted/70",
      )}
    >
      {status === "loaded" ? (
        <span
          aria-hidden
          className={cn(
            "block",
            glyphSize,
            selected ? "bg-primary-foreground" : "bg-foreground/80",
          )}
          style={{
            maskImage: `url("${url}")`,
            WebkitMaskImage: `url("${url}")`,
            maskRepeat: "no-repeat",
            WebkitMaskRepeat: "no-repeat",
            maskPosition: "center",
            WebkitMaskPosition: "center",
            maskSize: "contain",
            WebkitMaskSize: "contain",
          }}
        />
      ) : (
        <span
          className={cn(
            "font-mono font-semibold",
            initialsSize,
            selected
              ? "text-primary-foreground"
              : brandAccent(brand.label),
          )}
        >
          {brand.initials}
        </span>
      )}
    </div>
  );
}

function CapabilityChip({
  icon: Icon,
  children,
  className,
}: {
  icon: LucideIcon;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-md border border-border bg-background px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground",
        className,
      )}
    >
      <Icon className="size-3" />
      {children}
    </span>
  );
}

function IntelligenceSlider({
  options,
  value,
  onSelect,
}: {
  options: string[];
  value: string;
  onSelect: (variant: string) => void;
}) {
  const index = Math.max(0, options.indexOf(value));
  const max = Math.max(0, options.length - 1);
  const meta = variantMeta(value);
  const Icon = meta.icon;

  if (options.length < 2) {
    return (
      <div className="rounded-xl border bg-background p-3.5">
        <div className="flex items-center gap-3">
          <div className="flex size-9 shrink-0 items-center justify-center rounded-lg border border-primary/20 bg-primary/10 text-primary">
            <SparklesIcon className="size-4" />
          </div>
          <div className="min-w-0">
            <div className="text-xs font-medium">Intelligence: Auto</div>
            <div className="mt-0.5 text-[11px] leading-relaxed text-muted-foreground">
              This model runs at its default reasoning level.
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-xl border bg-background p-3.5">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <div className="flex size-9 shrink-0 items-center justify-center rounded-lg border border-primary/20 bg-primary/10 text-primary">
            <GaugeIcon className="size-4" />
          </div>
          <div>
            <div className="text-xs font-semibold">Intelligence</div>
            <div className="text-[11px] text-muted-foreground">
              Level {index + 1} of {options.length}
            </div>
          </div>
        </div>
        <span className="inline-flex items-center gap-1 rounded-full border border-primary/30 bg-primary/10 px-2 py-0.5 text-[11px] font-medium text-primary">
          <Icon className="size-3" />
          {meta.label}
        </span>
      </div>

      <p className="mt-3 text-[11px] leading-relaxed text-muted-foreground">
        {meta.description}
      </p>

      <SliderPrimitive.Root
        min={0}
        max={max}
        step={1}
        value={[index]}
        onValueChange={([next]) => {
          const option = options[next];
          if (option) onSelect(option);
        }}
        className="relative mt-4 flex w-full touch-none items-center select-none"
      >
        <SliderPrimitive.Track className="relative h-2 w-full grow overflow-hidden rounded-full bg-muted">
          <SliderPrimitive.Range className="absolute h-full rounded-full bg-gradient-to-r from-primary/50 to-primary" />
        </SliderPrimitive.Track>
        {options.map((option, tickIndex) => (
          <span
            key={option}
            aria-hidden
            className={cn(
              "pointer-events-none absolute top-1/2 size-1 -translate-x-1/2 -translate-y-1/2 rounded-full",
              tickIndex <= index ? "bg-primary-foreground/70" : "bg-foreground/25",
            )}
            style={{
              left:
                max === 0
                  ? "0.625rem"
                  : `calc(0.625rem + ${tickIndex / max} * (100% - 1.25rem))`,
            }}
          />
        ))}
        <SliderPrimitive.Thumb className="relative z-10 block size-5 cursor-grab rounded-full border-2 border-primary bg-background shadow-md ring-primary/25 transition-[box-shadow] hover:ring-4 focus-visible:ring-4 focus-visible:outline-none active:cursor-grabbing" />
      </SliderPrimitive.Root>

      <div className="mt-2.5 flex justify-between gap-1">
        {options.map((option) => (
          <button
            key={option}
            type="button"
            onClick={() => onSelect(option)}
            className={cn(
              "truncate text-[10px] outline-none transition-colors hover:text-foreground focus-visible:text-foreground",
              value === option
                ? "font-semibold text-foreground"
                : "text-muted-foreground",
            )}
          >
            {variantMeta(option).label}
          </button>
        ))}
      </div>
    </div>
  );
}

function LoadingRows() {
  return (
    <div className="flex flex-col gap-2 p-3">
      {Array.from({ length: 6 }, (_, index) => (
        <div key={index} className="flex items-center gap-3 rounded-xl border p-3">
          <Skeleton className="size-9 rounded-lg" />
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
            <div className="flex items-center gap-3">
              <span className="flex size-9 shrink-0 items-center justify-center rounded-lg border bg-muted/40">
                <Image
                  src="/icons/opencode-light.svg"
                  alt=""
                  width={16}
                  height={20}
                  className="h-5 w-auto dark:hidden"
                />
                <Image
                  src="/icons/opencode-dark.svg"
                  alt=""
                  width={16}
                  height={20}
                  className="hidden h-5 w-auto dark:block"
                />
              </span>
              <div className="min-w-0">
                <DialogTitle>OpenCode models</DialogTitle>
                <DialogDescription>
                  Pick a tool-call capable model and tune its intelligence.
                </DialogDescription>
              </div>
            </div>
          </DialogHeader>
        </div>

        <div className="grid min-h-0 flex-1 md:grid-cols-[minmax(0,1fr)_22rem]">
          <div className="flex min-h-0 flex-col border-b md:border-r md:border-b-0">
            <div className="flex items-center gap-2 border-b p-3">
              <div className="flex min-w-0 flex-1 items-center gap-2 rounded-lg border bg-background px-2.5 transition-colors focus-within:border-ring focus-within:ring-2 focus-within:ring-ring/30">
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
                <RefreshCwIcon
                  data-icon="inline-start"
                  className={cn(loading && "animate-spin")}
                />
                Refresh
              </Button>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto">
              {loading && !result ? (
                <LoadingRows />
              ) : result?.error ? (
                <div className="flex flex-col items-center gap-2 px-6 py-12 text-center">
                  <AlertCircleIcon className="size-6 text-destructive" />
                  <div className="text-xs font-medium text-destructive">
                    {result.error}
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="mt-1"
                    onClick={() => void loadModels(true)}
                  >
                    <RefreshCwIcon data-icon="inline-start" />
                    Try again
                  </Button>
                </div>
              ) : filteredModels.length === 0 ? (
                <div className="flex flex-col items-center gap-2 px-6 py-12 text-center">
                  <SearchIcon className="size-6 text-muted-foreground" />
                  <div className="text-xs font-medium">No matching models</div>
                  <div className="max-w-72 text-[11px] leading-relaxed text-muted-foreground">
                    OpenCode only exposes models with tool calling here.
                  </div>
                </div>
              ) : (
                <div className="flex flex-col gap-3 p-2.5">
                  {STATUS_ORDER.map((group) =>
                    groupedModels[group].length > 0 ? (
                      <div key={group} className="flex flex-col gap-1.5">
                        <div className="flex items-center gap-1.5 px-1.5">
                          {/* Support category icons are intentionally hidden.
                          {(() => {
                            const StatusIcon = STATUS_META[group].icon;
                            return (
                              <StatusIcon
                                className={cn(
                                  "size-3",
                                  STATUS_META[group].iconColor,
                                )}
                              />
                            );
                          })()} */}
                          <span className="text-[11px] font-medium text-foreground/80">
                            {STATUS_META[group].label}
                          </span>
                          <span className="ml-auto text-[10px] text-muted-foreground">
                            {groupedModels[group].length}
                          </span>
                        </div>
                        {groupedModels[group].map((model) => {
                          const selected = model.id === value.model;
                          const contextLimit = formatTokenLimit(model.contextLimit);

                          return (
                            <button
                              key={model.id}
                              type="button"
                              className={cn(
                                "group flex w-full items-center gap-3 rounded-xl border px-3 py-2.5 text-left outline-none transition-all hover:border-border hover:bg-muted/50 focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30",
                                selected
                                  ? "border-primary/50 bg-primary/[0.06] ring-1 ring-primary/15"
                                  : "border-transparent",
                              )}
                              onClick={() => selectModel(model)}
                            >
                              <ModelLogo model={model} selected={selected} />
                              <div className="flex min-w-0 flex-1 flex-col gap-1">
                                <div className="flex min-w-0 items-center gap-2">
                                  <span className="truncate text-xs font-medium">
                                    {model.name}
                                  </span>
                                  <span className="truncate font-mono text-[10px] text-muted-foreground">
                                    {model.id}
                                  </span>
                                </div>
                                <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
                                  {/* Support labels are intentionally hidden in rows.
                                  <span className="inline-flex items-center gap-1">
                                    <span
                                      className={cn(
                                        "size-1.5 rounded-full",
                                        STATUS_META[model.supportStatus].dot,
                                      )}
                                    />
                                    {model.supportLabel}
                                  </span>
                                  */}
                                  {model.reasoning ? (
                                    <span className="inline-flex items-center gap-0.5">
                                      <BrainIcon className="size-2.5" />
                                      Reasoning
                                    </span>
                                  ) : null}
                                  {contextLimit ? (
                                    <span className="inline-flex items-center gap-0.5">
                                      <CpuIcon className="size-2.5" />
                                      {contextLimit}
                                    </span>
                                  ) : null}
                                </div>
                              </div>
                              <div
                                className={cn(
                                  "flex size-5 shrink-0 items-center justify-center rounded-full transition-opacity",
                                  selected
                                    ? "bg-primary text-primary-foreground opacity-100"
                                    : "opacity-0",
                                )}
                              >
                                <CheckIcon className="size-3" />
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
              <div className="flex min-h-0 flex-1 flex-col gap-3.5 overflow-y-auto p-4">
                <div className="flex items-center gap-3">
                  <ModelLogo model={selectedModel} size="lg" selected />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-semibold">
                      {selectedModel.name}
                    </div>
                    <div className="mt-0.5 truncate font-mono text-[11px] text-muted-foreground">
                      {selectedModel.id}
                    </div>
                  </div>
                </div>

                {/* Support classification callout is intentionally hidden.
                <div
                  className={cn(
                    "flex gap-2.5 rounded-xl border p-3",
                    STATUS_META[selectedModel.supportStatus].callout,
                  )}
                >
                  {(() => {
                    const StatusIcon = STATUS_META[selectedModel.supportStatus].icon;
                    return (
                      <StatusIcon
                        className={cn(
                          "mt-0.5 size-4 shrink-0",
                          STATUS_META[selectedModel.supportStatus].iconColor,
                        )}
                      />
                    );
                  })()}
                  <div className="min-w-0">
                    <div className="text-xs font-medium">
                      {selectedModel.supportLabel}
                    </div>
                    <p className="mt-0.5 text-[11px] leading-relaxed text-muted-foreground">
                      {selectedModel.description}
                    </p>
                  </div>
                </div>
                */}

                <div className="flex flex-wrap gap-1.5">
                  <CapabilityChip icon={WrenchIcon}>Tool calls</CapabilityChip>
                  {selectedModel.reasoning ? (
                    <CapabilityChip icon={BrainIcon}>Reasoning</CapabilityChip>
                  ) : null}
                  {selectedModel.attachment ? (
                    <CapabilityChip icon={EyeIcon}>Vision</CapabilityChip>
                  ) : null}
                  <CapabilityChip icon={GaugeIcon}>
                    {selectedModel.variants.length > 0
                      ? `${selectedModel.variants.length} levels`
                      : "Default level"}
                  </CapabilityChip>
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <div className="rounded-xl border bg-background p-2.5">
                    <div className="flex items-center gap-1 text-[11px] text-muted-foreground">
                      <CpuIcon className="size-3" />
                      Context
                    </div>
                    <div className="mt-1 font-mono text-xs font-medium">
                      {selectedContext ? `${selectedContext} tokens` : "Unknown"}
                    </div>
                  </div>
                  <div className="rounded-xl border bg-background p-2.5">
                    <div className="flex items-center gap-1 text-[11px] text-muted-foreground">
                      <FileTextIcon className="size-3" />
                      Max output
                    </div>
                    <div className="mt-1 font-mono text-xs font-medium">
                      {selectedOutput ? `${selectedOutput} tokens` : "Unknown"}
                    </div>
                  </div>
                </div>

                <IntelligenceSlider
                  options={variantOptions}
                  value={selectedVariant}
                  onSelect={selectVariant}
                />
              </div>
            ) : (
              <div className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center">
                <div className="flex size-12 items-center justify-center rounded-2xl border bg-background">
                  <SparklesIcon className="size-5 text-muted-foreground" />
                </div>
                <div className="text-xs font-medium">Choose a model</div>
                <div className="max-w-56 text-[11px] leading-relaxed text-muted-foreground">
                  Select an OpenCode model to see its capabilities and set its
                  intelligence level.
                </div>
              </div>
            )}
          </aside>
        </div>

        <DialogFooter className="border-t px-4 py-3 sm:items-center sm:justify-between">
          <div className="flex flex-wrap items-center gap-1.5">
            {result ? (
              <Badge variant="outline">
                <WrenchIcon data-icon="inline-start" />
                {result.models.length} usable
              </Badge>
            ) : null}
            {result?.filteredOutCount ? (
              <Badge variant="outline" className="text-muted-foreground">
                {result.filteredOutCount} hidden without tools
              </Badge>
            ) : null}
          </div>
          <Button type="button" onClick={() => onOpenChange(false)}>
            Done
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
