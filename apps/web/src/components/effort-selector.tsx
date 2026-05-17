"use client";

import { Gauge } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { EFFORT_LEVELS, OPUS_ONLY_EFFORT } from "@/lib/agent/effort";

type EffortSelectorProps = {
  value: string;
  onChange: (value: string) => void;
  model: string;
  side?: "top" | "bottom";
};

const isOpus = (model: string) => model.includes("opus");

export function EffortSelector({
  value,
  onChange,
  model,
  side = "top",
}: EffortSelectorProps) {
  const selected = EFFORT_LEVELS.find((e) => e.id === value);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          className="rounded-full text-muted-foreground"
          aria-label="Effort level"
          title={`Effort: ${selected?.name ?? value}`}
        >
          <Gauge className="size-4" strokeWidth={1.5} />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" side={side} className="min-w-48">
        <DropdownMenuLabel>Effort</DropdownMenuLabel>
        <DropdownMenuRadioGroup value={value} onValueChange={onChange}>
          {EFFORT_LEVELS.map((level) => {
            const disabled = OPUS_ONLY_EFFORT.has(level.id) && !isOpus(model);
            return (
              <DropdownMenuRadioItem
                key={level.id}
                value={level.id}
                disabled={disabled}
              >
                <div className="flex flex-col">
                  <span className="text-xs">{level.name}</span>
                  <span className="text-muted-foreground text-[11px]">
                    {level.description}
                  </span>
                </div>
              </DropdownMenuRadioItem>
            );
          })}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
