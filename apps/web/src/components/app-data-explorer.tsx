"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  CheckIcon,
  Clock3Icon,
  CopyIcon,
  DatabaseIcon,
  DownloadIcon,
  FileJsonIcon,
  FileTextIcon,
  RefreshCwIcon,
  SearchIcon,
  Table2Icon,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import type { AppDataLiveChange } from "@/components/app-data-bridge";
import { cn } from "@/lib/utils";

type AppDataDoc = {
  _id: string;
  _createdAt?: unknown;
  _updatedAt?: unknown;
  [key: string]: unknown;
};

type AppDataCollection = {
  name: string;
  count: number;
  docs: AppDataDoc[];
};

type AppDataExplorerProps = {
  workspaceId: string;
  appId: string;
  sourceVersion: "draft" | "published";
  change: (AppDataLiveChange & { sequence: number }) | null;
};

type DataViewMode = "table" | "documents";
type ExportFormat = "json" | "markdown";

const META_KEYS = new Set(["_id", "_createdAt", "_updatedAt"]);
const TITLE_FIELD_PRIORITY = ["name", "title", "label", "email", "company"];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function getTimestamp(value: unknown): number {
  if (!value) return 0;
  const timestamp = new Date(String(value)).getTime();
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function sortDocs(docs: AppDataDoc[]): AppDataDoc[] {
  return [...docs].sort((a, b) => {
    const timeDiff = getTimestamp(b._updatedAt) - getTimestamp(a._updatedAt);
    if (timeDiff !== 0) return timeDiff;
    return a._id.localeCompare(b._id);
  });
}

function sortCollections(collections: AppDataCollection[]): AppDataCollection[] {
  return [...collections]
    .map((collection) => ({
      ...collection,
      docs: sortDocs(collection.docs),
      count: collection.docs.length,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

function normalizeCollections(value: unknown): AppDataCollection[] {
  if (!isRecord(value) || !Array.isArray(value.collections)) return [];

  return sortCollections(
    value.collections.flatMap((collection) => {
      if (!isRecord(collection) || typeof collection.name !== "string") {
        return [];
      }

      const docs = Array.isArray(collection.docs)
        ? collection.docs.flatMap((doc) =>
            isRecord(doc) && typeof doc._id === "string"
              ? [{ ...doc, _id: doc._id } as AppDataDoc]
              : [],
          )
        : [];

      return [
        {
          name: collection.name,
          count:
            typeof collection.count === "number"
              ? collection.count
              : docs.length,
          docs,
        },
      ];
    }),
  );
}

function applyDataChange(
  collections: AppDataCollection[],
  change: AppDataLiveChange,
): AppDataCollection[] {
  if (change.type === "delete" && change.docId) {
    return sortCollections(
      collections
        .map((collection) => {
          if (
            change.collection !== "__any__" &&
            collection.name !== change.collection
          ) {
            return collection;
          }

          return {
            ...collection,
            docs: collection.docs.filter((doc) => doc._id !== change.docId),
          };
        })
        .filter((collection) => collection.docs.length > 0),
    );
  }

  if (!isRecord(change.doc) || typeof change.doc._id !== "string") {
    return collections;
  }

  const nextDoc = { ...change.doc, _id: change.doc._id } as AppDataDoc;
  let foundCollection = false;

  const nextCollections = collections.map((collection) => {
    if (collection.name !== change.collection) return collection;

    foundCollection = true;
    const existingIndex = collection.docs.findIndex(
      (doc) => doc._id === nextDoc._id,
    );
    const docs =
      existingIndex === -1
        ? [nextDoc, ...collection.docs]
        : collection.docs.map((doc, index) =>
            index === existingIndex ? nextDoc : doc,
          );

    return { ...collection, docs };
  });

  if (!foundCollection) {
    nextCollections.push({
      name: change.collection,
      count: 1,
      docs: [nextDoc],
    });
  }

  return sortCollections(nextCollections);
}

function dataEntries(doc: AppDataDoc): Array<[string, unknown]> {
  return Object.entries(doc).filter(([key]) => !META_KEYS.has(key));
}

function titleEntry(doc: AppDataDoc): [string, unknown] | null {
  const entries = dataEntries(doc);
  const prioritizedEntry = TITLE_FIELD_PRIORITY.flatMap((field) =>
    entries.filter(([key]) => key.toLowerCase() === field),
  ).find(([, value]) => {
    const valueType = typeof value;
    return valueType === "string" || valueType === "number";
  });

  if (prioritizedEntry) return prioritizedEntry;

  return (
    entries.find(([, value]) => {
      const valueType = typeof value;
      return valueType === "string" || valueType === "number";
    }) ?? null
  );
}

function formatValue(value: unknown): string {
  if (value === null) return "null";
  if (value === undefined) return "undefined";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  if (Array.isArray(value)) return `[${value.length}]`;
  if (isRecord(value)) return "{...}";
  return String(value);
}

function formatDate(value: unknown): string {
  if (!value) return "Never";
  const date = new Date(String(value));
  if (Number.isNaN(date.getTime())) return "Unknown";
  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function docTitle(doc: AppDataDoc): string {
  const entry = titleEntry(doc);
  if (entry) return formatValue(entry[1]);
  return doc._id;
}

function previewEntries(doc: AppDataDoc): Array<[string, unknown]> {
  const titleKey = titleEntry(doc)?.[0] ?? null;
  return dataEntries(doc)
    .filter(([key]) => key !== titleKey)
    .slice(0, 2);
}

function tableColumns(docs: AppDataDoc[]): string[] {
  const seen = new Set<string>();
  const columns: string[] = [];

  for (const doc of docs) {
    for (const [key] of dataEntries(doc)) {
      if (seen.has(key)) continue;
      seen.add(key);
      columns.push(key);
    }
  }

  return columns;
}

function formatTableValue(value: unknown): string {
  if (Array.isArray(value) || isRecord(value)) {
    return JSON.stringify(value);
  }
  return formatValue(value);
}

function stringifyDoc(doc: AppDataDoc | null): string {
  if (!doc) return "";
  return JSON.stringify(doc, null, 2);
}

function safeFilenamePart(value: string): string {
  return value.replace(/[^a-z0-9._-]+/gi, "-").replace(/^-+|-+$/g, "");
}

function collectionExportFilename(
  collectionName: string,
  format: ExportFormat,
): string {
  return `${safeFilenamePart(collectionName) || "collection"}.${
    format === "json" ? "json" : "md"
  }`;
}

function downloadText(content: string, filename: string, type: string) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

function downloadJson(value: unknown, filename: string) {
  downloadText(
    JSON.stringify(value, null, 2),
    filename,
    "application/json;charset=utf-8",
  );
}

function markdownCell(value: unknown): string {
  return formatTableValue(value)
    .replace(/\r?\n/g, "<br>")
    .replace(/\|/g, "\\|");
}

function collectionMarkdownTable(collection: AppDataCollection): string {
  const columns = tableColumns(collection.docs);
  const tableColumnsWithId =
    columns.length > 0 ? ["_id", ...columns] : ["_id"];
  const header = `| ${tableColumnsWithId.map(markdownCell).join(" | ")} |`;
  const separator = `| ${tableColumnsWithId.map(() => "---").join(" | ")} |`;
  const rows = collection.docs.map((doc) =>
    `| ${tableColumnsWithId
      .map((column) => markdownCell(doc[column]))
      .join(" | ")} |`,
  );

  return [
    `# ${collection.name}`,
    "",
    `${collection.docs.length} document${
      collection.docs.length === 1 ? "" : "s"
    }`,
    "",
    header,
    separator,
    ...rows,
    "",
  ].join("\n");
}

function matchesQuery(doc: AppDataDoc, query: string): boolean {
  if (!query) return true;
  return stringifyDoc(doc).toLowerCase().includes(query.toLowerCase());
}

function ExplorerSkeleton() {
  return (
    <div className="flex h-full overflow-hidden bg-background">
      <div className="flex w-72 shrink-0 flex-col gap-3 border-r bg-muted/30 p-3">
        <Skeleton className="h-7 w-36" />
        <Skeleton className="h-9 w-full" />
        <Skeleton className="h-9 w-full" />
        <Skeleton className="h-9 w-4/5" />
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-3 bg-background p-4">
        <Skeleton className="h-8 w-56" />
        <Skeleton className="h-28 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    </div>
  );
}

export function AppDataExplorer({
  workspaceId,
  appId,
  sourceVersion,
  change,
}: AppDataExplorerProps) {
  const [collections, setCollections] = useState<AppDataCollection[]>([]);
  const [selectedCollectionName, setSelectedCollectionName] = useState<
    string | null
  >(null);
  const [selectedDocId, setSelectedDocId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [viewMode, setViewMode] = useState<DataViewMode>("table");
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [exportDialogOpen, setExportDialogOpen] = useState(false);
  const [exportFormat, setExportFormat] = useState<ExportFormat>("json");
  const [exportFilename, setExportFilename] = useState("");

  const fetchCollections = useCallback(
    async (initial = false) => {
      if (initial) {
        setLoading(true);
      } else {
        setRefreshing(true);
      }
      setError(null);

      try {
        const res = await fetch(
          `/api/workspaces/${workspaceId}/apps/${appId}/data?version=${encodeURIComponent(sourceVersion)}`,
          { cache: "no-store" },
        );
        if (!res.ok) throw new Error("Failed to load app data");

        const json = (await res.json()) as unknown;
        setCollections(normalizeCollections(json));
      } catch {
        setError("Could not load app data");
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [workspaceId, appId, sourceVersion],
  );

  useEffect(() => {
    void fetchCollections(true);
  }, [fetchCollections]);

  useEffect(() => {
    if (!change) return;
    if (change.sourceVersion !== sourceVersion) return;
    setCollections((current) => applyDataChange(current, change));
  }, [change, sourceVersion]);

  useEffect(() => {
    setSelectedCollectionName((current) => {
      if (current && collections.some((collection) => collection.name === current)) {
        return current;
      }
      return collections[0]?.name ?? null;
    });
  }, [collections]);

  const selectedCollection = useMemo(
    () =>
      collections.find(
        (collection) => collection.name === selectedCollectionName,
      ) ?? null,
    [collections, selectedCollectionName],
  );

  const visibleDocs = useMemo(
    () =>
      selectedCollection
        ? selectedCollection.docs.filter((doc) => matchesQuery(doc, query))
        : [],
    [query, selectedCollection],
  );

  useEffect(() => {
    setSelectedDocId((current) => {
      if (current && visibleDocs.some((doc) => doc._id === current)) {
        return current;
      }
      return visibleDocs[0]?._id ?? null;
    });
  }, [visibleDocs]);

  const selectedDoc = useMemo(
    () => visibleDocs.find((doc) => doc._id === selectedDocId) ?? null,
    [selectedDocId, visibleDocs],
  );

  const visibleTableColumns = useMemo(
    () => tableColumns(visibleDocs),
    [visibleDocs],
  );

  const selectedDocJson = useMemo(() => stringifyDoc(selectedDoc), [selectedDoc]);
  const selectedDocLines = useMemo(
    () => (selectedDocJson ? selectedDocJson.split("\n") : []),
    [selectedDocJson],
  );

  const copySelectedDoc = useCallback(() => {
    if (!selectedDocJson) return;
    void navigator.clipboard.writeText(selectedDocJson);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1600);
  }, [selectedDocJson]);

  const openExportDialog = useCallback(() => {
    if (!selectedCollection) return;
    setExportFormat("json");
    setExportFilename(collectionExportFilename(selectedCollection.name, "json"));
    setExportDialogOpen(true);
  }, [selectedCollection]);

  const selectExportFormat = useCallback(
    (format: ExportFormat) => {
      setExportFormat(format);
      if (!selectedCollection) return;
      setExportFilename(collectionExportFilename(selectedCollection.name, format));
    },
    [selectedCollection],
  );

  const exportSelectedCollection = useCallback(() => {
    if (!selectedCollection) return;
    const filename = exportFilename.trim();
    if (!filename) return;
    const exportedAt = new Date().toISOString();

    if (exportFormat === "json") {
      downloadJson(
        {
          exportedAt,
          workspaceId,
          appId,
          sourceVersion,
          collection: selectedCollection.name,
          count: selectedCollection.docs.length,
          docs: selectedCollection.docs,
        },
        filename,
      );
    } else {
      downloadText(
        collectionMarkdownTable(selectedCollection),
        filename,
        "text/markdown;charset=utf-8",
      );
    }
    setExportDialogOpen(false);
  }, [
    appId,
    exportFilename,
    exportFormat,
    selectedCollection,
    sourceVersion,
    workspaceId,
  ]);

  if (loading && collections.length === 0) {
    return <ExplorerSkeleton />;
  }

  return (
    <div className="flex h-full overflow-hidden bg-background">
      <div className="flex w-56 shrink-0 flex-col overflow-hidden border-r bg-muted/30">
        <div className="flex h-11 shrink-0 items-center justify-between gap-2 border-b px-3">
          <div className="flex min-w-0 items-center gap-2">
            <DatabaseIcon className="size-3.5 shrink-0 text-muted-foreground" />
            <span className="min-w-0 truncate text-xs font-medium text-foreground">
              Data
            </span>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            className="shrink-0 text-muted-foreground"
            disabled={refreshing}
            onClick={() => void fetchCollections(false)}
            aria-label="Refresh app data"
          >
            <RefreshCwIcon className={cn(refreshing && "animate-spin")} />
          </Button>
        </div>

        {error && (
          <div className="border-b px-3 py-2 text-xs text-destructive">
            {error}
          </div>
        )}

        <div className="flex-1 overflow-auto py-1">
          {collections.length > 0 ? (
            collections.map((collection) => {
              const isSelected = collection.name === selectedCollectionName;

              return (
                <button
                  key={collection.name}
                  type="button"
                  onClick={() => {
                    setSelectedCollectionName(collection.name);
                    setQuery("");
                  }}
                  className={cn(
                    "flex h-9 w-full items-center gap-2 px-3 text-left text-[13px] transition-colors",
                    isSelected
                      ? "bg-muted text-foreground"
                      : "text-muted-foreground hover:bg-muted/50 hover:text-foreground",
                  )}
                >
                  <Table2Icon className="size-3.5 shrink-0" />
                  <span className="min-w-0 flex-1 truncate font-mono">
                    {collection.name}
                  </span>
                  <Badge variant={isSelected ? "default" : "secondary"}>
                    {collection.docs.length}
                  </Badge>
                </button>
              );
            })
          ) : (
            <div className="flex h-full items-center justify-center px-6 text-center text-sm text-muted-foreground">
              No app data yet
            </div>
          )}
        </div>
      </div>

      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        <div className="flex h-12 shrink-0 items-center justify-between gap-3 border-b bg-muted/20 px-4">
          <div className="min-w-0">
            <div className="min-w-0">
              <div className="flex min-w-0 items-center gap-2">
                <FileJsonIcon className="size-3.5 shrink-0 text-muted-foreground" />
                <span className="truncate text-sm font-medium">
                  {selectedCollection?.name ?? "App data"}
                </span>
              </div>
              <div className="mt-0.5 flex items-center gap-1.5 pl-5 text-[11px] text-muted-foreground">
                <Clock3Icon className="size-3" />
                <span className="truncate">
                  {selectedDoc
                    ? `Updated ${formatDate(selectedDoc._updatedAt)}`
                    : `${visibleDocs.length} matching docs`}
                </span>
              </div>
            </div>
          </div>

          <div className="flex min-w-0 items-center gap-2">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="shrink-0 text-muted-foreground"
              disabled={!selectedCollection}
              onClick={openExportDialog}
            >
              <DownloadIcon data-icon="inline-start" />
              Export
            </Button>
            <div
              className="flex shrink-0 items-center gap-0.5 rounded-md border bg-background p-0.5"
              role="tablist"
              aria-label="Data view"
            >
              <Button
                type="button"
                variant={viewMode === "table" ? "secondary" : "ghost"}
                size="sm"
                className="h-6 rounded-sm"
                role="tab"
                aria-selected={viewMode === "table"}
                onClick={() => setViewMode("table")}
              >
                <Table2Icon data-icon="inline-start" />
                Table view
              </Button>
              <Button
                type="button"
                variant={viewMode === "documents" ? "secondary" : "ghost"}
                size="sm"
                className="h-6 rounded-sm"
                role="tab"
                aria-selected={viewMode === "documents"}
                onClick={() => setViewMode("documents")}
              >
                <FileTextIcon data-icon="inline-start" />
                Docs view
              </Button>
            </div>
            <div className="relative hidden w-56 min-w-0 sm:block">
              <SearchIcon className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search documents"
                aria-label="Search documents"
                className="h-8 pl-8 text-xs"
              />
            </div>
            {viewMode === "documents" && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="shrink-0 text-muted-foreground"
                disabled={!selectedDoc}
                onClick={copySelectedDoc}
              >
                {copied ? (
                  <CheckIcon data-icon="inline-start" />
                ) : (
                  <CopyIcon data-icon="inline-start" />
                )}
                {copied ? "Copied" : "Copy JSON"}
              </Button>
            )}
          </div>
        </div>

        {viewMode === "table" ? (
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-background">
            <div className="flex h-9 shrink-0 items-center justify-between border-b px-3 text-xs text-muted-foreground">
              <div className="flex items-center gap-1.5">
                <span>{visibleDocs.length} rows</span>
                <span aria-hidden="true">&middot;</span>
                <span>{visibleTableColumns.length} columns</span>
              </div>
              {query && (
                <button
                  type="button"
                  className="rounded-md px-1.5 py-0.5 transition-colors hover:bg-muted hover:text-foreground"
                  onClick={() => setQuery("")}
                >
                  Clear
                </button>
              )}
            </div>

            <div className="relative min-h-0 flex-1 overflow-hidden">
              <div className="h-full overflow-auto">
                {visibleDocs.length > 0 && visibleTableColumns.length > 0 ? (
                  <table className="min-w-full border-separate border-spacing-0 text-left text-sm">
                    <thead className="sticky top-0 bg-background">
                      <tr>
                        {visibleTableColumns.map((column) => (
                          <th
                            key={column}
                            scope="col"
                            className="h-9 border-b bg-muted/30 px-3 text-xs font-medium text-muted-foreground"
                          >
                            <span className="block max-w-60 truncate font-mono">
                              {column}
                            </span>
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {visibleDocs.map((doc) => {
                        const isSelected = doc._id === selectedDocId;

                        return (
                          <tr
                            key={doc._id}
                            className="cursor-default transition-colors hover:bg-muted/50"
                            onClick={() => setSelectedDocId(doc._id)}
                          >
                            {visibleTableColumns.map((column) => {
                              const value = doc[column];

                              return (
                                <td
                                  key={column}
                                  className={cn(
                                    "max-w-72 border-b px-3 py-2 align-top text-xs",
                                    isSelected && "bg-muted/70",
                                  )}
                                >
                                  <span
                                    className={cn(
                                      "block truncate",
                                      value === null || value === undefined
                                        ? "text-muted-foreground"
                                        : typeof value === "number" ||
                                            typeof value === "boolean"
                                          ? "font-mono"
                                          : "",
                                    )}
                                    title={formatTableValue(value)}
                                  >
                                    {formatTableValue(value)}
                                  </span>
                                </td>
                              );
                            })}
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                ) : (
                  <div className="flex h-full items-center justify-center px-6 text-center text-sm text-muted-foreground">
                    {visibleDocs.length > 0
                      ? "No document fields"
                      : "No documents"}
                  </div>
                )}
              </div>
              {visibleDocs.length > 0 && visibleTableColumns.length > 0 && (
                <div className="pointer-events-none absolute inset-y-0 right-0 w-12 bg-gradient-to-l from-background via-background/80 to-transparent" />
              )}
            </div>
          </div>
        ) : (
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden lg:flex-row">
            <div className="flex h-56 shrink-0 flex-col overflow-hidden border-b bg-background lg:h-full lg:w-80 lg:border-b-0 lg:border-r">
              <div className="flex h-9 shrink-0 items-center justify-between border-b px-3 text-xs text-muted-foreground">
                <span>
                  {visibleDocs.length} of {selectedCollection?.docs.length ?? 0}
                </span>
                {query && (
                  <button
                    type="button"
                    className="rounded-md px-1.5 py-0.5 transition-colors hover:bg-muted hover:text-foreground"
                    onClick={() => setQuery("")}
                  >
                    Clear
                  </button>
                )}
              </div>

              <div className="flex-1 overflow-auto py-1">
                {visibleDocs.length > 0 ? (
                  visibleDocs.map((doc) => {
                    const isSelected = doc._id === selectedDocId;
                    const entries = previewEntries(doc);

                    return (
                      <button
                        key={doc._id}
                        type="button"
                        onClick={() => setSelectedDocId(doc._id)}
                        className={cn(
                          "flex w-full flex-col gap-1.5 px-3 py-2 text-left transition-colors",
                          isSelected
                            ? "bg-muted text-foreground"
                            : "text-muted-foreground hover:bg-muted/50 hover:text-foreground",
                        )}
                      >
                        <div className="flex min-w-0 items-center gap-2">
                          <FileTextIcon className="size-3.5 shrink-0" />
                          <span className="min-w-0 flex-1 truncate text-[13px] font-medium">
                            {docTitle(doc)}
                          </span>
                        </div>
                        {entries.length > 0 && (
                          <div className="flex min-w-0 flex-wrap gap-1">
                            {entries.map(([key, value]) => (
                              <span
                                key={key}
                                className="max-w-full truncate rounded-md bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground"
                                title={`${key}: ${formatValue(value)}`}
                              >
                                {key}: {formatValue(value)}
                              </span>
                            ))}
                          </div>
                        )}
                      </button>
                    );
                  })
                ) : (
                  <div className="flex h-full items-center justify-center px-6 text-center text-sm text-muted-foreground">
                    No documents
                  </div>
                )}
              </div>
            </div>

            <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-background">
              {selectedDoc ? (
                <>
                  <div className="flex h-9 shrink-0 items-center justify-between border-b bg-muted/20 px-3">
                    <div className="min-w-0 truncate font-mono text-xs text-muted-foreground">
                      {selectedDoc._id}
                    </div>
                    <Badge variant="outline">
                      {dataEntries(selectedDoc).length} fields
                    </Badge>
                  </div>
                  <div className="flex-1 overflow-auto">
                    <div className="py-3 text-[13px] leading-relaxed">
                      {selectedDocLines.map((line, index) => (
                        <div
                          key={`${index}-${line}`}
                          className="flex min-w-0 items-start hover:bg-muted/30"
                        >
                          <div className="w-12 shrink-0 select-none pr-4 pl-4 text-right font-mono text-[12px] text-muted-foreground/40">
                            {index + 1}
                          </div>
                          <code className="min-w-0 flex-1 whitespace-pre-wrap break-words pr-4 font-mono [overflow-wrap:anywhere]">
                            {line || " "}
                          </code>
                        </div>
                      ))}
                    </div>
                  </div>
                </>
              ) : (
                <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
                  Select a document
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      <Dialog open={exportDialogOpen} onOpenChange={setExportDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Choose export format</DialogTitle>
          </DialogHeader>
          <div className="mt-3 space-y-4">
            <div
              className="grid grid-cols-2 gap-2"
              role="radiogroup"
              aria-label="Export format"
            >
              <button
                type="button"
                role="radio"
                aria-checked={exportFormat === "json"}
                onClick={() => selectExportFormat("json")}
                className={cn(
                  "flex min-h-20 flex-col items-start gap-2 rounded-lg border p-3 text-left transition-colors",
                  exportFormat === "json"
                    ? "border-foreground bg-muted/60 text-foreground"
                    : "border-border bg-background text-muted-foreground hover:bg-muted/40 hover:text-foreground",
                )}
              >
                <FileJsonIcon className="size-4" />
                <span className="text-sm font-medium">JSON</span>
                <span className="text-xs leading-snug">
                  Full structured collection export.
                </span>
              </button>
              <button
                type="button"
                role="radio"
                aria-checked={exportFormat === "markdown"}
                onClick={() => selectExportFormat("markdown")}
                className={cn(
                  "flex min-h-20 flex-col items-start gap-2 rounded-lg border p-3 text-left transition-colors",
                  exportFormat === "markdown"
                    ? "border-foreground bg-muted/60 text-foreground"
                    : "border-border bg-background text-muted-foreground hover:bg-muted/40 hover:text-foreground",
                )}
              >
                <Table2Icon className="size-4" />
                <span className="text-sm font-medium">Markdown table</span>
                <span className="text-xs leading-snug">
                  Readable table for docs and notes.
                </span>
              </button>
            </div>

            <div className="space-y-2">
            <Input
              value={exportFilename}
              onChange={(event) => setExportFilename(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  exportSelectedCollection();
                }
              }}
              autoFocus
              placeholder={
                exportFormat === "json" ? "collection.json" : "collection.md"
              }
              aria-label="Export filename"
            />
            <div className="text-xs text-muted-foreground">
              This exports the selected collection as{" "}
              {exportFormat === "json" ? "JSON" : "a Markdown table"}.
            </div>
            </div>
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setExportDialogOpen(false)}
            >
              Cancel
            </Button>
            <Button
              type="button"
              disabled={!exportFilename.trim()}
              onClick={exportSelectedCollection}
            >
              <DownloadIcon data-icon="inline-start" />
              Download
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
