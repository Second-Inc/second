"use client";

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
  if (runtime.params.length === 0) return null;

  return (
    <>
      {runtime.params.map((control) => (
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
