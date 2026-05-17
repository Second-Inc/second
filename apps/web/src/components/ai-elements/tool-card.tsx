"use client";

import { memo, useState } from "react";
import {
  BotIcon,
  CheckIcon,
  ChevronDownIcon,
  ExternalLinkIcon,
  FilePlusIcon,
  FilePenLineIcon,
  FileTextIcon,
  FolderSearchIcon,
  GlobeIcon,
  PlugZapIcon,
  SearchIcon,
} from "lucide-react";
import { AppLoader } from "@/components/app-loader";
import { cn } from "@/lib/utils";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type ToolCardProps = {
  toolName: string;
  input: Record<string, unknown> | undefined;
  output: unknown;
  isRunning: boolean;
  isDone: boolean;
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function basename(filePath: string): string {
  return filePath.split("/").pop() ?? filePath;
}

const MAX_SEARCH_TITLE_LENGTH = 53;

function truncateText(value: string, maxLength: number): string {
  const text = value.trim();
  if (text.length <= maxLength) return text;
  return `${text.slice(0, Math.max(0, maxLength - 1)).trimEnd()}\u2026`;
}

function specialConfigFile(filePath: unknown, toolName: string):
  | {
      fileName: "agents.json" | "integration-setup.json";
      icon: React.ElementType;
      running: string;
      done: string;
    }
  | null {
  if (typeof filePath !== "string") return null;
  const fileName = basename(filePath);

  if (fileName === "agents.json") {
    return {
      fileName,
      icon: BotIcon,
      running: toolName === "Edit" ? "Updating defined agents" : "Setting up and defining agents",
      done: toolName === "Edit" ? "Updated agents" : "Defined agents",
    };
  }

  if (fileName === "integration-setup.json") {
    return {
      fileName,
      icon: PlugZapIcon,
      running: toolName === "Edit"
        ? "Updating integration setup instructions"
        : "Preparing integration setup instructions",
      done: toolName === "Edit"
        ? "Updated integration setup instructions"
        : "Prepared integration setup instructions",
    };
  }

  return null;
}

function specialReadFile(filePath: unknown):
  | {
      fileName: "agents.json" | "integration-setup.json";
      icon: React.ElementType;
      label: string;
    }
  | null {
  if (typeof filePath !== "string") return null;
  const fileName = basename(filePath);

  if (fileName === "agents.json") {
    return {
      fileName,
      icon: BotIcon,
      label: "Getting defined agents",
    };
  }

  if (fileName === "integration-setup.json") {
    return {
      fileName,
      icon: PlugZapIcon,
      label: "Getting integration setup instructions",
    };
  }

  return null;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string" && item.length > 0)
    : [];
}

function readLabel(input: Record<string, unknown>): string {
  const filePaths = stringArray(input.file_paths);
  if (filePaths.length > 1) return `${filePaths.length} files`;
  const filePath = filePaths[0] ?? input.file_path;
  return typeof filePath === "string" ? basename(filePath) : "";
}

function listLabel(input: Record<string, unknown>): string {
  const paths = stringArray(input.paths);
  if (paths.length > 1) return `${paths.length} locations`;
  const path = paths[0] ?? input.path ?? input.pattern;
  return typeof path === "string" && path ? path : ".";
}

function hostname(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

function faviconUrl(url: string): string {
  try {
    const origin = new URL(url).origin;
    return `https://www.google.com/s2/favicons?sz=32&domain=${origin}`;
  } catch {
    return "";
  }
}

function parseOutput(output: unknown): Record<string, unknown> | null {
  if (!output) return null;
  if (typeof output === "object") return output as Record<string, unknown>;
  if (typeof output === "string") {
    try {
      return JSON.parse(output);
    } catch {
      return null;
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Diff helpers
// ---------------------------------------------------------------------------

type DiffLine = { type: "add" | "del" | "meta"; text: string };
type NormalizedFileChange = {
  path: string;
  kind: string;
  diff: string;
  additions: number;
  deletions: number;
  isRawContent: boolean;
};

function changeKind(value: unknown): string {
  if (typeof value === "string") return value;
  const record = value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
  return typeof record?.type === "string" ? record.type : "";
}

function unifiedDiffStats(diff: string): { additions: number; deletions: number } {
  let additions = 0;
  let deletions = 0;
  for (const line of diff.split("\n")) {
    if (line.startsWith("+++") || line.startsWith("---") || line.startsWith("@@")) {
      continue;
    }
    if (line.startsWith("+")) additions += 1;
    if (line.startsWith("-")) deletions += 1;
  }
  return { additions, deletions };
}

function isUnifiedDiff(diff: string): boolean {
  return diff.split("\n").some((line) =>
    line.startsWith("diff --git ") ||
    line.startsWith("@@") ||
    line.startsWith("+++ ") ||
    line.startsWith("--- ")
  );
}

function textLineCount(text: string): number {
  if (!text) return 0;
  const normalized = text.endsWith("\n") ? text.slice(0, -1) : text;
  return normalized ? normalized.split("\n").length : 0;
}

function numericStat(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? value
    : null;
}

function fileChangeStats(
  record: Record<string, unknown>,
  kind: string,
  diff: string,
): { additions: number; deletions: number; isRawContent: boolean } {
  const explicitAdditions = numericStat(record.additions);
  const explicitDeletions = numericStat(record.deletions);
  if (explicitAdditions !== null || explicitDeletions !== null) {
    return {
      additions: explicitAdditions ?? 0,
      deletions: explicitDeletions ?? 0,
      isRawContent: false,
    };
  }

  if (isUnifiedDiff(diff)) {
    return { ...unifiedDiffStats(diff), isRawContent: false };
  }

  if (kind === "add") {
    return { additions: textLineCount(diff), deletions: 0, isRawContent: true };
  }

  if (kind === "delete") {
    return { additions: 0, deletions: textLineCount(diff), isRawContent: true };
  }

  return { ...unifiedDiffStats(diff), isRawContent: false };
}

function normalizedFileChanges(input: Record<string, unknown>): NormalizedFileChange[] {
  if (!Array.isArray(input.changes)) return [];

  return input.changes.flatMap((item): NormalizedFileChange[] => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return [];
    const record = item as Record<string, unknown>;
    const path = typeof record.path === "string" ? record.path : "";
    const diff = typeof record.diff === "string" ? record.diff : "";
    if (!path && !diff) return [];
    const kind = changeKind(record.kind);
    const stats = fileChangeStats(record, kind, diff);
    return [{
      path,
      kind,
      diff,
      additions: stats.additions,
      deletions: stats.deletions,
      isRawContent: stats.isRawContent,
    }];
  });
}

function hasFileToolDetails(input: Record<string, unknown>): boolean {
  if (Array.isArray(input.changes)) return true;
  if (typeof input.file_path !== "string" || !input.file_path) return false;
  return (
    typeof input.content === "string" ||
    typeof input.old_string === "string" ||
    typeof input.new_string === "string"
  );
}

function fileToolDetailsInput(
  input: Record<string, unknown>,
  output: unknown,
): Record<string, unknown> {
  const outputRecord = parseOutput(output);
  if (!outputRecord || !hasFileToolDetails(outputRecord)) return input;
  return { ...input, ...outputRecord };
}

/** Counts lines for the summary badge without building the expanded diff view. */
function getDiffStats(
  toolName: string,
  input: Record<string, unknown>,
): { additions: number; deletions: number } | null {
  const changes = normalizedFileChanges(input);
  if (changes.length > 0) {
    return changes.reduce(
      (total, change) => ({
        additions: total.additions + change.additions,
        deletions: total.deletions + change.deletions,
      }),
      { additions: 0, deletions: 0 },
    );
  }

  if (toolName === "Write" && typeof input.content === "string") {
    return { additions: textLineCount(input.content), deletions: 0 };
  }
  if (
    toolName === "Edit" &&
    typeof input.old_string === "string" &&
    typeof input.new_string === "string"
  ) {
    return {
      additions: textLineCount(input.new_string),
      deletions: textLineCount(input.old_string),
    };
  }
  return null;
}

/** Expensive: builds the full line array for the diff view. Only call when needed. */
function buildDiffLines(
  toolName: string,
  input: Record<string, unknown>,
): DiffLine[] {
  const changes = normalizedFileChanges(input);
  if (changes.length > 0) {
    const lines: DiffLine[] = [];
    for (const change of changes) {
      if (changes.length > 1 && change.path) {
        lines.push({ type: "meta", text: change.path });
      }
      if (change.isRawContent && (change.kind === "add" || change.kind === "delete")) {
        const type = change.kind === "add" ? "add" : "del";
        const content = change.diff.endsWith("\n") ? change.diff.slice(0, -1) : change.diff;
        for (const line of content.split("\n")) {
          lines.push({ type, text: line });
        }
        continue;
      }
      for (const line of change.diff.split("\n")) {
        if (line.startsWith("+++") || line.startsWith("---") || line.startsWith("@@")) {
          continue;
        }
        if (line.startsWith("+")) {
          lines.push({ type: "add", text: line.slice(1) });
        } else if (line.startsWith("-")) {
          lines.push({ type: "del", text: line.slice(1) });
        }
      }
    }
    return lines;
  }

  if (toolName === "Write" && typeof input.content === "string") {
    const content = input.content.endsWith("\n") ? input.content.slice(0, -1) : input.content;
    return content.split("\n").map((l) => ({ type: "add" as const, text: l }));
  }
  if (
    toolName === "Edit" &&
    typeof input.old_string === "string" &&
    typeof input.new_string === "string"
  ) {
    return [
      ...input.old_string.split("\n").map((l) => ({ type: "del" as const, text: l })),
      ...input.new_string.split("\n").map((l) => ({ type: "add" as const, text: l })),
    ];
  }
  return [];
}

// ---------------------------------------------------------------------------
// Search result extraction
// ---------------------------------------------------------------------------

type SearchResult = { title: string; url: string };

function searchResultFromRecord(record: Record<string, unknown>): SearchResult | null {
  const urlValue =
    record.url ??
    record.href ??
    record.link ??
    record.sourceUrl ??
    record.source_url;
  const url = typeof urlValue === "string" && urlValue ? urlValue : null;
  if (!url) return null;

  const titleValue =
    record.title ??
    record.name ??
    record.source ??
    record.domain ??
    record.hostname;
  const title = typeof titleValue === "string" && titleValue
    ? titleValue
    : hostname(url);

  return { title, url };
}

function collectStructuredSearchResults(value: unknown): SearchResult[] {
  if (!Array.isArray(value)) return [];

  const items: SearchResult[] = [];
  for (const entry of value) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
    const record = entry as Record<string, unknown>;
    const direct = searchResultFromRecord(record);
    if (direct) items.push(direct);

    if (Array.isArray(record.content)) {
      items.push(...collectStructuredSearchResults(record.content));
    }
  }

  return items;
}

function dedupeSearchResults(results: SearchResult[]): SearchResult[] {
  const seen = new Set<string>();
  const deduped: SearchResult[] = [];
  for (const result of results) {
    if (!result.url || seen.has(result.url)) continue;
    seen.add(result.url);
    deduped.push(result);
  }
  return deduped;
}

function extractSearchResults(output: unknown): SearchResult[] {
  // Flatten output to a string regardless of format
  let text = "";
  if (typeof output === "string") {
    text = output;
  } else if (output) {
    text = JSON.stringify(output);
  }
  if (!text) return [];

  // Try structured JSON first (SDK format)
  const parsed = parseOutput(output);
  const structured = [
    ...collectStructuredSearchResults(parsed?.results),
    ...collectStructuredSearchResults(parsed?.sources),
  ];
  if (structured.length > 0) {
    return dedupeSearchResults(structured);
  }

  // Fallback: extract URLs from plain text / JSON-stringified content
  const urlRegex = /https?:\/\/[^\s"',)\]}>]+/g;
  const seen = new Set<string>();
  const items: SearchResult[] = [];
  for (const match of text.matchAll(urlRegex)) {
    const url = match[0].replace(/[.)]+$/, ""); // strip trailing punctuation
    const host = hostname(url);
    if (seen.has(host)) continue; // dedupe by domain
    seen.add(host);
    items.push({ title: host, url });
  }
  return items;
}

function searchQueryFromRecord(record: Record<string, unknown> | null): string {
  const query = record?.query;
  if (typeof query === "string" && query.trim()) return query;

  const action = parseOutput(record?.action);
  const actionQuery = action?.query;
  if (typeof actionQuery === "string" && actionQuery.trim()) return actionQuery;

  const actionQueries = action?.queries;
  if (Array.isArray(actionQueries)) {
    const firstQuery = actionQueries.find(
      (item): item is string => typeof item === "string" && item.trim().length > 0,
    );
    if (firstQuery) return firstQuery;
  }

  return "";
}

function webSearchLabel(
  input: Record<string, unknown>,
  output: unknown,
): string {
  const outputRecord = parseOutput(output);
  const query = searchQueryFromRecord(input) || searchQueryFromRecord(outputRecord);
  return truncateText(query || "Search", MAX_SEARCH_TITLE_LENGTH);
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function DiffStats({
  additions,
  deletions,
}: {
  additions: number;
  deletions: number;
}) {
  if (additions <= 0 && deletions <= 0) return null;

  return (
    <span className="flex items-center gap-1.5 text-xs font-mono">
      {additions > 0 && (
        <span className="text-emerald-700 dark:text-emerald-400">
          +{additions}
        </span>
      )}
      {deletions > 0 && (
        <span className="text-red-600 dark:text-red-400">
          -{deletions}
        </span>
      )}
    </span>
  );
}

function DiffView({ lines }: { lines: DiffLine[] }) {
  return (
    <div className="mt-2 overflow-hidden rounded-lg border border-border text-xs font-mono">
      <div className="max-h-64 overflow-auto">
        {lines.map((line, i) => (
          <div
            key={i}
            className={cn(
              "flex",
              line.type === "meta"
                ? "bg-muted/50"
                : line.type === "add"
                  ? "bg-emerald-50 dark:bg-emerald-950/30"
                  : "bg-red-50 dark:bg-red-950/30",
            )}
          >
            <span
              className={cn(
                "w-8 shrink-0 select-none border-r border-border px-2 py-0.5 text-right",
                line.type === "meta"
                  ? "bg-muted text-muted-foreground/60"
                  : line.type === "add"
                    ? "text-emerald-600/60 dark:text-emerald-500/50 bg-emerald-100/50 dark:bg-emerald-900/20"
                    : "text-red-500/60 dark:text-red-500/50 bg-red-100/50 dark:bg-red-900/20",
              )}
            >
              {line.type === "meta" ? "" : line.type === "add" ? "+" : "-"}
            </span>
            <span
              className={cn(
                "flex-1 px-3 py-0.5 whitespace-pre-wrap break-words",
                line.type === "meta"
                  ? "font-medium text-muted-foreground"
                  : line.type === "add"
                    ? "text-emerald-900 dark:text-emerald-300"
                    : "text-red-900 dark:text-red-300",
              )}
            >
              {line.text}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function InlinePathList({ paths }: { paths: string[] }) {
  return (
    <div className="mt-1.5 flex flex-col gap-1 pl-10 text-sm text-muted-foreground">
      {paths.map((path) => (
        <div key={path}>
          {path}
        </div>
      ))}
    </div>
  );
}

function SourceChip({ result }: { result: SearchResult }) {
  const icon = faviconUrl(result.url);
  const title = truncateText(
    result.title || hostname(result.url),
    MAX_SEARCH_TITLE_LENGTH,
  );

  return (
    <a
      href={result.url}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex items-center gap-1 rounded-full border border-border bg-muted/40 px-1.5 py-0.5 text-xs leading-tight text-foreground/80 transition-colors hover:bg-muted hover:text-foreground"
    >
      {icon && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={icon}
          alt=""
          width={12}
          height={12}
          className="size-3 rounded-sm"
        />
      )}
      <span className="max-w-[180px] truncate">{title}</span>
      <ExternalLinkIcon className="size-3 shrink-0 text-muted-foreground" />
    </a>
  );
}

function SourceChips({ results }: { results: SearchResult[] }) {
  if (results.length === 0) return null;
  return (
    <div className="mt-2 flex flex-wrap gap-1.5">
      {results.map((r, i) => (
        <SourceChip key={i} result={r} />
      ))}
    </div>
  );
}

function InlineSourceChips({ results }: { results: SearchResult[] }) {
  if (results.length === 0) return null;
  return (
    <span className="inline-flex items-center gap-1.5">
      {results.map((r, i) => (
        <SourceChip key={i} result={r} />
      ))}
    </span>
  );
}

function SpecialConfigFileTool({
  fileName,
  icon,
  label,
  isRunning,
  isDone,
}: {
  fileName: string;
  icon: React.ElementType;
  label: string;
  isRunning: boolean;
  isDone: boolean;
}) {
  const Icon = icon;
  return (
    <div className="not-prose flex items-center gap-2 text-sm text-muted-foreground">
      <Icon className="size-4" />
      <span className="text-foreground/85">{label}</span>
      <span className="rounded-md border border-border/70 bg-muted/30 px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground">
        {fileName}
      </span>
      {isRunning ? <AppLoader size="xs" /> : null}
      {isDone ? <CheckIcon className="size-3.5 text-emerald-600 dark:text-emerald-400" /> : null}
    </div>
  );
}

function StackedFavicons({ results }: { results: SearchResult[] }) {
  const show = results.slice(0, 4);
  const hasMore = results.length > 4;
  return (
    <span className="inline-flex items-center">
      {show.map((r, i) => {
        const icon = faviconUrl(r.url);
        return (
          <span
            key={i}
            className="inline-flex size-5 items-center justify-center rounded-full border-2 border-[var(--composer-bg)] bg-muted"
            style={{ marginLeft: i === 0 ? 0 : -6 }}
          >
            {icon && (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={icon}
                alt=""
                width={12}
                height={12}
                className="size-3 rounded-sm"
              />
            )}
          </span>
        );
      })}
      {hasMore && (
        <span
          className="inline-flex size-5 items-center justify-center rounded-full border-2 border-[var(--composer-bg)] bg-muted text-[9px] font-medium text-muted-foreground"
          style={{ marginLeft: -6 }}
        >
          …
        </span>
      )}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Tool configs
// ---------------------------------------------------------------------------

const TOOL_META: Record<
  string,
  {
    icon: React.ElementType;
    label: (input: Record<string, unknown>) => string;
    runningText: string;
  }
> = {
  Write: {
    icon: FilePlusIcon,
    label: (input) => basename(String(input.file_path ?? "")),
    runningText: "Creating…",
  },
  Edit: {
    icon: FilePenLineIcon,
    label: (input) => basename(String(input.file_path ?? "")),
    runningText: "Editing…",
  },
  Read: {
    icon: FileTextIcon,
    label: readLabel,
    runningText: "Reading…",
  },
  List: {
    icon: FolderSearchIcon,
    label: listLabel,
    runningText: "Listing…",
  },
  Glob: {
    icon: FolderSearchIcon,
    label: (input) => String(input.pattern ?? ""),
    runningText: "Searching…",
  },
  Grep: {
    icon: SearchIcon,
    label: (input) => String(input.pattern ?? ""),
    runningText: "Searching…",
  },
  WebSearch: {
    icon: GlobeIcon,
    label: (input) => truncateText(String(input.query ?? ""), MAX_SEARCH_TITLE_LENGTH),
    runningText: "Searching…",
  },
  WebFetch: {
    icon: GlobeIcon,
    label: (input) => hostname(String(input.url ?? "")),
    runningText: "Fetching…",
  },
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export const ToolCard = memo(function ToolCard({
  toolName,
  input,
  output,
  isRunning,
  isDone,
}: ToolCardProps) {
  const [isOpen, setIsOpen] = useState(false);
  const meta = TOOL_META[toolName];
  if (!meta) return null;

  const safeInput = input ?? {};
  const Icon = meta.icon;
  const label = meta.label(safeInput);

  // --- Write / Edit: collapsible diff ---
  if (toolName === "Write" || toolName === "Edit") {
    const fileInput = fileToolDetailsInput(safeInput, output);
    const fileChanges = normalizedFileChanges(fileInput);
    const multiFile = fileChanges.length > 1;
    const allAdds = fileChanges.length > 0
      ? fileChanges.every((change) => change.kind === "add")
      : toolName === "Write";
    const singleChangePath = fileChanges.length === 1
      ? fileChanges[0]?.path
      : typeof fileInput.file_path === "string"
        ? fileInput.file_path
        : "";
    const fileLabel = multiFile
      ? `${fileChanges.length} files`
      : singleChangePath
        ? basename(singleChangePath)
        : label;
    const special = multiFile ? null : specialConfigFile(singleChangePath, toolName);
    if (special) {
      return (
        <SpecialConfigFileTool
          fileName={special.fileName}
          icon={special.icon}
          label={isDone ? special.done : special.running}
          isRunning={isRunning}
          isDone={isDone}
        />
      );
    }
    const FileIcon = allAdds ? FilePlusIcon : FilePenLineIcon;

    // Only compute cheap stats for the summary badge; defer full line
    // array until the user actually opens the collapsible.
    const stats = getDiffStats(toolName, fileInput);
    const actionLabel = isDone
      ? allAdds
        ? "Created"
        : "Edited"
      : allAdds
        ? "Creating"
        : "Editing";

    if (stats && (stats.additions > 0 || stats.deletions > 0)) {
      return (
        <Collapsible
          className="not-prose"
          open={isOpen}
          onOpenChange={setIsOpen}
        >
          <CollapsibleTrigger className="flex items-center gap-2 text-sm text-muted-foreground transition-colors hover:text-foreground">
            <FileIcon className="size-4" />
            <span className="text-primary">{actionLabel}</span>
            {fileLabel ? <span className="text-muted-foreground">{fileLabel}</span> : null}
            <DiffStats
              additions={stats.additions}
              deletions={stats.deletions}
            />
            {isRunning && <AppLoader size="xs" interactive={false} />}
            {isDone && <CheckIcon className="size-3.5 text-emerald-600 dark:text-emerald-400" />}
            <ChevronDownIcon
              className={cn(
                "size-4 transition-transform",
                isOpen ? "rotate-180" : "rotate-0",
              )}
            />
          </CollapsibleTrigger>
          <CollapsibleContent>
            {isOpen && <DiffView lines={buildDiffLines(toolName, fileInput)} />}
          </CollapsibleContent>
        </Collapsible>
      );
    }

    // Still running
    return (
      <div className="not-prose flex items-center gap-2 text-sm text-muted-foreground">
        <FileIcon className="size-4" />
        <span className="text-primary">{actionLabel}</span>
        {fileLabel ? <span className="text-muted-foreground">{fileLabel}</span> : null}
        {isRunning && <AppLoader size="xs" />}
        {isDone && <CheckIcon className="size-3.5 text-emerald-600 dark:text-emerald-400" />}
      </div>
    );
  }

  if (toolName === "Read") {
    const filePaths = stringArray(safeInput.file_paths);
    if (filePaths.length > 1) {
      return (
        <Collapsible
          className="not-prose"
          open={isOpen}
          onOpenChange={setIsOpen}
        >
          <CollapsibleTrigger className="flex items-center gap-2 text-sm text-muted-foreground transition-colors hover:text-foreground">
            <Icon className="size-4" />
            <span className="text-primary">Read</span>
            <span className="text-muted-foreground">{filePaths.length} files</span>
            {isRunning && <AppLoader size="xs" interactive={false} />}
            {isDone && <CheckIcon className="size-3.5 text-emerald-600 dark:text-emerald-400" />}
            <ChevronDownIcon
              className={cn(
                "size-4 transition-transform",
                isOpen ? "rotate-180" : "rotate-0",
              )}
            />
          </CollapsibleTrigger>
          <CollapsibleContent>
            {isOpen && <InlinePathList paths={filePaths} />}
          </CollapsibleContent>
        </Collapsible>
      );
    }

    const special = specialReadFile(safeInput.file_path);
    if (special) {
      return (
        <SpecialConfigFileTool
          fileName={special.fileName}
          icon={special.icon}
          label={special.label}
          isRunning={isRunning}
          isDone={isDone}
        />
      );
    }

    return (
      <div className="not-prose flex items-center gap-2 text-sm text-muted-foreground">
        <Icon className="size-4" />
        <span className="text-primary">Read</span>
        {label ? <span className="text-muted-foreground">{label}</span> : null}
        {isRunning && <AppLoader size="xs" />}
        {isDone && <CheckIcon className="size-3.5 text-emerald-600 dark:text-emerald-400" />}
      </div>
    );
  }

  if (toolName === "List") {
    const paths = stringArray(safeInput.paths);
    if (paths.length > 1) {
      return (
        <Collapsible
          className="not-prose"
          open={isOpen}
          onOpenChange={setIsOpen}
        >
          <CollapsibleTrigger className="flex items-center gap-2 text-sm text-muted-foreground transition-colors hover:text-foreground">
            <Icon className="size-4" />
            <span className="text-primary">{isDone ? "Listed" : "Listing"}</span>
            <span className="text-muted-foreground">{paths.length} locations</span>
            {isRunning && <AppLoader size="xs" interactive={false} />}
            {isDone && <CheckIcon className="size-3.5 text-emerald-600 dark:text-emerald-400" />}
            <ChevronDownIcon
              className={cn(
                "size-4 transition-transform",
                isOpen ? "rotate-180" : "rotate-0",
              )}
            />
          </CollapsibleTrigger>
          <CollapsibleContent>
            {isOpen && <InlinePathList paths={paths} />}
          </CollapsibleContent>
        </Collapsible>
      );
    }

    return (
      <div className="not-prose flex items-center gap-2 text-sm text-muted-foreground">
        <Icon className="size-4" />
        <span className="text-primary">{isDone ? "Listed" : "Listing"}</span>
        {label ? <span className="text-muted-foreground">{label}</span> : null}
        {isRunning && <AppLoader size="xs" />}
        {isDone && <CheckIcon className="size-3.5 text-emerald-600 dark:text-emerald-400" />}
      </div>
    );
  }

  // --- WebSearch ---
  if (toolName === "WebSearch") {
    const results = isDone ? extractSearchResults(output) : [];
    const searchLabel = webSearchLabel(safeInput, output);

    // < 3 results: show inline chips directly
    if (isDone && results.length > 0 && results.length < 3) {
      return (
        <div className="not-prose flex items-center gap-2 text-sm text-muted-foreground">
          <Icon className="size-4" />
          <span className="truncate">{searchLabel}</span>
          <InlineSourceChips results={results} />
        </div>
      );
    }

    // 3+ results: stacked favicons + "N sources", collapsible
    if (isDone && results.length >= 3) {
      return (
        <Collapsible
          className="not-prose"
          open={isOpen}
          onOpenChange={setIsOpen}
        >
          <CollapsibleTrigger className="flex items-center gap-2 text-sm text-muted-foreground transition-colors hover:text-foreground">
            <Icon className="size-4" />
            <span className="truncate">{searchLabel}</span>
            <StackedFavicons results={results} />
            <span className="text-muted-foreground/70">
              {results.length} sources
            </span>
            <ChevronDownIcon
              className={cn(
                "size-4 transition-transform",
                isOpen ? "rotate-180" : "rotate-0",
              )}
            />
          </CollapsibleTrigger>
          <CollapsibleContent>
            <SourceChips results={results} />
          </CollapsibleContent>
        </Collapsible>
      );
    }

    // Running or no results
    return (
      <div className="not-prose flex items-center gap-2 text-sm text-muted-foreground">
        <Icon className="size-4" />
        <span className="truncate">{isRunning ? label || "Searching…" : searchLabel}</span>
        {isRunning && <AppLoader size="xs" />}
        {isDone && results.length === 0 && (
          <span className="text-muted-foreground/70">Searched</span>
        )}
      </div>
    );
  }

  // --- WebFetch: show URL chip ---
  if (toolName === "WebFetch") {
    const url = typeof safeInput.url === "string" ? safeInput.url : "";
    const icon = url ? faviconUrl(url) : "";

    return (
      <div className="not-prose flex items-center gap-2 text-sm text-muted-foreground">
        <Icon className="size-4" />
        <span className="truncate">{label}</span>
        {isRunning && <AppLoader size="xs" />}
        {isDone && (
          <span className="text-muted-foreground/70">Fetched</span>
        )}
        {isDone && url && (
          <a
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 rounded-full border border-border bg-muted/40 px-1.5 py-0.5 text-xs leading-tight text-foreground/80 transition-colors hover:bg-muted hover:text-foreground"
          >
            {icon && (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={icon}
                alt=""
                width={12}
                height={12}
                className="size-3 rounded-sm"
              />
            )}
            <span className="max-w-[200px] truncate">
              {hostname(url)}
            </span>
            <ExternalLinkIcon className="size-3 shrink-0 text-muted-foreground" />
          </a>
        )}
      </div>
    );
  }

  // --- Read / Glob / Grep: simple one-liner ---
  return (
    <div className="not-prose flex items-center gap-2 text-sm text-muted-foreground">
      <Icon className="size-4" />
      <span>{label}</span>
      {isRunning && <AppLoader size="xs" />}
      {isDone && <CheckIcon className="size-3.5 text-emerald-600 dark:text-emerald-400" />}
    </div>
  );
});

/** Check if a tool name has a dedicated card */
export function hasToolCard(toolName: string): boolean {
  return toolName in TOOL_META;
}
