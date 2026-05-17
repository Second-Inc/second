"use client";

import { useMemo, useState } from "react";
import { ChevronsUpDownIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";

export type SearchableMultiSelectItem = {
  id: string;
  label: string;
  description?: string;
  badge?: string;
  searchText?: string;
};

type SearchableMultiSelectProps = {
  items: SearchableMultiSelectItem[];
  selectedIds: string[];
  onToggle: (id: string) => void;
  placeholder: string;
  searchPlaceholder: string;
  emptyMessage: string;
  groupLabel: string;
  itemNoun: string;
  disabled?: boolean;
  maxVisibleWithoutSearch?: number;
};

function itemMatchesQuery(item: SearchableMultiSelectItem, query: string): boolean {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return true;
  return [
    item.label,
    item.description,
    item.badge,
    item.searchText,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase()
    .includes(normalized);
}

export function SearchableMultiSelect({
  items,
  selectedIds,
  onToggle,
  placeholder,
  searchPlaceholder,
  emptyMessage,
  groupLabel,
  itemNoun,
  disabled = false,
  maxVisibleWithoutSearch = 2,
}: SearchableMultiSelectProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const selectedItems = useMemo(
    () => items.filter((item) => selectedIds.includes(item.id)),
    [items, selectedIds],
  );
  const filteredItems = useMemo(
    () => items.filter((item) => itemMatchesQuery(item, query)),
    [items, query],
  );
  const visibleItems = query.trim()
    ? filteredItems
    : filteredItems.slice(0, maxVisibleWithoutSearch);
  const hiddenCount = filteredItems.length - visibleItems.length;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          className="h-auto min-h-9 w-full justify-between gap-2 rounded-md bg-background px-2 py-1.5 text-left hover:bg-muted/70"
          disabled={disabled}
          aria-label={placeholder}
        >
          <span className="flex min-w-0 flex-1 flex-wrap gap-1.5">
            {selectedItems.length === 0 ? (
              <span className="text-xs text-muted-foreground">{placeholder}</span>
            ) : (
              <>
                {selectedItems.slice(0, 3).map((item) => (
                  <Badge
                    key={item.id}
                    variant="outline"
                    className="max-w-36 justify-start truncate rounded-md border-border bg-foreground/[0.07] font-normal text-foreground hover:bg-foreground/[0.11] dark:bg-foreground/[0.1] dark:hover:bg-foreground/[0.14]"
                  >
                    <span className="truncate">{item.label}</span>
                  </Badge>
                ))}
                {selectedItems.length > 3 ? (
                  <Badge
                    variant="outline"
                    className="rounded-md border-border bg-foreground/[0.07] font-mono text-foreground"
                  >
                    +{selectedItems.length - 3}
                  </Badge>
                ) : null}
              </>
            )}
          </span>
          <ChevronsUpDownIcon className="size-3.5 shrink-0 text-muted-foreground" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="w-(--radix-popover-trigger-width) p-0"
      >
        <Command shouldFilter={false}>
          <CommandInput
            value={query}
            onValueChange={setQuery}
            placeholder={searchPlaceholder}
          />
          <CommandList>
            <CommandEmpty>{emptyMessage}</CommandEmpty>
            <CommandGroup heading={groupLabel}>
              {visibleItems.map((item) => {
                const checked = selectedIds.includes(item.id);
                return (
                  <CommandItem
                    key={item.id}
                    value={item.searchText ?? `${item.label} ${item.description ?? ""}`}
                    data-checked={checked}
                    className={cn(
                      "data-selected:bg-foreground/[0.06]",
                      checked && "bg-foreground/[0.08]",
                    )}
                    onSelect={() => onToggle(item.id)}
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-xs font-medium">
                        {item.label}
                      </span>
                      {item.description ? (
                        <span className="block truncate text-[11px] text-muted-foreground">
                          {item.description}
                        </span>
                      ) : null}
                    </span>
                    {item.badge ? (
                      <Badge variant="outline" className="shrink-0">
                        {item.badge}
                      </Badge>
                    ) : null}
                  </CommandItem>
                );
              })}
            </CommandGroup>
            {hiddenCount > 0 ? (
              <div className="border-t border-border px-3 py-2 text-[11px] text-muted-foreground">
                Search to find {hiddenCount} more {itemNoun}
                {hiddenCount === 1 ? "" : "s"}.
              </div>
            ) : null}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
