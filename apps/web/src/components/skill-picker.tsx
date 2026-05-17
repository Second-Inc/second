"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { BookOpen, Search, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { searchAvailableSkills } from "@/lib/mock-data/workspace-library";

type SkillRef = {
  _id: string;
  slug: string;
  displayName: string;
  description: string;
};

type SkillPickerProps = {
  workspaceId: string;
  selectedSkills: SkillRef[];
  onSelect: (skill: SkillRef) => void;
  onRemove: (skillId: string) => void;
  side?: "top" | "bottom";
};

export function SkillPicker({
  workspaceId,
  selectedSkills,
  onSelect,
  onRemove,
  side = "top",
}: SkillPickerProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SkillRef[]>([]);
  const [loading, setLoading] = useState(false);
  const [highlightIndex, setHighlightIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const selectedIds = new Set(selectedSkills.map((s) => s._id));

  const doSearch = useCallback(async (q: string) => {
    setLoading(true);
    const res = await searchAvailableSkills(q, workspaceId);
    setResults(
      res.map((s) => ({
        _id: s._id,
        slug: s.slug,
        displayName: s.displayName,
        description: s.description,
      })),
    );
    setHighlightIndex(0);
    setLoading(false);
  }, [workspaceId]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    searchAvailableSkills("", workspaceId).then((res) => {
      if (cancelled) return;
      setResults(
        res.map((s) => ({
          _id: s._id,
          slug: s.slug,
          displayName: s.displayName,
          description: s.description,
        })),
      );
      setHighlightIndex(0);
    });
    return () => { cancelled = true; };
  }, [open, workspaceId]);

  const handleQueryChange = (value: string) => {
    setQuery(value);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      void doSearch(value);
    }, 150);
  };

  const handleSelect = (skill: SkillRef) => {
    if (selectedIds.has(skill._id)) {
      onRemove(skill._id);
    } else {
      onSelect(skill);
      if (results.length === 1) {
        setOpen(false);
      }
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlightIndex((i) => Math.min(i + 1, results.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlightIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (results[highlightIndex]) {
        handleSelect(results[highlightIndex]);
      }
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          className={cn(
            "rounded-full text-muted-foreground",
            selectedSkills.length > 0 && "text-foreground",
          )}
          title={
            selectedSkills.length > 0
              ? `${selectedSkills.length} skill(s) attached`
              : "Attach skills"
          }
          aria-label="Attach skills"
        >
          <BookOpen className="size-4" strokeWidth={1.5} />
          {selectedSkills.length > 0 && (
            <span className="absolute -right-0.5 -top-0.5 flex size-3.5 items-center justify-center rounded-full bg-foreground text-[9px] font-bold text-background">
              {selectedSkills.length}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent
        side={side}
        align="start"
        className="w-72 p-0"
        onOpenAutoFocus={(e) => {
          e.preventDefault();
          setTimeout(() => inputRef.current?.focus(), 0);
        }}
      >
        {/* Search */}
        <div className="flex items-center gap-2 border-b border-border px-3 py-2">
          <Search className="size-3.5 shrink-0 text-muted-foreground" />
          <input
            ref={inputRef}
            type="text"
            placeholder="Search skills..."
            value={query}
            onChange={(e) => handleQueryChange(e.target.value)}
            onKeyDown={handleKeyDown}
            className="flex-1 bg-transparent text-xs outline-none placeholder:text-muted-foreground"
          />
        </div>

        {/* Selected chips */}
        {selectedSkills.length > 0 && (
          <div className="flex flex-wrap gap-1 border-b border-border px-3 py-2">
            {selectedSkills.map((skill) => (
              <Badge
                key={skill._id}
                variant="secondary"
                className="gap-1 pr-1 text-[11px]"
              >
                {skill.displayName}
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onRemove(skill._id);
                  }}
                  className="ml-0.5 rounded-full hover:bg-muted"
                >
                  <X className="size-2.5" />
                </button>
              </Badge>
            ))}
          </div>
        )}

        {/* Results */}
        <div className="max-h-52 overflow-y-auto py-1">
          {loading ? (
            <div className="flex items-center justify-center py-4">
              <div className="size-4 animate-spin rounded-full border-2 border-muted-foreground/20 border-t-muted-foreground" />
            </div>
          ) : results.length === 0 ? (
            <p className="px-3 py-4 text-center text-xs text-muted-foreground">
              No skills found
            </p>
          ) : (
            results.map((skill, index) => (
              <button
                key={skill._id}
                type="button"
                onClick={() => handleSelect(skill)}
                className={cn(
                  "flex w-full items-center gap-2.5 px-3 py-1.5 text-left transition-colors",
                  index === highlightIndex && "bg-accent",
                  selectedIds.has(skill._id) && "opacity-60",
                )}
              >
                <BookOpen className="size-3.5 shrink-0 text-muted-foreground" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-xs font-medium">
                    {skill.displayName}
                  </p>
                  <p className="truncate text-[11px] text-muted-foreground">
                    {skill.description}
                  </p>
                </div>
                {selectedIds.has(skill._id) && (
                  <span className="shrink-0 text-[10px] text-muted-foreground">
                    Added
                  </span>
                )}
              </button>
            ))
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}

// ---------------------------------------------------------------------------
// Skill chips row (shown above/below composer)
// ---------------------------------------------------------------------------

export function SkillChips({
  skills,
  onRemove,
}: {
  skills: SkillRef[];
  onRemove: (skillId: string) => void;
}) {
  if (skills.length === 0) return null;

  return (
    <div className="flex flex-wrap gap-1 px-1">
      {skills.map((skill) => (
        <Badge
          key={skill._id}
          variant="outline"
          className="gap-1 pr-1 text-[11px] animate-fade-in-up"
          style={{ animationDuration: "0.2s" }}
        >
          <BookOpen className="size-2.5" />
          {skill.displayName}
          <button
            type="button"
            onClick={() => onRemove(skill._id)}
            className="ml-0.5 rounded-full hover:bg-muted"
          >
            <X className="size-2.5" />
          </button>
        </Badge>
      ))}
    </div>
  );
}
