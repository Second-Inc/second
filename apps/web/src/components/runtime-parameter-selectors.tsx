"use client";

import { useEffect, useMemo, useState } from "react";
import { BrainIcon, Gauge, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  getRuntime,
  normalizeRuntimeSettings,
  runtimeParamIsDisabledForModel,
  type AgentRuntimeSettings,
  type RuntimeParamControl,
} from "@/lib/agent/runtime-registry";
import {
  normalizeOpenCodeVariant,
  openCodeVariantOptions,
  type OpenCodeDiscoveredModel,
} from "@/lib/agent/opencode-models";

type RuntimeParameterSelectorsProps = {
  value: AgentRuntimeSettings;
  onChange: (value: AgentRuntimeSettings) => void;
  side?: "top" | "bottom";
};

const ICONS = {
  gauge: Gauge,
  brain: BrainIcon,
  shield: ShieldCheck,
} as const;

function variantName(value: string): string {
  if (value === "auto") return "Auto";
  if (value === "xhigh") return "Extra high";
  return value.slice(0, 1).toUpperCase() + value.slice(1);
}

function variantDescription(value: string): string {
  if (value === "auto") return "Use the model's OpenCode default";
  if (value === "none") return "No extra reasoning effort";
  if (value === "low") return "Faster, lighter reasoning";
  if (value === "medium") return "Balanced reasoning";
  if (value === "high") return "Deeper reasoning";
  if (value === "xhigh") return "Maximum OpenAI reasoning";
  if (value === "max") return "Maximum OpenCode variant";
  return "OpenCode model variant";
}

function openCodeVariantControl(
  control: RuntimeParamControl,
  model: OpenCodeDiscoveredModel | null,
): RuntimeParamControl {
  if (control.id !== "variant" || !model) return control;

  return {
    ...control,
    options: openCodeVariantOptions(model).map((variant) => ({
      id: variant,
      name: variantName(variant),
      description: variantDescription(variant),
    })),
  };
}

function RuntimeParameterSelector({
  settings,
  control,
  onChange,
  side,
}: {
  settings: AgentRuntimeSettings;
  control: RuntimeParamControl;
  onChange: (value: AgentRuntimeSettings) => void;
  side: "top" | "bottom";
}) {
  const selectedValue = settings.params[control.id] ?? control.defaultValue;
  const selected = control.options.find((option) => option.id === selectedValue);
  const Icon = ICONS[control.icon];

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          className="rounded-full text-muted-foreground"
          aria-label={control.name}
          title={`${control.name}: ${selected?.name ?? selectedValue}`}
        >
          <Icon className="size-4" strokeWidth={1.5} />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" side={side} className="min-w-52">
        <DropdownMenuLabel>{control.name}</DropdownMenuLabel>
        <DropdownMenuRadioGroup
          value={selectedValue}
          onValueChange={(nextValue) => {
            onChange(
              normalizeRuntimeSettings({
                ...settings,
                params: {
                  ...settings.params,
                  [control.id]: nextValue,
                },
              }),
            );
          }}
        >
          {control.options.map((option) => (
            <DropdownMenuRadioItem
              key={option.id}
              value={option.id}
              disabled={runtimeParamIsDisabledForModel(
                control,
                settings.model,
                option.id,
              )}
            >
              <div className="flex flex-col">
                <span className="text-xs">{option.name}</span>
                <span className="text-[11px] text-muted-foreground">
                  {option.description}
                </span>
              </div>
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function RuntimeParameterSelectors({
  value,
  onChange,
  side = "top",
}: RuntimeParameterSelectorsProps) {
  const runtime = getRuntime(value.runtimeId);
  const [openCodeModels, setOpenCodeModels] = useState<OpenCodeDiscoveredModel[]>([]);

  useEffect(() => {
    if (value.runtimeId !== "opencode") return;

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
  }, [value.runtimeId]);

  const selectedOpenCodeModel = value.runtimeId === "opencode"
    ? openCodeModels.find((model) => model.id === value.model) ?? null
    : null;
  const controls = useMemo(
    () =>
      runtime.params.map((control) =>
        value.runtimeId === "opencode"
          ? openCodeVariantControl(control, selectedOpenCodeModel)
          : control,
      ),
    [runtime.params, selectedOpenCodeModel, value.runtimeId],
  );

  useEffect(() => {
    if (value.runtimeId !== "opencode" || !selectedOpenCodeModel) return;
    const normalizedVariant = normalizeOpenCodeVariant(
      value.params.variant,
      selectedOpenCodeModel,
    );
    if (normalizedVariant === value.params.variant) return;

    onChange({
      ...value,
      params: {
        ...value.params,
        variant: normalizedVariant,
      },
    });
  }, [onChange, selectedOpenCodeModel, value]);

  if (runtime.params.length === 0) return null;

  return (
    <>
      {controls.map((control) => (
        <RuntimeParameterSelector
          key={control.id}
          settings={value}
          control={control}
          onChange={onChange}
          side={side}
        />
      ))}
    </>
  );
}
