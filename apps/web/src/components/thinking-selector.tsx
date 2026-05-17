"use client";

import { BrainIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { THINKING_MODES, OPUS_ONLY_THINKING } from "@/lib/agent/thinking";

type ThinkingSelectorProps = {
  value: string;
  onChange: (value: string) => void;
  model: string;
  side?: "top" | "bottom";
};

const isOpus = (model: string) => model.includes("opus");

export function ThinkingSelector({
  value,
  onChange,
  model,
  side = "top",
}: ThinkingSelectorProps) {
  const selected = THINKING_MODES.find((m) => m.id === value);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          className="rounded-full text-muted-foreground"
          aria-label="Thinking mode"
          title={`Thinking: ${selected?.name ?? value}`}
        >
          <BrainIcon className="size-4" strokeWidth={1.5} />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" side={side} className="min-w-48">
        <DropdownMenuLabel>Thinking</DropdownMenuLabel>
        <DropdownMenuRadioGroup value={value} onValueChange={onChange}>
          {THINKING_MODES.map((mode) => {
            const disabled = OPUS_ONLY_THINKING.has(mode.id) && !isOpus(model);
            return (
              <DropdownMenuRadioItem
                key={mode.id}
                value={mode.id}
                disabled={disabled}
              >
                <div className="flex flex-col">
                  <span className="text-xs">{mode.name}</span>
                  <span className="text-muted-foreground text-[11px]">
                    {mode.description}
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
