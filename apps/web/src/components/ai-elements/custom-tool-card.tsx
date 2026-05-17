"use client";

import { useMemo, useState } from "react";
import {
  CheckIcon,
  ChevronDownIcon,
  DatabaseIcon,
  FileSearchIcon,
  PencilLineIcon,
  PlusIcon,
  Trash2Icon,
  TriangleAlertIcon,
  WrenchIcon,
} from "lucide-react";
import { AppLoader } from "@/components/app-loader";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { integrationIconUrl } from "@/lib/integration-icons";
import { cn } from "@/lib/utils";

export { faviconUrl } from "@/lib/integration-icons";

export type CustomToolMeta = {
  name: string;
  displayName?: string;
  description?: string;
  integration?: {
    name: string;
    domain: string;
    auth?: {
      providerKey?: string;
      scopes?: string[];
    } | null;
  } | null;
  endpoint?: {
    method?: string;
    url?: string;
  } | null;
};

type PrettyValue =
  | { kind: "empty"; text: string }
  | { kind: "text"; text: string }
  | { kind: "json"; value: unknown; note?: string };

type CustomToolCardProps = {
  toolName: string;
  input?: Record<string, unknown>;
  output: unknown;
  isRunning: boolean;
  isDone: boolean;
  meta?: CustomToolMeta;
};

type AppDataToolCardProps = {
  toolName: string;
  input?: Record<string, unknown>;
  output: unknown;
  isRunning: boolean;
  isDone: boolean;
};

export function getCustomToolInvocationName(toolName: string): string {
  return toolName.replace(/^mcp__app_tools__/, "");
}

export function formatToolDisplayName(name: string): string {
  const raw = getCustomToolInvocationName(name);
  const words = raw
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .split(/[_\-\s]+/)
    .filter(Boolean);

  if (words.length === 0) return "Custom Tool";

  return words
    .map((word) => {
      if (word.length <= 3 && word === word.toUpperCase()) return word;
      return `${word.slice(0, 1).toUpperCase()}${word.slice(1)}`;
    })
    .join(" ");
}

function slug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
}

export function formatToolActionName(
  name: string,
  integrationName?: string,
): string {
  let raw = getCustomToolInvocationName(name);
  const integrationSlug = integrationName ? slug(integrationName) : "";
  const rawSlug = slug(raw);

  if (integrationSlug && rawSlug.startsWith(`${integrationSlug}_`)) {
    raw = raw.slice(integrationSlug.length).replace(/^[_\-\s]+/, "");
  }

  return formatToolDisplayName(raw);
}

