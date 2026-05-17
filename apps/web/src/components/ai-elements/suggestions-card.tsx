"use client";

import {
  ArrowRightIcon,
} from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

export type BuildSuggestion = {
  emoji: string | null;
  title: string;
  subtitle: string;
};

type SuggestionsCardProps = {
  suggestions: BuildSuggestion[];
  actionsEnabled: boolean;
  onSelectSuggestion: (title: string) => void;
};

const FALLBACK_SUGGESTION_EMOJI = "✨";
const ICON_TILE_SHADOW = [
  "0px 0px 0px 1px var(--shadow-color)",
  "0px 1px 1px -0.5px var(--shadow-color)",
].join(", ");

function suggestionEmoji(value: string | null): string {
  const emoji = value?.trim();
  return emoji && emoji.length <= 12 ? emoji : FALLBACK_SUGGESTION_EMOJI;
}

function SuggestionEmoji({ emoji }: { emoji: string | null }) {
  return (
    <span aria-hidden="true" className="text-[19px] leading-none">
      {suggestionEmoji(emoji)}
    </span>
  );
}

function SuggestionSkeleton() {
  return (
    <div className="flex items-start gap-4 rounded-lg border border-border/70 bg-background p-4">
      <Skeleton className="size-11 shrink-0 rounded-xl" />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <Skeleton className="h-4 w-40 rounded" />
        </div>
        <div className="mt-2 flex flex-col gap-2">
          <Skeleton className="h-3 w-full rounded" />
          <Skeleton className="h-3 w-4/5 rounded" />
        </div>
      </div>
    </div>
  );
}

function SuggestionButton({
  suggestion,
  disabled,
  onSelect,
}: {
  suggestion: BuildSuggestion;
  disabled: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      aria-label={`Build ${suggestion.title}`}
      onClick={onSelect}
      className={cn(
        "group flex w-full items-start gap-4 rounded-lg border border-border/80 bg-background p-4 text-left transition-all duration-150",
        "enabled:cursor-pointer enabled:hover:border-foreground/18 enabled:hover:bg-muted/20",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/35",
        disabled && "cursor-default opacity-75",
      )}
    >
      <div
        className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-white text-zinc-950 [--shadow-color:rgba(0,0,0,0.12)] dark:bg-zinc-900 dark:text-zinc-50 dark:[--shadow-color:rgba(255,255,255,0.10)]"
        style={{ boxShadow: ICON_TILE_SHADOW } as React.CSSProperties}
      >
        <SuggestionEmoji emoji={suggestion.emoji} />
      </div>
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium leading-snug tracking-tight text-foreground">
          {suggestion.title}
        </div>
        <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-muted-foreground">
          {suggestion.subtitle}
        </p>
      </div>
      <ArrowRightIcon className="mt-1 size-4 shrink-0 text-muted-foreground/55 transition-transform group-hover:translate-x-0.5 group-hover:text-foreground/70 group-disabled:translate-x-0 group-disabled:text-muted-foreground/55" />
    </button>
  );
}

export function SuggestionsCard({
  suggestions,
  actionsEnabled,
  onSelectSuggestion,
}: SuggestionsCardProps) {
  const visibleSuggestions = suggestions.slice(0, 6);

  return (
    <div className="not-prose w-full">
      <p className="text-sm font-medium leading-6 tracking-tight text-foreground">
        Choose a suggestion to continue.
      </p>

      <div className="mt-3 flex flex-col gap-2">
        {visibleSuggestions.length > 0
          ? visibleSuggestions.map((suggestion, index) => (
              <SuggestionButton
                key={`${suggestion.title}-${index}`}
                suggestion={suggestion}
                disabled={!actionsEnabled}
                onSelect={() => onSelectSuggestion(suggestion.title)}
              />
            ))
          : (
              <>
                <SuggestionSkeleton />
                <SuggestionSkeleton />
                <SuggestionSkeleton />
              </>
            )}
      </div>
    </div>
  );
}
