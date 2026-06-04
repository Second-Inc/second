"use client";

import { useCallback, useMemo, useState } from "react";
import type { ComponentType, KeyboardEvent, PointerEvent } from "react";
import { highlight } from "sugar-high";
import {
  ArchiveIcon,
  BracesIcon,
  CheckIcon,
  ChevronRightIcon,
  CopyIcon,
  DownloadIcon,
  FileCodeIcon,
  FileJsonIcon,
  FilePlusIcon,
  FileTextIcon,
  FolderIcon,
  FolderOpenIcon,
  GlobeIcon,
  HashIcon,
  XIcon,
} from "lucide-react";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type AppFileExplorerProps = {
  workspaceId: string;
  appId: string;
  files: Record<string, string> | null;
};

type FileNode = {
  type: "file";
  name: string;
  path: string;
};

type DirectoryNode = {
  type: "directory";
  name: string;
  path: string;
  children: TreeNode[];
};

type TreeNode = FileNode | DirectoryNode;

type MutableDirectoryNode = DirectoryNode & {
  directoryByName: Map<string, MutableDirectoryNode>;
};

const DEFAULT_SIDEBAR_WIDTH = 280;
const MIN_SIDEBAR_WIDTH = 220;
const MAX_SIDEBAR_WIDTH = 440;

const FILE_ICONS: Record<string, ComponentType<{ className?: string }>> = {
  ts: BracesIcon,
  tsx: BracesIcon,
  js: BracesIcon,
  jsx: BracesIcon,
  json: FileJsonIcon,
  html: GlobeIcon,
  css: HashIcon,
  md: FileTextIcon,
  txt: FileTextIcon,
};

function getFileIcon(filename: string): ComponentType<{ className?: string }> {
  const ext = filename.split(".").pop()?.toLowerCase() ?? "";
  return FILE_ICONS[ext] ?? FileCodeIcon;
}

function CopyButton({
  copied,
  filename,
  onCopy,
}: {
  copied: boolean;
  filename: string;
  onCopy: () => void;
}) {
  const displayFilename = basename(filename);

  return (
    <button
      type="button"
      title={copied ? `Copied ${displayFilename}` : `Copy ${filename}`}
      className={cn(
        "flex min-w-0 max-w-52 items-center gap-1 rounded-md px-2 py-1 text-xs transition-colors",
        copied
          ? "text-primary"
          : "text-muted-foreground hover:bg-muted/50 hover:text-foreground",
      )}
      onClick={onCopy}
    >
      {copied ? (
        <>
          <CheckIcon className="size-3" />
          <span className="truncate">Copied {displayFilename}</span>
        </>
      ) : (
        <>
          <CopyIcon className="size-3" />
          <span>Copy</span>
        </>
      )}
    </button>
  );
}

function clampSidebarWidth(width: number): number {
  return Math.min(MAX_SIDEBAR_WIDTH, Math.max(MIN_SIDEBAR_WIDTH, width));
}

function basename(path: string): string {
  return path.split("/").pop() ?? path;
}