function hostname(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

function decodeEscapedText(text: string): string {
  const trimmed = text.trim();

  try {
    const parsed = JSON.parse(trimmed);
    if (typeof parsed === "string") return parsed;
  } catch {
    // Continue with display-only unescaping below.
  }

  return text
    .replace(/\\r\\n/g, "\n")
    .replace(/\\n/g, "\n")
    .replace(/\\t/g, "\t")
    .replace(/\\"/g, '"');
}

function tryParseJson(text: string): { ok: true; value: unknown } | { ok: false } {
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch {
    return { ok: false };
  }
}

function extractJsonPayload(text: string): { note?: string; value: unknown } | null {
  const candidates = [text.indexOf("{"), text.indexOf("[")]
    .filter((index) => index >= 0)
    .sort((a, b) => a - b);

  for (const index of candidates) {
    const parsed = tryParseJson(text.slice(index).trim());
    if (parsed.ok) {
      return {
        note: text.slice(0, index).trim() || undefined,
        value: parsed.value,
      };
    }
  }

  return null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function extractMcpText(value: unknown): string | null {
  const record = asRecord(value);
  const content = Array.isArray(value) ? value : record?.content;
  if (!Array.isArray(content)) return null;

  const chunks = content.flatMap((item) => {
    const itemRecord = asRecord(item);
    const text = itemRecord?.text;
    if (typeof text === "string") return [text];
    return [];
  });

  return chunks.length > 0 ? chunks.join("\n") : null;
}

function parseTextValue(text: string): unknown {
  const decoded = decodeEscapedText(text);
  const trimmed = decoded.trim();
  if (!trimmed) return decoded;

  const parsed = tryParseJson(trimmed);
  if (parsed.ok) {
    if (typeof parsed.value === "string") return parseTextValue(parsed.value);
    return parsed.value;
  }

  return extractJsonPayload(trimmed)?.value ?? decoded;
}

function normalizeToolValue(value: unknown): unknown {
  const text = extractMcpText(value);
  if (text !== null) return parseTextValue(text);
  if (typeof value === "string") return parseTextValue(value);
  return value;
}

function normalizeInput(input: Record<string, unknown> | undefined): unknown {
  if (!input) return null;

  const keys = Object.keys(input);
  if (keys.length === 1 && typeof input.input === "string") {
    const text = decodeEscapedText(input.input);
    const parsed = tryParseJson(text.trim());
    return parsed.ok ? parsed.value : text;
  }

  return input;
}

function toPrettyValue(value: unknown, emptyText: string): PrettyValue {
  const rawText = outputText(value);
  value = normalizeToolValue(value);

  if (value == null) return { kind: "empty", text: emptyText };

  if (typeof value !== "string") {
    return { kind: "json", value };
  }

  const decoded = decodeEscapedText(value);
  const trimmed = decoded.trim();
  if (!trimmed || trimmed === '""' || trimmed === "Completed") {
    return { kind: "empty", text: emptyText };
  }

  if (rawText.startsWith("Using mock data:")) {
    const extracted = extractJsonPayload(rawText);
    if (extracted) return { kind: "json", value: extracted.value, note: extracted.note };
  }

  const parsed = tryParseJson(trimmed);
  if (parsed.ok) return { kind: "json", value: parsed.value };

  const extracted = extractJsonPayload(trimmed);
  if (extracted) {
    return {
      kind: "json",
      value: extracted.value,
      note: extracted.note,
    };
  }

  return { kind: "text", text: decoded };
}

function parseDisplayJson(value: unknown): unknown | null {
  const normalized = normalizeToolValue(value);

  if (normalized == null) return null;
  if (typeof normalized !== "string") return normalized;

  const decoded = decodeEscapedText(normalized);
  const trimmed = decoded.trim();
  if (!trimmed) return null;

  const parsed = tryParseJson(trimmed);
  if (parsed.ok) return parsed.value;

  return extractJsonPayload(trimmed)?.value ?? null;
}

function outputText(value: unknown): string {
  const extracted = extractMcpText(value);
  const normalized = extracted ?? value;
  if (typeof normalized === "string") return decodeEscapedText(normalized);
  if (normalized == null) return "";
  return JSON.stringify(normalized);
}

function primitiveSummary(value: unknown): string {
  if (value == null) return "None";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) {
    return `${value.length} item${value.length === 1 ? "" : "s"}`;
  }

  const record = asRecord(value);
  if (!record) return String(value);

  if (record.success === true && record.doc) return "Saved";
  if (typeof record.object === "string" && Array.isArray(record.results)) {
    return `${record.object} · ${record.results.length} result${
      record.results.length === 1 ? "" : "s"
    }`;
  }
  if (Array.isArray(record.blocks)) {
    return `${record.blocks.length} block${record.blocks.length === 1 ? "" : "s"}`;
  }
  if (typeof record.type === "string" && typeof record.id === "string") {
    return `${record.type} · ${record.id}`;
  }

  const keys = Object.keys(record);
  return keys.length > 0 ? keys.slice(0, 4).join(", ") : "Object";
}

function previewEntries(value: unknown): Array<{ label: string; value: string }> {
  if (Array.isArray(value)) {
    return value.slice(0, 4).map((item, index) => ({
      label: `#${index + 1}`,
      value: primitiveSummary(item),
    }));
  }

  const record = asRecord(value);
  if (!record) return [];

  return Object.entries(record).slice(0, 7).map(([key, entry]) => ({
    label: key,
    value: primitiveSummary(entry),
  }));
}

function StructuredPreview({ value }: { value: unknown }) {
  const entries = previewEntries(value);

  if (entries.length === 0) {
    return (
      <pre className="whitespace-pre-wrap break-words font-mono text-[11px] leading-5 text-foreground/90">
        {primitiveSummary(value)}
      </pre>
    );
  }

  return (
    <div className="space-y-1.5">
      <div className="truncate text-xs font-medium text-foreground/85">
        {primitiveSummary(value)}
      </div>
      <div className="grid gap-1.5">
        {entries.map((entry) => (
          <div
            key={entry.label}
            className="grid grid-cols-[minmax(5.5rem,0.38fr)_minmax(0,1fr)] gap-2 text-[11px] leading-4"
          >
            <span className="truncate font-mono text-muted-foreground">
              {entry.label}
            </span>
            <span className="truncate text-foreground/85">{entry.value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function ValuePanel({
  label,
  value,
  emptyText,
}: {
  label: string;
  value: unknown;
  emptyText: string;
}) {
  const pretty = useMemo(() => toPrettyValue(value, emptyText), [value, emptyText]);

  return (
    <div className="min-w-0">
      <div className="mb-1.5 flex items-center justify-between gap-2 px-0.5">
        <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground/80">
          {label}
        </span>
        {pretty.kind === "json" ? (
          <span className="font-mono text-[9px] uppercase tracking-wider text-muted-foreground/60">
            JSON
          </span>
        ) : null}
      </div>
      <div className="max-h-36 min-h-[2.25rem] overflow-auto rounded-lg border border-border/70 bg-background/40 px-3 py-2">
        {pretty.kind === "empty" ? (
          <p className="text-xs text-muted-foreground">{pretty.text}</p>
        ) : pretty.kind === "text" ? (
          <pre className="whitespace-pre-wrap break-words font-mono text-[11px] leading-5 text-foreground/90">
            {pretty.text}
          </pre>
        ) : (
          <div className="flex flex-col gap-1.5">
            {pretty.note ? (
              <p className="whitespace-pre-wrap text-xs leading-relaxed text-muted-foreground">
                {pretty.note}
              </p>
            ) : null}
            <StructuredPreview value={pretty.value} />
          </div>
        )}
      </div>
    </div>
  );
}

export function CustomToolCard({
  toolName,
  input,
  output,
  isRunning,
  isDone,
  meta,
}: CustomToolCardProps) {
  const rawName = meta?.name ?? getCustomToolInvocationName(toolName);
  const displayName =
    meta?.displayName?.trim() ||
    formatToolActionName(rawName, meta?.integration?.name);
  const integrationName = meta?.integration?.name ?? "Custom integration";
  const domain = meta?.integration?.domain;
  const host = meta?.endpoint?.url ? hostname(meta.endpoint.url) : domain;
  const iconUrl = integrationIconUrl({
    name: meta?.integration?.name,
    domain,
    endpointUrl: meta?.endpoint?.url,
    auth: meta?.integration?.auth,
  });
  const normalizedInput = useMemo(() => normalizeInput(input), [input]);
  const normalizedOutput = useMemo(() => normalizeToolValue(output), [output]);
  const displayOutputText = outputText(output);
  const isMockOutput =
    displayOutputText.trim().startsWith("Using mock data:");
  const isErrorOutput =
    /^(Tool execution failed|Failed to|Access denied)/.test(
      displayOutputText.trim(),
    );
  const [manualOpen, setManualOpen] = useState(false);
  const [dismissedAutoOpen, setDismissedAutoOpen] = useState(false);
  const shouldAutoOpen = (isMockOutput || isErrorOutput) && !dismissedAutoOpen;
  const isOpen = manualOpen || shouldAutoOpen;

  function handleOpenChange(nextOpen: boolean) {
    setManualOpen(nextOpen);
    if (!nextOpen && shouldAutoOpen) setDismissedAutoOpen(true);
  }

  return (
    <Collapsible
      open={isOpen}
      onOpenChange={handleOpenChange}
      className="not-prose"
    >
      <CollapsibleTrigger
        className={cn(
          "group flex w-full min-w-0 items-center gap-2 text-left text-sm text-muted-foreground transition-colors hover:text-foreground",
          (isMockOutput || isErrorOutput) && "text-foreground",
        )}
      >
        <span className="flex size-5 shrink-0 items-center justify-center rounded-md border border-border/70 bg-background/70">
          {domain ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={iconUrl}
              alt=""
              width={18}
              height={18}
              className="size-3.5 rounded-sm"
            />
          ) : (
            <WrenchIcon className="size-3.5 text-muted-foreground" />
          )}
        </span>

        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-1">
          <span className="truncate font-medium text-foreground">
            {integrationName}
          </span>
          <span className="min-w-0 truncate font-medium text-muted-foreground">
            {displayName}
          </span>
          {host ? (
            <span className="hidden min-w-0 truncate rounded-md bg-muted/60 px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground sm:inline">
              {host}
            </span>
          ) : null}
        </div>

        <div className="ml-auto flex shrink-0 items-center gap-2">
          {isRunning ? (
            <AppLoader size="xs" interactive={false} />
          ) : isErrorOutput ? (
            <TriangleAlertIcon className="size-3.5 text-destructive" />
          ) : isMockOutput ? (
            <span className="rounded-full border border-amber-500/25 bg-amber-500/10 px-1.5 py-0.5 text-[11px] font-medium text-amber-700 dark:text-amber-300">
              Mock
            </span>
          ) : isDone ? (
            <CheckIcon className="size-3.5 text-emerald-600 dark:text-emerald-400" />
          ) : null}
          <ChevronDownIcon
            className={cn(
              "size-4 text-muted-foreground transition-transform",
              isOpen ? "rotate-180" : "rotate-0",
            )}
          />
        </div>
      </CollapsibleTrigger>

      <CollapsibleContent>
        <div className="ml-7 space-y-3 pt-2">
          {meta?.description ? (
            <p className="text-xs leading-relaxed text-muted-foreground">
              {meta.description}
            </p>
          ) : null}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <ValuePanel
              label="Input"
              value={normalizedInput}
              emptyText={isRunning ? "Streaming input..." : "No input parameters"}
            />
            <ValuePanel
              label="Output"
              value={isDone ? normalizedOutput : null}
              emptyText={isRunning ? "Waiting for response..." : "No output"}
            />
          </div>
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

function appDataAction(toolName: string, input: Record<string, unknown> | undefined) {
  if (toolName === "mcp__app_data__read_app_data") return "Read";
  const operation = typeof input?.operation === "string" ? input.operation : "write";
  return `${operation.slice(0, 1).toUpperCase()}${operation.slice(1)}`;
}

function AppDataActionIcon({ action }: { action: string }) {
  const className = "size-4 shrink-0";

  switch (action.toLowerCase()) {
    case "read":
      return <FileSearchIcon className={className} />;
    case "insert":
      return <PlusIcon className={className} />;
    case "delete":
      return <Trash2Icon className={className} />;
    case "update":
    case "upsert":
      return <PencilLineIcon className={className} />;
    default:
      return <DatabaseIcon className={className} />;
  }
}

function appDataDocId(toolName: string, input: Record<string, unknown> | undefined) {
  if (toolName === "mcp__app_data__read_app_data") {
    return typeof input?.docId === "string" ? input.docId : null;
  }

  const filter = asRecord(input?.filter);
  return typeof filter?._id === "string" ? filter._id : null;
}

function appDataOutputSummary(output: unknown): string | null {
  const parsed = parseDisplayJson(output);
  if (Array.isArray(parsed)) return `${parsed.length} doc${parsed.length === 1 ? "" : "s"}`;

  const record = asRecord(parsed);
  if (!record) return null;

  if (record.success === true && record.doc) return "Saved";
  if (record._id) return "1 doc";
  if (Array.isArray(record.docs)) {
    return `${record.docs.length} doc${record.docs.length === 1 ? "" : "s"}`;
  }

  return null;
}

function appDataError(output: unknown): boolean {
  return /^(Failed to|Access denied)/.test(outputText(output).trim());
}

export function AppDataToolCard({
  toolName,
  input,
  output,
  isRunning,
  isDone,
}: AppDataToolCardProps) {
  const [manualOpen, setManualOpen] = useState(false);
  const [dismissedAutoOpen, setDismissedAutoOpen] = useState(false);
  const action = appDataAction(toolName, input);
  const collection =
    typeof input?.collection === "string" ? input.collection : "app data";
  const docId = appDataDocId(toolName, input);
  const summary = isDone ? appDataOutputSummary(output) : null;
  const hasError = isDone && appDataError(output);
  const shouldAutoOpen = hasError && !dismissedAutoOpen;
  const isOpen = manualOpen || shouldAutoOpen;
  const filter = input?.filter;
  const data = input?.data;
  const normalizedAction = action.toLowerCase();
  const hasWriteDetails = filter != null || data != null;

  function handleOpenChange(nextOpen: boolean) {
    setManualOpen(nextOpen);
    if (!nextOpen && shouldAutoOpen) setDismissedAutoOpen(true);
  }

  return (
    <Collapsible
      open={isOpen}
      onOpenChange={handleOpenChange}
      className="not-prose"
    >
      <CollapsibleTrigger className="group flex w-full min-w-0 items-center gap-2 text-left text-sm text-muted-foreground transition-colors hover:text-foreground">
        <AppDataActionIcon action={action} />
        <span className="text-primary">{action}</span>
        <span className="min-w-0 truncate rounded-md bg-muted/60 px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground">
          {collection}
        </span>
        {docId ? (
          <span className="hidden max-w-[180px] truncate font-mono text-[11px] text-muted-foreground/80 sm:inline">
            {docId}
          </span>
        ) : null}
        {summary ? (
          <span className="text-xs text-muted-foreground/80">{summary}</span>
        ) : null}

        <span className="ml-auto flex shrink-0 items-center gap-2">
          {isRunning ? (
            <AppLoader size="xs" interactive={false} />
          ) : hasError ? (
            <TriangleAlertIcon className="size-3.5 text-destructive" />
          ) : isDone ? (
            <CheckIcon className="size-3.5 text-emerald-600 dark:text-emerald-400" />
          ) : null}
          <ChevronDownIcon
            className={cn(
              "size-4 transition-transform",
              isOpen ? "rotate-180" : "rotate-0",
            )}
          />
        </span>
      </CollapsibleTrigger>

      <CollapsibleContent>
        <div className="ml-6 grid grid-cols-1 gap-3 pt-2 sm:grid-cols-3">
          {toolName === "mcp__app_data__read_app_data" ? (
            <ValuePanel
              label="Read query"
              value={input ?? null}
              emptyText="No query"
            />
          ) : normalizedAction === "insert" ? (
            <ValuePanel
              label="Document"
              value={data}
              emptyText="No document fields"
            />
          ) : hasWriteDetails ? (
            <>
              <ValuePanel
                label="Filter"
                value={filter}
                emptyText="No filter"
              />
              <ValuePanel label="Data" value={data} emptyText="No data fields" />
            </>
          ) : (
            <ValuePanel
              label="Write input"
              value={input ?? null}
              emptyText="No input"
            />
          )}
          <ValuePanel
            label="Result"
            value={isDone ? output : null}
            emptyText={isRunning ? "Waiting for database..." : "No result"}
          />
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}