function countLines(text: string | undefined): number {
  if (text === undefined) return 0;
  return text.split("\n").length;
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

function downloadFile(path: string, content: string) {
  downloadBlob(
    new Blob([content], { type: "text/plain;charset=utf-8" }),
    basename(path),
  );
}

function createDirectory(name: string, path: string): MutableDirectoryNode {
  return {
    type: "directory",
    name,
    path,
    children: [],
    directoryByName: new Map(),
  };
}

function sortTreeNodes(nodes: TreeNode[]): TreeNode[] {
  return nodes
    .map((node) => {
      if (node.type === "file") return node;

      return {
        type: "directory" as const,
        name: node.name,
        path: node.path,
        children: sortTreeNodes(node.children),
      };
    })
    .sort((a, b) => {
      if (a.type !== b.type) return a.type === "directory" ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
}

function buildFileTree(paths: string[]): TreeNode[] {
  const root = createDirectory("", "");

  for (const path of paths) {
    const segments = path.split("/").filter(Boolean);
    if (segments.length === 0) continue;

    let directory = root;
    for (const segment of segments.slice(0, -1)) {
      const directoryPath = directory.path ? `${directory.path}/${segment}` : segment;
      let child = directory.directoryByName.get(segment);

      if (!child) {
        child = createDirectory(segment, directoryPath);
        directory.directoryByName.set(segment, child);
        directory.children.push(child);
      }

      directory = child;
    }

    directory.children.push({
      type: "file",
      name: segments[segments.length - 1],
      path,
    });
  }

  return sortTreeNodes(root.children);
}

function collectDirectoryPaths(nodes: TreeNode[]): string[] {
  const paths: string[] = [];

  for (const node of nodes) {
    if (node.type === "file") continue;
    paths.push(node.path);
    paths.push(...collectDirectoryPaths(node.children));
  }

  return paths;
}

function CodePreview({ content }: { content: string }) {
  return (
    <div className="flex-1 overflow-auto">
      <div className="py-3 text-[13px] leading-relaxed">
        {content.split("\n").map((line, i) => (
          <div
            key={i}
            className="flex min-w-0 items-start hover:bg-muted/30"
          >
            <div className="w-12 shrink-0 select-none pr-4 pl-4 text-right font-mono text-[12px] text-muted-foreground/40">
              {i + 1}
            </div>
            <code
              className="min-w-0 flex-1 whitespace-pre-wrap break-words pr-4 font-mono [overflow-wrap:anywhere]"
              dangerouslySetInnerHTML={{
                __html: highlight(line) || "&nbsp;",
              }}
            />
          </div>
        ))}
      </div>
    </div>
  );
}

function FileTree({
  nodes,
  depth,
  activeFile,
  expandedPaths,
  onCopyFileContent,
  onDownloadFile,
  onOpenFileInNewTab,
  onReplaceFile,
  onSetDirectoryExpanded,
  onToggleDirectory,
}: {
  nodes: TreeNode[];
  depth: number;
  activeFile: string | null;
  expandedPaths: Set<string>;
  onCopyFileContent: (path: string) => void;
  onDownloadFile: (path: string) => void;
  onOpenFileInNewTab: (path: string) => void;
  onReplaceFile: (path: string) => void;
  onSetDirectoryExpanded: (path: string, expanded: boolean) => void;
  onToggleDirectory: (path: string) => void;
}) {
  return (
    <>
      {nodes.map((node) => {
        const paddingLeft = 12 + depth * 14;

        if (node.type === "directory") {
          const isExpanded = expandedPaths.has(node.path);

          return (
            <div key={node.path}>
              <ContextMenu>
                <ContextMenuTrigger asChild>
                  <button
                    type="button"
                    aria-expanded={isExpanded}
                    onClick={() => onToggleDirectory(node.path)}
                    className="flex h-7 w-full items-center gap-1.5 pr-3 text-left text-[13px] text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground"
                    style={{ paddingLeft }}
                  >
                    <ChevronRightIcon
                      className={cn(
                        "size-3 shrink-0 transition-transform",
                        isExpanded && "rotate-90",
                      )}
                    />
                    {isExpanded ? (
                      <FolderOpenIcon className="size-3.5 shrink-0" />
                    ) : (
                      <FolderIcon className="size-3.5 shrink-0" />
                    )}
                    <span className="truncate">{node.name}</span>
                  </button>
                </ContextMenuTrigger>
                <ContextMenuContent>
                  <ContextMenuItem
                    onSelect={() =>
                      onSetDirectoryExpanded(node.path, !isExpanded)
                    }
                  >
                    {isExpanded ? <FolderIcon /> : <FolderOpenIcon />}
                    {isExpanded ? "Collapse folder" : "Expand folder"}
                  </ContextMenuItem>
                </ContextMenuContent>
              </ContextMenu>
              {isExpanded && (
                <FileTree
                  nodes={node.children}
                  depth={depth + 1}
                  activeFile={activeFile}
                  expandedPaths={expandedPaths}
                  onCopyFileContent={onCopyFileContent}
                  onDownloadFile={onDownloadFile}
                  onOpenFileInNewTab={onOpenFileInNewTab}
                  onReplaceFile={onReplaceFile}
                  onSetDirectoryExpanded={onSetDirectoryExpanded}
                  onToggleDirectory={onToggleDirectory}
                />
              )}
            </div>
          );
        }

        const Icon = getFileIcon(node.name);
        const isSelected = node.path === activeFile;

        return (
          <ContextMenu key={node.path}>
            <ContextMenuTrigger asChild>
              <button
                type="button"
                onClick={() => onReplaceFile(node.path)}
                className={cn(
                  "flex h-7 w-full items-center gap-1.5 pr-3 text-left font-mono text-[13px] transition-colors",
                  isSelected
                    ? "bg-muted text-foreground"
                    : "text-muted-foreground hover:bg-muted/50 hover:text-foreground",
                )}
                style={{ paddingLeft }}
                title={node.path}
              >
                <span className="w-3 shrink-0" />
                <Icon className="size-3.5 shrink-0" />
                <span className="truncate">{node.name}</span>
              </button>
            </ContextMenuTrigger>
            <ContextMenuContent>
              <ContextMenuItem onSelect={() => onOpenFileInNewTab(node.path)}>
                <FilePlusIcon />
                Open in new tab
              </ContextMenuItem>
              <ContextMenuSeparator />
              <ContextMenuItem onSelect={() => onCopyFileContent(node.path)}>
                <CopyIcon />
                Copy file content
              </ContextMenuItem>
              <ContextMenuItem onSelect={() => onDownloadFile(node.path)}>
                <DownloadIcon />
                Download file
              </ContextMenuItem>
            </ContextMenuContent>
          </ContextMenu>
        );
      })}
    </>
  );
}

export function AppFileExplorer({
  workspaceId,
  appId,
  files,
}: AppFileExplorerProps) {
  const sortedFiles = useMemo(() => {
    if (!files) return [];
    return Object.keys(files).sort((a, b) => a.localeCompare(b));
  }, [files]);

  const tree = useMemo(() => buildFileTree(sortedFiles), [sortedFiles]);
  const directoryPaths = useMemo(() => collectDirectoryPaths(tree), [tree]);
  const availableFiles = useMemo(() => new Set(sortedFiles), [sortedFiles]);
  const defaultFile = useMemo(
    () =>
      sortedFiles.find((path) => path === "src/App.tsx") ??
      sortedFiles.find((path) => basename(path).toLowerCase() === "app.tsx") ??
      sortedFiles[0] ??
      null,
    [sortedFiles],
  );

  const [collapsedPaths, setCollapsedPaths] = useState<Set<string>>(
    () => new Set(),
  );
  const [openTabs, setOpenTabs] = useState<string[]>([]);
  const [activeFile, setActiveFile] = useState<string | null>(null);
  const [defaultTabDismissed, setDefaultTabDismissed] = useState(false);
  const [copiedFilePath, setCopiedFilePath] = useState<string | null>(null);
  const [sidebarWidth, setSidebarWidth] = useState(DEFAULT_SIDEBAR_WIDTH);

  const expandedPaths = useMemo(() => {
    const next = new Set<string>();
    for (const path of directoryPaths) {
      if (!collapsedPaths.has(path)) next.add(path);
    }
    return next;
  }, [collapsedPaths, directoryPaths]);

  const visibleTabs = useMemo(() => {
    const tabs =
      openTabs.length > 0
        ? openTabs
        : !defaultTabDismissed && defaultFile
          ? [defaultFile]
          : [];

    return tabs.filter((path) => availableFiles.has(path));
  }, [availableFiles, defaultFile, defaultTabDismissed, openTabs]);

  const resolvedActiveFile =
    activeFile !== null && visibleTabs.includes(activeFile)
      ? activeFile
      : visibleTabs[0] ?? null;

  const activeContent =
    resolvedActiveFile !== null && files && files[resolvedActiveFile] !== undefined
      ? files[resolvedActiveFile]
      : null;

  const toggleDirectory = useCallback((path: string) => {
    setCollapsedPaths((current) => {
      const next = new Set(current);
      if (next.has(path)) {
        next.delete(path);
      } else {
        next.add(path);
      }
      return next;
    });
  }, []);

  const setDirectoryExpanded = useCallback((path: string, expanded: boolean) => {
    setCollapsedPaths((current) => {
      const next = new Set(current);
      if (expanded) {
        next.delete(path);
      } else {
        next.add(path);
      }
      return next;
    });
  }, []);

  const copyFileContent = useCallback(
    (path: string) => {
      const content = files?.[path];
      if (content === undefined) return;

      void navigator.clipboard.writeText(content);
      setCopiedFilePath(path);
      window.setTimeout(() => {
        setCopiedFilePath((current) => (current === path ? null : current));
      }, 2000);
    },
    [files],
  );

  const downloadSingleFile = useCallback(
    (path: string) => {
      const content = files?.[path];
      if (content === undefined) return;
      downloadFile(path, content);
    },
    [files],
  );

  const exportHref = `/api/workspaces/${workspaceId}/apps/${appId}/export`;

  const openFileInNewTab = useCallback((path: string) => {
    setDefaultTabDismissed(false);
    setOpenTabs((current) => {
      const currentVisible =
        current.length > 0
          ? current.filter((tab) => availableFiles.has(tab))
          : !defaultTabDismissed && defaultFile
            ? [defaultFile]
            : [];

      return currentVisible.includes(path)
        ? currentVisible
        : [...currentVisible, path];
    });
    setActiveFile(path);
  }, [availableFiles, defaultFile, defaultTabDismissed]);

  const replaceFile = useCallback((path: string) => {
    setDefaultTabDismissed(false);
    setOpenTabs((current) => {
      const currentVisible =
        current.length > 0
          ? current.filter((tab) => availableFiles.has(tab))
          : !defaultTabDismissed && defaultFile
            ? [defaultFile]
            : [];

      if (currentVisible.includes(path)) return currentVisible;
      if (currentVisible.length === 0) return [path];

      const activeIndex = currentVisible.indexOf(
        resolvedActiveFile ?? currentVisible[0],
      );
      const next = [...currentVisible];
      next[Math.max(activeIndex, 0)] = path;
      return next.filter((tab, index) => next.indexOf(tab) === index);
    });
    setActiveFile(path);
  }, [availableFiles, defaultFile, defaultTabDismissed, resolvedActiveFile]);

  const closeTab = useCallback(
    (path: string) => {
      const visibleIndex = visibleTabs.indexOf(path);
      const nextVisible = visibleTabs.filter((tab) => tab !== path);

      setDefaultTabDismissed(nextVisible.length === 0);
      setOpenTabs((current) => current.filter((tab) => tab !== path));

      if (resolvedActiveFile === path) {
        setActiveFile(
          nextVisible[Math.min(visibleIndex, nextVisible.length - 1)] ?? null,
        );
      }
    },
    [resolvedActiveFile, visibleTabs],
  );

  const selectTabFromKeyboard = useCallback(
    (event: KeyboardEvent<HTMLDivElement>, path: string) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      setActiveFile(path);
    },
    [],
  );

  const startResize = useCallback(
    (event: PointerEvent<HTMLDivElement>) => {
      event.preventDefault();

      const startX = event.clientX;
      const startWidth = sidebarWidth;

      const onPointerMove = (moveEvent: globalThis.PointerEvent) => {
        setSidebarWidth(
          clampSidebarWidth(startWidth + moveEvent.clientX - startX),
        );
      };

      const onPointerUp = () => {
        window.removeEventListener("pointermove", onPointerMove);
        window.removeEventListener("pointerup", onPointerUp);
      };

      window.addEventListener("pointermove", onPointerMove);
      window.addEventListener("pointerup", onPointerUp);
    },
    [sidebarWidth],
  );

  if (!files || sortedFiles.length === 0) {
    return (
      <div className="flex h-full items-center justify-center bg-background">
        <span className="text-sm text-muted-foreground">No files yet</span>
      </div>
    );
  }

  return (
    <div className="flex h-full overflow-hidden">
      <div
        className="flex shrink-0 flex-col overflow-hidden border-r bg-muted/30"
        style={{ width: sidebarWidth }}
      >
        <div className="flex h-9 shrink-0 items-center justify-between gap-2 border-b px-3">
          <span className="min-w-0 truncate text-xs font-medium text-muted-foreground">
            Sandbox Files
          </span>
          <Button
            asChild
            variant="ghost"
            size="xs"
            className="shrink-0 text-muted-foreground"
          >
            <a href={exportHref}>
              <ArchiveIcon data-icon="inline-start" />
              Export App
            </a>
          </Button>
        </div>
        <div className="flex-1 overflow-auto py-1">
          <FileTree
            nodes={tree}
            depth={0}
            activeFile={resolvedActiveFile}
            expandedPaths={expandedPaths}
            onCopyFileContent={copyFileContent}
            onDownloadFile={downloadSingleFile}
            onOpenFileInNewTab={openFileInNewTab}
            onReplaceFile={replaceFile}
            onSetDirectoryExpanded={setDirectoryExpanded}
            onToggleDirectory={toggleDirectory}
          />
        </div>
      </div>

      <div
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize file explorer"
        className="w-1 shrink-0 cursor-col-resize bg-transparent transition-colors hover:bg-border active:bg-border"
        onPointerDown={startResize}
      />

      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-background">
        <div className="flex h-9 shrink-0 items-center justify-between border-b bg-muted/20">
          {visibleTabs.length > 0 ? (
            <div className="flex min-w-0 flex-1 overflow-x-auto" role="tablist">
              {visibleTabs.map((path) => {
                const Icon = getFileIcon(path);
                const isActive = path === resolvedActiveFile;

                return (
                  <div
                    key={path}
                    role="tab"
                    aria-selected={isActive}
                    tabIndex={0}
                    title={path}
                    onClick={() => setActiveFile(path)}
                    onKeyDown={(event) => selectTabFromKeyboard(event, path)}
                    className={cn(
                      "group flex h-9 max-w-64 min-w-0 cursor-default items-center gap-1.5 border-r px-3 text-xs transition-colors",
                      isActive
                        ? "bg-background text-foreground"
                        : "text-muted-foreground hover:bg-muted/50 hover:text-foreground",
                    )}
                  >
                    <Icon className="size-3.5 shrink-0" />
                    <span className="truncate font-mono">{basename(path)}</span>
                    {isActive && (
                      <span className="shrink-0 text-muted-foreground/60">
                        {countLines(files[path])} lines
                      </span>
                    )}
                    <button
                      type="button"
                      aria-label={`Close ${path}`}
                      onClick={(event) => {
                        event.stopPropagation();
                        closeTab(path);
                      }}
                      className="ml-1 rounded-sm p-0.5 text-muted-foreground opacity-70 transition-colors hover:bg-muted hover:text-foreground group-hover:opacity-100"
                    >
                      <XIcon className="size-3" />
                    </button>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="flex min-w-0 flex-1 items-center px-4 text-xs text-muted-foreground">
              Select a file to preview
            </div>
          )}

          {activeContent !== null && (
            <div className="shrink-0 px-2">
              <CopyButton
                key={resolvedActiveFile}
                copied={copiedFilePath === resolvedActiveFile}
                filename={resolvedActiveFile ?? ""}
                onCopy={() => {
                  if (resolvedActiveFile) copyFileContent(resolvedActiveFile);
                }}
              />
            </div>
          )}
        </div>

        {activeContent !== null ? (
          <CodePreview content={activeContent} />
        ) : (
          <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
            Select a file to preview
          </div>
        )}
      </div>
    </div>
  );
}
