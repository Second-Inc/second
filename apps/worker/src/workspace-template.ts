export const WORKSPACE_TEMPLATE: Record<string, string> = {
  "package.json": `{
  "name": "second-app",
  "private": true,
  "version": "0.0.0",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "typecheck": "tsc -b",
    "build": "vite build",
    "preview": "vite preview --host 0.0.0.0 --port 4173"
  },
  "dependencies": {
    "@radix-ui/react-dialog": "^1.1.15",
    "@radix-ui/react-select": "^2.2.6",
    "@radix-ui/react-slot": "^1.2.4",
    "@radix-ui/react-tooltip": "^1.2.8",
    "class-variance-authority": "^0.7.1",
    "clsx": "^2.1.1",
    "lucide-react": "^0.511.0",
    "react": "^18.3.1",
    "react-dom": "^18.3.1",
    "tailwind-merge": "^3.3.0",
    "tailwindcss-animate": "^1.0.7"
  },
  "devDependencies": {
    "@types/node": "^20.19.0",
    "@types/react": "^18.3.20",
    "@types/react-dom": "^18.3.7",
    "@vitejs/plugin-react": "^4.3.4",
    "autoprefixer": "^10.4.21",
    "postcss": "^8.5.3",
    "tailwindcss": "^3.4.17",
    "typescript": "~5.8.3",
    "vite": "^5.4.17"
  }
}
`,
  "components.json": `{
  "$schema": "https://ui.shadcn.com/schema.json",
  "style": "new-york",
  "rsc": false,
  "tsx": true,
  "tailwind": {
    "config": "tailwind.config.ts",
    "css": "src/index.css",
    "baseColor": "neutral",
    "cssVariables": true,
    "prefix": ""
  },
  "aliases": {
    "components": "@/components",
    "utils": "@/lib/utils"
  }
}
`,
  "index.html": `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <meta name="color-scheme" content="light dark" />
    <link rel="preconnect" href="https://fonts.googleapis.com" />
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&display=swap" rel="stylesheet" />
    <title>Second App</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
`,
  "vite.config.ts": `import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath, URL } from "node:url";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
});
`,
  "postcss.config.js": `export default {
  plugins: {
    tailwindcss: {},
    autoprefixer: {},
  },
};
`,
  "tailwind.config.ts": `import type { Config } from "tailwindcss";
import animate from "tailwindcss-animate";

const config: Config = {
  darkMode: "media",
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        sans: [
          "Inter",
          "system-ui",
          "-apple-system",
          "Segoe UI",
          "Roboto",
          "sans-serif",
        ],
      },
      borderRadius: {
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)",
      },
      colors: {
        background: "hsl(var(--background) / <alpha-value>)",
        foreground: "hsl(var(--foreground) / <alpha-value>)",
        card: {
          DEFAULT: "hsl(var(--card) / <alpha-value>)",
          foreground: "hsl(var(--card-foreground) / <alpha-value>)",
        },
        popover: {
          DEFAULT: "hsl(var(--popover) / <alpha-value>)",
          foreground: "hsl(var(--popover-foreground) / <alpha-value>)",
        },
        primary: {
          DEFAULT: "hsl(var(--primary) / <alpha-value>)",
          foreground: "hsl(var(--primary-foreground) / <alpha-value>)",
        },
        secondary: {
          DEFAULT: "hsl(var(--secondary) / <alpha-value>)",
          foreground: "hsl(var(--secondary-foreground) / <alpha-value>)",
        },
        muted: {
          DEFAULT: "hsl(var(--muted) / <alpha-value>)",
          foreground: "hsl(var(--muted-foreground) / <alpha-value>)",
        },
        accent: {
          DEFAULT: "hsl(var(--accent) / <alpha-value>)",
          foreground: "hsl(var(--accent-foreground) / <alpha-value>)",
        },
        destructive: {
          DEFAULT: "hsl(var(--destructive) / <alpha-value>)",
          foreground: "hsl(var(--destructive-foreground) / <alpha-value>)",
        },
        border: "hsl(var(--border) / <alpha-value>)",
        input: "hsl(var(--input) / <alpha-value>)",
        ring: "hsl(var(--ring) / <alpha-value>)",
        sidebar: {
          DEFAULT: "hsl(var(--sidebar) / <alpha-value>)",
          foreground: "hsl(var(--sidebar-foreground) / <alpha-value>)",
          accent: "hsl(var(--sidebar-accent) / <alpha-value>)",
          "accent-foreground":
            "hsl(var(--sidebar-accent-foreground) / <alpha-value>)",
          border: "hsl(var(--sidebar-border) / <alpha-value>)",
          muted: "hsl(var(--sidebar-muted) / <alpha-value>)",
        },
      },
      keyframes: {
        "fade-in-up": {
          from: {
            opacity: "0",
            filter: "blur(4px)",
            transform: "translateY(10px)",
          },
          to: {
            opacity: "1",
            filter: "blur(0)",
            transform: "translateY(0)",
          },
        },
      },
      animation: {
        "fade-in-up": "fade-in-up 0.4s ease-out forwards",
      },
    },
  },
  plugins: [animate],
};

export default config;
`,
  "tsconfig.json": `{
  "files": [],
  "references": [
    { "path": "./tsconfig.app.json" },
    { "path": "./tsconfig.node.json" }
  ]
}
`,
  "tsconfig.app.json": `{
  "compilerOptions": {
    "tsBuildInfoFile": "./node_modules/.tmp/tsconfig.app.tsbuildinfo",
    "target": "ES2020",
    "useDefineForClassFields": true,
    "lib": ["ES2020", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "skipLibCheck": true,
    "moduleResolution": "Bundler",
    "allowImportingTsExtensions": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "moduleDetection": "force",
    "noEmit": true,
    "jsx": "react-jsx",
    "strict": true,
    "baseUrl": ".",
    "paths": {
      "@/*": ["./src/*"]
    }
  },
  "include": ["src"]
}
`,
  "tsconfig.node.json": `{
  "compilerOptions": {
    "tsBuildInfoFile": "./node_modules/.tmp/tsconfig.node.tsbuildinfo",
    "target": "ES2022",
    "lib": ["ES2023"],
    "module": "ESNext",
    "skipLibCheck": true,
    "moduleResolution": "Bundler",
    "allowImportingTsExtensions": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "moduleDetection": "force",
    "noEmit": true,
    "types": ["node"],
    "strict": true
  },
  "include": ["vite.config.ts", "tailwind.config.ts"]
}
`,
  "src/vite-env.d.ts": `/// <reference types="vite/client" />
`,
  "src/main.tsx": `import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./index.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
`,
  "src/App.tsx": `/**
 * THIS IS A SAMPLE APP, PLEASE CHANGE FOR WHATEVER USE CASE NEEDED!
 * IT'S JUST A SIMPLE REFERENCE!
 */

import { useState, useEffect, useCallback, useRef } from "react";
import {
  ArrowDown,
  ArrowUp,
  Building2,
  Check,
  Loader2,
  Mail,
  Plus,
  Search,
  Sparkles,
  Trash2,
  User,
  Users,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import {
  LEADS as INITIAL_LEADS,
  STATUS_CONFIG,
  ALL_STATUSES,
  type Lead,
  type LeadStatus,
  type Enrichment,
} from "@/lib/data";

// ── Helpers ──────────────────────────────────────────────

function relativeDate(dateStr: string): string {
  const now = new Date();
  const date = new Date(dateStr);
  const days = Math.floor(
    (now.getTime() - date.getTime()) / (1000 * 60 * 60 * 24),
  );
  if (days === 0) return "Today";
  if (days === 1) return "Yesterday";
  if (days < 7) return \`\${days}d ago\`;
  if (days < 30) return \`\${Math.floor(days / 7)}w ago\`;
  return \`\${Math.floor(days / 30)}mo ago\`;
}

type SortKey = "name" | "company" | "status" | "createdAt";
type SortDir = "asc" | "desc";

function sortLeads(leads: Lead[], key: SortKey, dir: SortDir): Lead[] {
  const m = dir === "asc" ? 1 : -1;
  return [...leads].sort((a, b) => {
    const av = a[key];
    const bv = b[key];
    return av < bv ? -m : av > bv ? m : 0;
  });
}

// ── Custom checkbox ──────────────────────────────────────

function Checkbox({
  checked,
  onChange,
  className = "",
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  className?: string;
}) {
  return (
    <button
      role="checkbox"
      aria-checked={checked}
      onClick={(e) => {
        e.stopPropagation();
        onChange(!checked);
      }}
      className={\`flex size-3.5 shrink-0 items-center justify-center rounded-sm border transition-colors \${
        checked
          ? "border-primary bg-primary text-primary-foreground"
          : "border-muted-foreground/30 hover:border-muted-foreground/60"
      } \${className}\`}
    >
      {checked && <Check className="size-2.5" strokeWidth={3} />}
    </button>
  );
}

// ── Tab bar ──────────────────────────────────────────────

function FilterTabs({
  value,
  onChange,
  counts,
}: {
  value: string;
  onChange: (v: string) => void;
  counts: Record<string, number>;
}) {
  const tabs = [
    { key: "all", label: "All" },
    ...ALL_STATUSES.map((s) => ({ key: s, label: STATUS_CONFIG[s].label })),
  ];

  return (
    <div className="flex items-center gap-0.5">
      {tabs.map((tab) => {
        const isActive = value === tab.key;
        const count = counts[tab.key] ?? 0;
        return (
          <button
            key={tab.key}
            onClick={() => onChange(tab.key)}
            className={\`relative px-2.5 py-1.5 text-xs transition-colors \${
              isActive
                ? "font-medium text-foreground"
                : "text-muted-foreground hover:text-foreground"
            }\`}
          >
            {tab.label}
            <span
              className={\`ml-1 tabular-nums \${isActive ? "text-foreground" : "text-muted-foreground/50"}\`}
            >
              {count}
            </span>
            {isActive && (
              <span className="absolute inset-x-0 -bottom-px h-px bg-foreground" />
            )}
          </button>
        );
      })}
    </div>
  );
}

// ── Sortable column header ───────────────────────────────

function ColHeader({
  label,
  sortKey,
  currentSort,
  currentDir,
  onSort,
  className = "",
}: {
  label: string;
  sortKey: SortKey;
  currentSort: SortKey;
  currentDir: SortDir;
  onSort: (key: SortKey) => void;
  className?: string;
}) {
  const active = currentSort === sortKey;
  return (
    <button
      onClick={() => onSort(sortKey)}
      className={\`flex items-center gap-1 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground \${className}\`}
    >
      {label}
      {active &&
        (currentDir === "asc" ? (
          <ArrowUp className="size-2.5" />
        ) : (
          <ArrowDown className="size-2.5" />
        ))}
    </button>
  );
}

// ── Detail panel (inline, not overlay) ───────────────────

function DetailPanel({
  lead,
  onClose,
  onStatusChange,
  onEnrich,
  onDelete,
  onNotesChange,
  enriching,
}: {
  lead: Lead;
  onClose: () => void;
  onStatusChange: (id: string, status: LeadStatus) => void;
  onEnrich: (id: string) => void;
  onDelete: (lead: Lead) => void;
  onNotesChange: (id: string, notes: string) => void;
  enriching: boolean;
}) {
  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex items-start justify-between px-5 pt-5 pb-4">
        <div className="flex flex-col gap-0.5 min-w-0">
          <span className="text-sm font-medium truncate">{lead.name}</span>
          <span className="text-xs text-muted-foreground truncate">
            {lead.title} · {lead.company}
          </span>
        </div>
        <Button
          variant="ghost"
          size="icon-xs"
          onClick={onClose}
          className="shrink-0 -mr-1 -mt-0.5 text-muted-foreground"
        >
          <X className="size-3" />
        </Button>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto no-scrollbar">
        <div className="flex flex-col gap-6 p-5">
          {/* Contact */}
          <div className="flex flex-col gap-2.5">
            <span className="text-xs font-medium text-muted-foreground">
              Contact
            </span>
            <div className="flex flex-col gap-2">
              <div className="flex items-center gap-2.5 text-xs text-muted-foreground">
                <Mail className="size-3 shrink-0" />
                <span className="truncate">{lead.email}</span>
              </div>
              <div className="flex items-center gap-2.5 text-xs text-muted-foreground">
                <Building2 className="size-3 shrink-0" />
                {lead.company}
              </div>
              <div className="flex items-center gap-2.5 text-xs text-muted-foreground">
                <User className="size-3 shrink-0" />
                {lead.title}
              </div>
            </div>
          </div>

          {/* Status */}
          <div className="flex flex-col gap-2">
            <span className="text-xs font-medium text-muted-foreground">
              Status
            </span>
            <Select
              value={lead.status}
              onValueChange={(v) =>
                onStatusChange(lead.id, v as LeadStatus)
              }
            >
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {ALL_STATUSES.map((s) => (
                  <SelectItem key={s} value={s}>
                    <div className="flex items-center gap-2">
                      <span
                        className={\`size-2 rounded-full \${STATUS_CONFIG[s].color}\`}
                      />
                      {STATUS_CONFIG[s].label}
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Enrichment */}
          <div className="flex flex-col gap-2.5">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-muted-foreground">
                Enrichment
              </span>
              {!enriching && !lead.enrichment && (
                <Button
                  variant="outline"
                  size="xs"
                  onClick={() => onEnrich(lead.id)}
                >
                  <Sparkles className="size-2.5" />
                  Enrich
                </Button>
              )}
            </div>
            {enriching ? (
              <EnrichmentSkeleton />
            ) : lead.enrichment ? (
              <EnrichmentRows enrichment={lead.enrichment} />
            ) : (
              <p className="text-xs text-muted-foreground/50">
                Not enriched yet.
              </p>
            )}
          </div>

          {/* Notes */}
          <div className="flex flex-col gap-2">
            <span className="text-xs font-medium text-muted-foreground">
              Notes
            </span>
            <textarea
              value={lead.notes}
              onChange={(e) => onNotesChange(lead.id, e.target.value)}
              placeholder="Add a note..."
              rows={3}
              className="w-full resize-none rounded-md border border-input bg-input/20 px-2 py-1.5 text-xs outline-none transition-colors placeholder:text-muted-foreground/40 focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30"
            />
          </div>

          {/* Activity */}
          <div className="flex flex-col gap-2.5">
            <span className="text-xs font-medium text-muted-foreground">
              Activity
            </span>
            <div className="flex flex-col gap-0 pl-2.5 border-l border-border">
              {lead.enriched && (
                <ActivityItem text="Enrichment completed" time="1d ago" />
              )}
              {lead.status !== "new" && (
                <ActivityItem
                  text={\`Status → \${STATUS_CONFIG[lead.status].label}\`}
                  time="2d ago"
                />
              )}
              <ActivityItem text="Lead created" time={relativeDate(lead.createdAt)} />
            </div>
          </div>
        </div>
      </div>

      {/* Footer */}
      <div className="px-5 pb-5 pt-2">
        <Button
          variant="ghost"
          size="sm"
          className="w-full text-destructive hover:text-destructive hover:bg-destructive/10"
          onClick={() => onDelete(lead)}
        >
          <Trash2 className="size-3" />
          Delete
        </Button>
      </div>
    </div>
  );
}

function ActivityItem({ text, time }: { text: string; time: string }) {
  return (
    <div className="relative flex items-baseline justify-between py-1.5">
      <div className="absolute -left-[calc(0.625rem+0.5px)] top-1/2 size-1.5 -translate-y-1/2 rounded-full bg-border" />
      <span className="text-xs text-muted-foreground">{text}</span>
      <span className="shrink-0 text-[0.625rem] text-muted-foreground/40">
        {time}
      </span>
    </div>
  );
}

function EnrichmentRows({ enrichment }: { enrichment: Enrichment }) {
  const rows = [
    { k: "Industry", v: enrichment.industry },
    { k: "Size", v: enrichment.companySize },
    { k: "Location", v: enrichment.location },
    { k: "LinkedIn", v: enrichment.linkedin },
    { k: "Active", v: enrichment.lastActivity },
  ];
  return (
    <div className="flex flex-col gap-1.5">
      {rows.map((r) => (
        <div key={r.k} className="flex items-center justify-between text-xs">
          <span className="text-muted-foreground">{r.k}</span>
          <span className="font-medium text-foreground">{r.v}</span>
        </div>
      ))}
    </div>
  );
}

function EnrichmentSkeleton() {
  return (
    <div className="flex flex-col gap-2">
      {Array.from({ length: 5 }).map((_, i) => (
        <div key={i} className="flex items-center justify-between">
          <Skeleton className="h-3 w-14" />
          <Skeleton className="h-3 w-24" />
        </div>
      ))}
    </div>
  );
}

// ── Dialogs ──────────────────────────────────────────────

function AddLeadDialog({
  open,
  onOpenChange,
  onAdd,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onAdd: (
    lead: Omit<Lead, "id" | "enriched" | "enrichment" | "createdAt">,
  ) => void;
}) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [company, setCompany] = useState("");
  const [title, setTitle] = useState("");

  const reset = () => {
    setName("");
    setEmail("");
    setCompany("");
    setTitle("");
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !email.trim()) return;
    onAdd({
      name: name.trim(),
      email: email.trim(),
      company: company.trim(),
      title: title.trim(),
      status: "new",
      notes: "",
    });
    reset();
    onOpenChange(false);
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!v) reset();
        onOpenChange(v);
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add lead</DialogTitle>
          <DialogDescription>
            Add a new lead to your pipeline.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="mt-3 flex flex-col gap-3">
          <Field label="Name">
            <Input
              autoFocus
              placeholder="Jane Smith"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
            />
          </Field>
          <Field label="Email">
            <Input
              type="email"
              placeholder="jane@company.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </Field>
          <Field label="Company">
            <Input
              placeholder="Company Inc"
              value={company}
              onChange={(e) => setCompany(e.target.value)}
            />
          </Field>
          <Field label="Title">
            <Input
              placeholder="Product Manager"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
          </Field>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              size="sm"
              disabled={!name.trim() || !email.trim()}
            >
              Add lead
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1">
      <label className="text-xs font-medium">{label}</label>
      {children}
    </div>
  );
}

function DeleteDialog({
  lead,
  onOpenChange,
  onConfirm,
}: {
  lead: Lead | null;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
}) {
  const [deleting, setDeleting] = useState(false);

  const handleDelete = async () => {
    setDeleting(true);
    await new Promise((r) => setTimeout(r, 600));
    onConfirm();
    setDeleting(false);
  };

  return (
    <Dialog open={!!lead} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Delete lead</DialogTitle>
          <DialogDescription>
            Are you sure you want to delete{" "}
            <span className="font-medium text-foreground">{lead?.name}</span>?
            This action cannot be undone.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button
            variant="outline"
            size="sm"
            onClick={() => onOpenChange(false)}
            disabled={deleting}
          >
            Cancel
          </Button>
          <Button
            variant="destructive"
            size="sm"
            onClick={handleDelete}
            disabled={deleting}
          >
            {deleting ? (
              <Loader2 className="size-3 animate-spin" />
            ) : (
              <Trash2 className="size-3" />
            )}
            {deleting ? "Deleting..." : "Delete"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Bulk action bar ──────────────────────────────────────

function BulkBar({
  count,
  onEnrich,
  onDelete,
  onClear,
}: {
  count: number;
  onEnrich: () => void;
  onDelete: () => void;
  onClear: () => void;
}) {
  return (
    <div className="absolute bottom-5 left-1/2 z-20 flex -translate-x-1/2 items-center gap-2 rounded-lg bg-card px-3 py-2 shadow-lg ring-1 ring-foreground/10">
      <span className="text-xs font-medium tabular-nums">
        {count} selected
      </span>
      <Separator orientation="vertical" className="h-4" />
      <Button variant="ghost" size="sm" onClick={onEnrich}>
        <Sparkles className="size-3" />
        Enrich
      </Button>
      <Button
        variant="ghost"
        size="sm"
        className="text-destructive hover:text-destructive hover:bg-destructive/10"
        onClick={onDelete}
      >
        <Trash2 className="size-3" />
        Delete
      </Button>
      <Separator orientation="vertical" className="h-4" />
      <Button variant="ghost" size="icon-xs" onClick={onClear}>
        <X className="size-2.5" />
      </Button>
    </div>
  );
}

// ── Table skeleton ───────────────────────────────────────

function TableSkeleton() {
  return (
    <>
      {Array.from({ length: 8 }).map((_, i) => (
        <div
          key={i}
          className="flex items-center border-b border-foreground/[0.03] px-4 py-2.5"
        >
          <span className="w-8" />
          <span className="w-[24%] pr-3">
            <Skeleton className="h-3.5 w-24" />
          </span>
          <span className="w-[28%] pr-3">
            <Skeleton className="h-3 w-36" />
          </span>
          <span className="w-[20%] pr-3">
            <Skeleton className="h-3 w-20" />
          </span>
          <span className="w-[14%]">
            <Skeleton className="h-5 w-16 rounded-full" />
          </span>
          <span className="w-[14%] text-right">
            <Skeleton className="ml-auto h-3 w-10" />
          </span>
        </div>
      ))}
    </>
  );
}

// ── Main App ─────────────────────────────────────────────

export default function App() {
  const [leads, setLeads] = useState(INITIAL_LEADS);
  const [filter, setFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("createdAt");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [selectedLead, setSelectedLead] = useState<Lead | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Lead | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [enrichingId, setEnrichingId] = useState<string | null>(null);

  const searchRef = useRef<HTMLInputElement>(null);

  // Initial load
  useEffect(() => {
    const t = setTimeout(() => setLoading(false), 1000);
    return () => clearTimeout(t);
  }, []);

  // Keyboard shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;

      if (e.key === "/" && !e.metaKey && !e.ctrlKey) {
        e.preventDefault();
        searchRef.current?.focus();
      }
      if (e.key === "n" && !e.metaKey && !e.ctrlKey) {
        e.preventDefault();
        setAddOpen(true);
      }
      if (e.key === "Escape") {
        if (selectedLead) setSelectedLead(null);
        else if (selected.size > 0) setSelected(new Set());
        else if (search) setSearch("");
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [selectedLead, selected, search]);

  // Keep detail panel in sync
  useEffect(() => {
    if (selectedLead) {
      const updated = leads.find((l) => l.id === selectedLead.id);
      if (updated) setSelectedLead(updated);
      else setSelectedLead(null);
    }
  }, [leads, selectedLead]);

  // Derived data
  const counts: Record<string, number> = { all: leads.length };
  for (const s of ALL_STATUSES) {
    counts[s] = leads.filter((l) => l.status === s).length;
  }

  const filtered = sortLeads(
    leads.filter((lead) => {
      const matchesFilter = filter === "all" || lead.status === filter;
      const q = search.toLowerCase();
      const matchesSearch =
        !q ||
        lead.name.toLowerCase().includes(q) ||
        lead.email.toLowerCase().includes(q) ||
        lead.company.toLowerCase().includes(q) ||
        lead.title.toLowerCase().includes(q);
      return matchesFilter && matchesSearch;
    }),
    sortKey,
    sortDir,
  );

  // Handlers
  const handleSort = useCallback(
    (key: SortKey) => {
      if (key === sortKey) {
        setSortDir((d) => (d === "asc" ? "desc" : "asc"));
      } else {
        setSortKey(key);
        setSortDir("asc");
      }
    },
    [sortKey],
  );

  const toggleSelect = useCallback((id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const toggleSelectAll = useCallback(() => {
    if (selected.size === filtered.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(filtered.map((l) => l.id)));
    }
  }, [filtered, selected.size]);

  const handleStatusChange = useCallback(
    (id: string, status: LeadStatus) => {
      setLeads((prev) =>
        prev.map((l) => (l.id === id ? { ...l, status } : l)),
      );
    },
    [],
  );

  const handleNotesChange = useCallback((id: string, notes: string) => {
    setLeads((prev) =>
      prev.map((l) => (l.id === id ? { ...l, notes } : l)),
    );
  }, []);

  const handleEnrich = useCallback((id: string) => {
    setEnrichingId(id);
    setTimeout(() => {
      setLeads((prev) =>
        prev.map((l) =>
          l.id === id
            ? {
                ...l,
                enriched: true,
                enrichment: {
                  industry: "Technology",
                  companySize: "100–500",
                  location: "Austin, TX",
                  linkedin:
                    "linkedin.com/in/" +
                    l.name.toLowerCase().replace(/\\s/g, ""),
                  lastActivity: "Just now",
                },
              }
            : l,
        ),
      );
      setEnrichingId(null);
    }, 2000);
  }, []);

  const handleBulkEnrich = useCallback(() => {
    const ids = [...selected];
    let i = 0;
    const next = () => {
      if (i >= ids.length) return;
      const id = ids[i++];
      setEnrichingId(id);
      setTimeout(() => {
        setLeads((prev) =>
          prev.map((l) =>
            l.id === id
              ? {
                  ...l,
                  enriched: true,
                  enrichment: {
                    industry: "Technology",
                    companySize: "100–500",
                    location: "Austin, TX",
                    linkedin:
                      "linkedin.com/in/" +
                      l.name.toLowerCase().replace(/\\s/g, ""),
                    lastActivity: "Just now",
                  },
                }
              : l,
          ),
        );
        setEnrichingId(null);
        setTimeout(next, 200);
      }, 800);
    };
    next();
    setSelected(new Set());
  }, [selected]);

  const handleAdd = useCallback(
    (data: Omit<Lead, "id" | "enriched" | "enrichment" | "createdAt">) => {
      setLeads((prev) => [
        {
          ...data,
          id: String(Date.now()),
          enriched: false,
          enrichment: null,
          createdAt: new Date().toISOString().slice(0, 10),
        },
        ...prev,
      ]);
    },
    [],
  );

  const handleDelete = useCallback(() => {
    if (!deleteTarget) return;
    setLeads((prev) => prev.filter((l) => l.id !== deleteTarget.id));
    if (selectedLead?.id === deleteTarget.id) setSelectedLead(null);
    setSelected((prev) => {
      const next = new Set(prev);
      next.delete(deleteTarget.id);
      return next;
    });
    setDeleteTarget(null);
  }, [deleteTarget, selectedLead]);

  const handleBulkDelete = useCallback(() => {
    setLeads((prev) => prev.filter((l) => !selected.has(l.id)));
    if (selectedLead && selected.has(selectedLead.id)) setSelectedLead(null);
    setSelected(new Set());
  }, [selected, selectedLead]);

  const allChecked = filtered.length > 0 && selected.size === filtered.length;

  return (
    <div className="relative flex h-svh flex-col overflow-hidden bg-background text-foreground">
      {/* Header */}
      <div className="shrink-0 px-5 pt-5">
        <div className="flex items-center justify-between pb-4">
          <h1 className="text-sm font-semibold">Leads</h1>
          <div className="flex items-center gap-1.5">
            <span className="hidden text-[0.625rem] text-muted-foreground/40 sm:inline">
              <kbd className="rounded border border-border px-1 py-0.5 font-mono text-[0.5rem]">
                N
              </kbd>{" "}
              new ·{" "}
              <kbd className="rounded border border-border px-1 py-0.5 font-mono text-[0.5rem]">
                /
              </kbd>{" "}
              search
            </span>
            <Button size="sm" onClick={() => setAddOpen(true)}>
              <Plus className="size-3" />
              New
            </Button>
          </div>
        </div>

        {/* Tabs */}
        <FilterTabs value={filter} onChange={setFilter} counts={counts} />
      </div>

      {/* Toolbar */}
      <div className="shrink-0 flex items-center gap-2 px-5 py-2">
        <div className="relative max-w-[220px] flex-1">
          <Search className="absolute left-2 top-1/2 size-3 -translate-y-1/2 text-muted-foreground" />
          <Input
            ref={searchRef}
            placeholder="Filter..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-7 h-6 text-xs"
          />
        </div>
        {search && (
          <Button
            variant="ghost"
            size="icon-xs"
            onClick={() => setSearch("")}
          >
            <X className="size-2.5" />
          </Button>
        )}
        <div className="flex-1" />
        <span className="text-[0.625rem] tabular-nums text-muted-foreground/40">
          {filtered.length} {filtered.length === 1 ? "lead" : "leads"}
          {leads.filter((l) => l.enriched).length > 0 && (
            <> · {leads.filter((l) => l.enriched).length} enriched</>
          )}
        </span>
      </div>

      {/* Main area: table + inline detail panel */}
      <div className="flex flex-1 min-h-0 overflow-hidden gap-4 px-5 pb-5 pt-3">
        {/* Table */}
        <div className="flex-1 min-w-0 flex flex-col overflow-hidden rounded-lg ring-1 ring-foreground/10">
          {/* Table header */}
          <div className="flex shrink-0 items-center bg-card/50 px-4 py-2 border-b border-foreground/[0.06]">
            <span className="w-8 shrink-0">
              <Checkbox
                checked={allChecked}
                onChange={toggleSelectAll}
              />
            </span>
            <ColHeader
              label="Name"
              sortKey="name"
              currentSort={sortKey}
              currentDir={sortDir}
              onSort={handleSort}
              className="w-[24%]"
            />
            <span className="w-[28%] text-xs font-medium text-muted-foreground">
              Email
            </span>
            <ColHeader
              label="Company"
              sortKey="company"
              currentSort={sortKey}
              currentDir={sortDir}
              onSort={handleSort}
              className="w-[20%]"
            />
            <ColHeader
              label="Status"
              sortKey="status"
              currentSort={sortKey}
              currentDir={sortDir}
              onSort={handleSort}
              className="w-[14%]"
            />
            <ColHeader
              label="Added"
              sortKey="createdAt"
              currentSort={sortKey}
              currentDir={sortDir}
              onSort={handleSort}
              className="w-[14%] justify-end"
            />
          </div>

          {/* Rows */}
          <div className="flex-1 overflow-y-auto">
            {loading ? (
              <TableSkeleton />
            ) : filtered.length === 0 ? (
              <div className="flex flex-col items-center justify-center gap-1.5 py-16">
                <Users className="size-5 text-muted-foreground/20" />
                <p className="text-xs text-muted-foreground/50">
                  {search
                    ? \`No results for "\${search}"\`
                    : filter !== "all"
                      ? \`No \${STATUS_CONFIG[filter as LeadStatus].label.toLowerCase()} leads\`
                      : "No leads yet"}
                </p>
                {(search || filter !== "all") && (
                  <button
                    onClick={() => {
                      setSearch("");
                      setFilter("all");
                    }}
                    className="text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground"
                  >
                    Clear filters
                  </button>
                )}
              </div>
            ) : (
              filtered.map((lead) => {
                const isSelected = selected.has(lead.id);
                const isActive = selectedLead?.id === lead.id;
                return (
                  <button
                    key={lead.id}
                    onClick={() => setSelectedLead(lead)}
                    className={\`group flex w-full items-center border-b border-foreground/[0.03] px-4 py-2 text-left text-xs transition-colors hover:bg-accent/40 \${
                      isActive ? "bg-accent/50" : ""
                    }\`}
                  >
                    <span className="w-8 shrink-0" onClick={(e) => e.stopPropagation()}>
                      <Checkbox
                        checked={isSelected}
                        onChange={() => toggleSelect(lead.id)}
                      />
                    </span>
                    <span className="w-[24%] truncate pr-3">
                      <span className="font-medium text-foreground">
                        {lead.name}
                      </span>
                      {lead.enriched && (
                        <Sparkles className="ml-1 inline size-2.5 text-muted-foreground/30" />
                      )}
                    </span>
                    <span className="w-[28%] truncate pr-3 text-muted-foreground">
                      {lead.email}
                    </span>
                    <span className="w-[20%] truncate pr-3 text-muted-foreground">
                      {lead.company}
                    </span>
                    <span className="w-[14%]">
                      <Badge variant={STATUS_CONFIG[lead.status].variant}>
                        <span
                          className={\`size-1.5 rounded-full \${STATUS_CONFIG[lead.status].color}\`}
                        />
                        {STATUS_CONFIG[lead.status].label}
                      </Badge>
                    </span>
                    <span className="w-[14%] text-right text-muted-foreground/40">
                      {relativeDate(lead.createdAt)}
                    </span>
                  </button>
                );
              })
            )}
          </div>
        </div>

        {/* Inline detail panel */}
        <div
          className={\`shrink-0 overflow-hidden transition-[width] duration-200 ease-out \${
            selectedLead ? "w-[340px]" : "w-0"
          }\`}
        >
          <div className="h-full w-[340px] overflow-hidden rounded-lg border border-border bg-card">
            {selectedLead && (
              <DetailPanel
                lead={selectedLead}
                onClose={() => setSelectedLead(null)}
                onStatusChange={handleStatusChange}
                onEnrich={handleEnrich}
                onDelete={(lead) => setDeleteTarget(lead)}
                onNotesChange={handleNotesChange}
                enriching={enrichingId === selectedLead.id}
              />
            )}
          </div>
        </div>
      </div>

      {/* Bulk action bar */}
      {selected.size > 0 && (
        <BulkBar
          count={selected.size}
          onEnrich={handleBulkEnrich}
          onDelete={handleBulkDelete}
          onClear={() => setSelected(new Set())}
        />
      )}

      {/* Dialogs */}
      <AddLeadDialog
        open={addOpen}
        onOpenChange={setAddOpen}
        onAdd={handleAdd}
      />
      <DeleteDialog
        lead={deleteTarget}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null);
        }}
        onConfirm={handleDelete}
      />
    </div>
  );
}
`,
  "src/index.css": `@tailwind base;
@tailwind components;
@tailwind utilities;

:root {
  --background: 0 0% 100%;
  --foreground: 0 0% 5%;
  --card: 0 0% 100%;
  --card-foreground: 0 0% 5%;
  --popover: 0 0% 100%;
  --popover-foreground: 0 0% 5%;
  --primary: 0 0% 8%;
  --primary-foreground: 0 0% 97%;
  --secondary: 0 0% 95%;
  --secondary-foreground: 0 0% 8%;
  --muted: 0 0% 95%;
  --muted-foreground: 0 0% 38%;
  --accent: 0 0% 95%;
  --accent-foreground: 0 0% 8%;
  --destructive: 0 84% 60%;
  --destructive-foreground: 0 0% 97%;
  --border: 0 0% 90%;
  --input: 0 0% 90%;
  --ring: 0 0% 55%;
  --sidebar: 0 0% 97%;
  --sidebar-foreground: 0 0% 8%;
  --sidebar-accent: 0 0% 93%;
  --sidebar-accent-foreground: 0 0% 8%;
  --sidebar-border: 0 0% 90%;
  --sidebar-muted: 0 0% 55%;
  --radius: 0.625rem;
}

@media (prefers-color-scheme: dark) {
:root {
  --background: 220 7% 10%;
  --foreground: 0 0% 100%;
  --card: 225 6% 14%;
  --card-foreground: 0 0% 100%;
  --popover: 225 6% 14%;
  --popover-foreground: 0 0% 100%;
  --primary: 0 0% 87%;
  --primary-foreground: 0 0% 8%;
  --secondary: 228 6% 17%;
  --secondary-foreground: 0 0% 97%;
  --muted: 228 6% 17%;
  --muted-foreground: 0 0% 55%;
  --accent: 228 6% 17%;
  --accent-foreground: 0 0% 97%;
  --destructive: 0 84% 60%;
  --destructive-foreground: 0 0% 97%;
  --border: 220 3% 19%;
  --input: 220 2% 24%;
  --ring: 0 0% 38%;
  --sidebar: 240 5% 7%;
  --sidebar-foreground: 0 0% 97%;
  --sidebar-accent: 0 0% 16%;
  --sidebar-accent-foreground: 0 0% 97%;
  --sidebar-border: 220 3% 19%;
  --sidebar-muted: 0 0% 40%;
  --radius: 0.625rem;
}
}

* {
  border-color: hsl(var(--border));
}

body {
  background-color: hsl(var(--background));
  color: hsl(var(--foreground));
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
  margin: 0;
}

@keyframes fade-in-up {
  from {
    opacity: 0;
    filter: blur(4px);
    transform: translateY(10px);
  }
  to {
    opacity: 1;
    filter: blur(0);
    transform: translateY(0);
  }
}

.animate-fade-in-up {
  animation: fade-in-up 0.4s ease-out forwards;
}

/* Hide scrollbar but keep scroll */
.no-scrollbar::-webkit-scrollbar {
  display: none;
}
.no-scrollbar {
  -ms-overflow-style: none;
  scrollbar-width: none;
}
`,
  "src/lib/utils.ts": `import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
`,
  "src/lib/data.ts": `export type LeadStatus = "new" | "contacted" | "qualified" | "converted" | "lost";

export type Enrichment = {
  industry: string;
  companySize: string;
  location: string;
  linkedin: string;
  lastActivity: string;
};

export type Lead = {
  id: string;
  name: string;
  email: string;
  company: string;
  title: string;
  status: LeadStatus;
  enriched: boolean;
  enrichment: Enrichment | null;
  notes: string;
  createdAt: string;
};

export const STATUS_CONFIG: Record<
  LeadStatus,
  { label: string; color: string; variant: "default" | "secondary" | "destructive" | "outline" }
> = {
  new: { label: "New", color: "bg-blue-500", variant: "outline" },
  contacted: { label: "Contacted", color: "bg-yellow-500", variant: "secondary" },
  qualified: { label: "Qualified", color: "bg-emerald-500", variant: "default" },
  converted: { label: "Converted", color: "bg-violet-500", variant: "default" },
  lost: { label: "Lost", color: "bg-red-500", variant: "destructive" },
};

export const ALL_STATUSES: LeadStatus[] = [
  "new",
  "contacted",
  "qualified",
  "converted",
  "lost",
];

export const LEADS: Lead[] = [
  {
    id: "1",
    name: "Sarah Chen",
    email: "sarah@acme.co",
    company: "Acme Corp",
    title: "Senior Product Manager",
    status: "qualified",
    enriched: true,
    enrichment: {
      industry: "Technology",
      companySize: "500–1,000",
      location: "San Francisco, CA",
      linkedin: "linkedin.com/in/sarachen",
      lastActivity: "2 days ago",
    },
    notes: "Met at SaaStr Annual. Strong interest in enterprise plan.",
    createdAt: "2026-03-28",
  },
  {
    id: "2",
    name: "James Wilson",
    email: "james@globex.io",
    company: "Globex Inc",
    title: "CTO",
    status: "new",
    enriched: false,
    enrichment: null,
    notes: "",
    createdAt: "2026-04-01",
  },
  {
    id: "3",
    name: "Maria Garcia",
    email: "maria@initech.com",
    company: "Initech",
    title: "VP Engineering",
    status: "contacted",
    enriched: true,
    enrichment: {
      industry: "Financial Services",
      companySize: "1,000–5,000",
      location: "New York, NY",
      linkedin: "linkedin.com/in/mariagarcia",
      lastActivity: "5 hours ago",
    },
    notes: "Replied to cold outreach. Scheduling a demo.",
    createdAt: "2026-03-30",
  },
  {
    id: "4",
    name: "Alex Kim",
    email: "alex@hooli.dev",
    company: "Hooli",
    title: "Engineering Manager",
    status: "converted",
    enriched: true,
    enrichment: {
      industry: "Technology",
      companySize: "10,000+",
      location: "Palo Alto, CA",
      linkedin: "linkedin.com/in/alexkim",
      lastActivity: "1 week ago",
    },
    notes: "Signed annual contract. Onboarding next week.",
    createdAt: "2026-03-15",
  },
  {
    id: "5",
    name: "Priya Patel",
    email: "priya@piedpiper.com",
    company: "Pied Piper",
    title: "Head of Growth",
    status: "new",
    enriched: false,
    enrichment: null,
    notes: "",
    createdAt: "2026-04-02",
  },
  {
    id: "6",
    name: "Tom Anderson",
    email: "tom@wayneent.com",
    company: "Wayne Enterprises",
    title: "Director of Operations",
    status: "lost",
    enriched: true,
    enrichment: {
      industry: "Defense & Aerospace",
      companySize: "10,000+",
      location: "Gotham City",
      linkedin: "linkedin.com/in/tomanderson",
      lastActivity: "3 weeks ago",
    },
    notes: "Went with a competitor. Revisit in Q3.",
    createdAt: "2026-02-20",
  },
  {
    id: "7",
    name: "Lisa Park",
    email: "lisa@stark.io",
    company: "Stark Industries",
    title: "Staff Engineer",
    status: "contacted",
    enriched: true,
    enrichment: {
      industry: "Advanced Manufacturing",
      companySize: "5,000–10,000",
      location: "Los Angeles, CA",
      linkedin: "linkedin.com/in/lisapark",
      lastActivity: "1 day ago",
    },
    notes: "Technical evaluation in progress.",
    createdAt: "2026-03-25",
  },
  {
    id: "8",
    name: "David Nguyen",
    email: "david@umbrella.co",
    company: "Umbrella Corp",
    title: "Lead Architect",
    status: "qualified",
    enriched: false,
    enrichment: null,
    notes: "Passed qualification. Needs enrichment before outreach.",
    createdAt: "2026-03-22",
  },
  {
    id: "9",
    name: "Rachel Moore",
    email: "rachel@oscorp.io",
    company: "Oscorp",
    title: "Data Science Lead",
    status: "new",
    enriched: false,
    enrichment: null,
    notes: "",
    createdAt: "2026-04-03",
  },
  {
    id: "10",
    name: "Kevin O'Brien",
    email: "kevin@lexcorp.com",
    company: "LexCorp",
    title: "COO",
    status: "qualified",
    enriched: true,
    enrichment: {
      industry: "Energy",
      companySize: "5,000–10,000",
      location: "Metropolis",
      linkedin: "linkedin.com/in/kevinobrien",
      lastActivity: "4 days ago",
    },
    notes: "Negotiating pricing. Decision expected next week.",
    createdAt: "2026-03-18",
  },
];
`,
  "src/components/ui/button.tsx": `import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex shrink-0 items-center justify-center rounded-md border border-transparent text-xs font-medium whitespace-nowrap transition-all outline-none select-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30 disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground hover:bg-primary/80",
        outline:
          "border-border hover:bg-input/50 hover:text-foreground",
        secondary:
          "bg-secondary text-secondary-foreground hover:bg-secondary/80",
        ghost:
          "hover:bg-muted hover:text-foreground",
        destructive:
          "bg-destructive/10 text-destructive hover:bg-destructive/20",
        link: "text-primary underline-offset-4 hover:underline",
      },
      size: {
        default: "h-7 gap-1 px-2 text-xs [&_svg:not([class*='size-'])]:size-3.5",
        xs: "h-5 gap-1 rounded-sm px-2 text-[0.625rem] [&_svg:not([class*='size-'])]:size-2.5",
        sm: "h-6 gap-1 px-2 text-xs [&_svg:not([class*='size-'])]:size-3",
        lg: "h-8 gap-1 px-2.5 text-xs [&_svg:not([class*='size-'])]:size-4",
        icon: "size-7 [&_svg:not([class*='size-'])]:size-3.5",
        "icon-xs": "size-5 rounded-sm [&_svg:not([class*='size-'])]:size-2.5",
        "icon-sm": "size-6 [&_svg:not([class*='size-'])]:size-3",
        "icon-lg": "size-8 [&_svg:not([class*='size-'])]:size-4",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean;
  };

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button";
    return (
      <Comp
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        {...props}
      />
    );
  },
);
Button.displayName = "Button";

export { Button, buttonVariants };
`,
  "src/components/ui/input.tsx": `import * as React from "react";
import { cn } from "@/lib/utils";

const Input = React.forwardRef<
  HTMLInputElement,
  React.InputHTMLAttributes<HTMLInputElement>
>(({ className, type, ...props }, ref) => {
  return (
    <input
      type={type}
      className={cn(
        "h-7 w-full min-w-0 rounded-md border border-input bg-input/20 px-2 py-0.5 text-sm transition-colors outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30 disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 md:text-xs",
        className,
      )}
      ref={ref}
      {...props}
    />
  );
});
Input.displayName = "Input";

export { Input };
`,
  "src/components/ui/card.tsx": `import * as React from "react";
import { cn } from "@/lib/utils";

const Card = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    className={cn(
      "flex flex-col gap-4 overflow-hidden rounded-lg bg-card py-4 text-xs text-card-foreground ring-1 ring-foreground/10",
      className,
    )}
    {...props}
  />
));
Card.displayName = "Card";

const CardHeader = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    className={cn("grid auto-rows-min items-start gap-1 px-4", className)}
    {...props}
  />
));
CardHeader.displayName = "CardHeader";

const CardTitle = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    className={cn("text-sm font-medium", className)}
    {...props}
  />
));
CardTitle.displayName = "CardTitle";

const CardDescription = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    className={cn("text-xs text-muted-foreground", className)}
    {...props}
  />
));
CardDescription.displayName = "CardDescription";

const CardContent = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div ref={ref} className={cn("px-4", className)} {...props} />
));
CardContent.displayName = "CardContent";

const CardFooter = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    className={cn("flex items-center px-4", className)}
    {...props}
  />
));
CardFooter.displayName = "CardFooter";

export { Card, CardHeader, CardFooter, CardTitle, CardDescription, CardContent };
`,
  "src/components/ui/badge.tsx": `import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center h-5 rounded-full gap-1 px-2 text-[0.625rem] font-medium transition-colors",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground",
        secondary: "bg-secondary text-secondary-foreground",
        destructive: "bg-destructive/10 text-destructive",
        outline: "border border-border bg-input/20 text-foreground",
        ghost: "text-muted-foreground",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  },
);

type BadgeProps = React.HTMLAttributes<HTMLDivElement> &
  VariantProps<typeof badgeVariants>;

function Badge({ className, variant, ...props }: BadgeProps) {
  return (
    <div className={cn(badgeVariants({ variant }), className)} {...props} />
  );
}

export { Badge, badgeVariants };
`,
  "src/components/ui/separator.tsx": `import * as React from "react";
import { cn } from "@/lib/utils";

type SeparatorProps = React.HTMLAttributes<HTMLDivElement> & {
  orientation?: "horizontal" | "vertical";
};

const Separator = React.forwardRef<HTMLDivElement, SeparatorProps>(
  ({ className, orientation = "horizontal", ...props }, ref) => (
    <div
      ref={ref}
      role="separator"
      className={cn(
        "shrink-0 bg-border",
        orientation === "horizontal" ? "h-px w-full" : "w-px self-stretch",
        className,
      )}
      {...props}
    />
  ),
);
Separator.displayName = "Separator";

export { Separator };
`,
  "src/components/ui/skeleton.tsx": `import { cn } from "@/lib/utils";

function Skeleton({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn("animate-pulse rounded-md bg-muted", className)}
      {...props}
    />
  );
}

export { Skeleton };
`,
  "src/components/ui/dialog.tsx": `import * as React from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

const Dialog = DialogPrimitive.Root;
const DialogTrigger = DialogPrimitive.Trigger;
const DialogClose = DialogPrimitive.Close;
const DialogPortal = DialogPrimitive.Portal;

const DialogOverlay = React.forwardRef<
  React.ComponentRef<typeof DialogPrimitive.Overlay>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Overlay>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Overlay
    ref={ref}
    className={cn(
      "fixed inset-0 z-50 bg-black/50 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0",
      className,
    )}
    {...props}
  />
));
DialogOverlay.displayName = DialogPrimitive.Overlay.displayName;

const DialogContent = React.forwardRef<
  React.ComponentRef<typeof DialogPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content>
>(({ className, children, ...props }, ref) => (
  <DialogPortal>
    <DialogOverlay />
    <DialogPrimitive.Content
      ref={ref}
      className={cn(
        "fixed left-[50%] top-[50%] z-50 w-full max-w-[calc(100%-2rem)] translate-x-[-50%] translate-y-[-50%] rounded-lg bg-background p-6 shadow-lg ring-1 ring-foreground/10 duration-200 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[state=closed]:slide-out-to-left-1/2 data-[state=closed]:slide-out-to-top-[48%] data-[state=open]:slide-in-from-left-1/2 data-[state=open]:slide-in-from-top-[48%] sm:max-w-md",
        className,
      )}
      {...props}
    >
      {children}
      <DialogPrimitive.Close className="absolute right-4 top-4 rounded-sm text-muted-foreground opacity-70 transition-opacity hover:opacity-100 focus:outline-none disabled:pointer-events-none">
        <X className="size-4" />
        <span className="sr-only">Close</span>
      </DialogPrimitive.Close>
    </DialogPrimitive.Content>
  </DialogPortal>
));
DialogContent.displayName = DialogPrimitive.Content.displayName;

function DialogHeader({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn("flex flex-col gap-1.5", className)}
      {...props}
    />
  );
}

function DialogFooter({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn("mt-4 flex justify-end gap-2", className)}
      {...props}
    />
  );
}

const DialogTitle = React.forwardRef<
  React.ComponentRef<typeof DialogPrimitive.Title>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Title>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Title
    ref={ref}
    className={cn("text-sm font-semibold leading-none", className)}
    {...props}
  />
));
DialogTitle.displayName = DialogPrimitive.Title.displayName;

const DialogDescription = React.forwardRef<
  React.ComponentRef<typeof DialogPrimitive.Description>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Description>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Description
    ref={ref}
    className={cn("text-xs text-muted-foreground", className)}
    {...props}
  />
));
DialogDescription.displayName = DialogPrimitive.Description.displayName;

export {
  Dialog,
  DialogPortal,
  DialogOverlay,
  DialogClose,
  DialogTrigger,
  DialogContent,
  DialogHeader,
  DialogFooter,
  DialogTitle,
  DialogDescription,
};
`,
  "src/components/ui/select.tsx": `import * as React from "react";
import * as SelectPrimitive from "@radix-ui/react-select";
import { Check, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

const Select = SelectPrimitive.Root;
const SelectGroup = SelectPrimitive.Group;
const SelectValue = SelectPrimitive.Value;

const SelectTrigger = React.forwardRef<
  React.ComponentRef<typeof SelectPrimitive.Trigger>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.Trigger>
>(({ className, children, ...props }, ref) => (
  <SelectPrimitive.Trigger
    ref={ref}
    className={cn(
      "flex h-7 w-full items-center justify-between gap-2 rounded-md border border-border bg-input/20 px-2 text-xs outline-none transition-colors placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30 disabled:cursor-not-allowed disabled:opacity-50 [&>span]:truncate",
      className,
    )}
    {...props}
  >
    {children}
    <SelectPrimitive.Icon asChild>
      <ChevronDown className="size-3.5 shrink-0 text-muted-foreground" />
    </SelectPrimitive.Icon>
  </SelectPrimitive.Trigger>
));
SelectTrigger.displayName = SelectPrimitive.Trigger.displayName;

const SelectContent = React.forwardRef<
  React.ComponentRef<typeof SelectPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.Content>
>(({ className, children, position = "popper", ...props }, ref) => (
  <SelectPrimitive.Portal>
    <SelectPrimitive.Content
      ref={ref}
      className={cn(
        "relative z-50 max-h-72 min-w-[8rem] overflow-hidden rounded-lg bg-popover p-1 text-popover-foreground shadow-md ring-1 ring-foreground/10 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95",
        position === "popper" && "translate-y-1",
        className,
      )}
      position={position}
      {...props}
    >
      <SelectPrimitive.Viewport
        className={cn(
          position === "popper" &&
            "h-[var(--radix-select-trigger-height)] w-full min-w-[var(--radix-select-trigger-width)]",
        )}
      >
        {children}
      </SelectPrimitive.Viewport>
    </SelectPrimitive.Content>
  </SelectPrimitive.Portal>
));
SelectContent.displayName = SelectPrimitive.Content.displayName;

const SelectLabel = React.forwardRef<
  React.ComponentRef<typeof SelectPrimitive.Label>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.Label>
>(({ className, ...props }, ref) => (
  <SelectPrimitive.Label
    ref={ref}
    className={cn("px-2 py-1.5 text-xs text-muted-foreground", className)}
    {...props}
  />
));
SelectLabel.displayName = SelectPrimitive.Label.displayName;

const SelectItem = React.forwardRef<
  React.ComponentRef<typeof SelectPrimitive.Item>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.Item>
>(({ className, children, ...props }, ref) => (
  <SelectPrimitive.Item
    ref={ref}
    className={cn(
      "relative flex min-h-7 w-full cursor-default select-none items-center gap-2 rounded-md py-1 pl-7 pr-2 text-xs outline-none focus:bg-accent focus:text-accent-foreground data-[disabled]:pointer-events-none data-[disabled]:opacity-50",
      className,
    )}
    {...props}
  >
    <span className="absolute left-2 flex size-3.5 items-center justify-center">
      <SelectPrimitive.ItemIndicator>
        <Check className="size-3" />
      </SelectPrimitive.ItemIndicator>
    </span>
    <SelectPrimitive.ItemText>{children}</SelectPrimitive.ItemText>
  </SelectPrimitive.Item>
));
SelectItem.displayName = SelectPrimitive.Item.displayName;

const SelectSeparator = React.forwardRef<
  React.ComponentRef<typeof SelectPrimitive.Separator>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.Separator>
>(({ className, ...props }, ref) => (
  <SelectPrimitive.Separator
    ref={ref}
    className={cn("-mx-1 my-1 h-px bg-border/50", className)}
    {...props}
  />
));
SelectSeparator.displayName = SelectPrimitive.Separator.displayName;

export {
  Select,
  SelectGroup,
  SelectValue,
  SelectTrigger,
  SelectContent,
  SelectLabel,
  SelectItem,
  SelectSeparator,
};
`,
  "src/components/ui/tooltip.tsx": `import * as React from "react";
import * as TooltipPrimitive from "@radix-ui/react-tooltip";
import { cn } from "@/lib/utils";

const TooltipProvider = TooltipPrimitive.Provider;
const Tooltip = TooltipPrimitive.Root;
const TooltipTrigger = TooltipPrimitive.Trigger;

const TooltipContent = React.forwardRef<
  React.ComponentRef<typeof TooltipPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof TooltipPrimitive.Content>
>(({ className, sideOffset = 4, ...props }, ref) => (
  <TooltipPrimitive.Portal>
    <TooltipPrimitive.Content
      ref={ref}
      sideOffset={sideOffset}
      className={cn(
        "z-50 rounded-md bg-foreground px-3 py-1.5 text-xs text-background animate-in fade-in-0 zoom-in-95 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2",
        className,
      )}
      {...props}
    />
  </TooltipPrimitive.Portal>
));
TooltipContent.displayName = TooltipPrimitive.Content.displayName;

export { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider };
`,
  "src/components/ui/sheet.tsx": `import * as React from "react";
import * as SheetPrimitive from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

const Sheet = SheetPrimitive.Root;
const SheetTrigger = SheetPrimitive.Trigger;
const SheetClose = SheetPrimitive.Close;
const SheetPortal = SheetPrimitive.Portal;

const SheetOverlay = React.forwardRef<
  React.ComponentRef<typeof SheetPrimitive.Overlay>,
  React.ComponentPropsWithoutRef<typeof SheetPrimitive.Overlay>
>(({ className, ...props }, ref) => (
  <SheetPrimitive.Overlay
    className={cn(
      "fixed inset-0 z-50 bg-black/80 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0",
      className,
    )}
    {...props}
    ref={ref}
  />
));
SheetOverlay.displayName = SheetPrimitive.Overlay.displayName;

type SheetContentProps = React.ComponentPropsWithoutRef<
  typeof SheetPrimitive.Content
> & {
  side?: "top" | "right" | "bottom" | "left";
};

const sheetVariants: Record<string, string> = {
  top: "inset-x-0 top-0 border-b data-[state=closed]:slide-out-to-top data-[state=open]:slide-in-from-top",
  bottom:
    "inset-x-0 bottom-0 border-t data-[state=closed]:slide-out-to-bottom data-[state=open]:slide-in-from-bottom",
  left: "inset-y-0 left-0 h-full w-3/4 border-r sm:max-w-sm data-[state=closed]:slide-out-to-left data-[state=open]:slide-in-from-left",
  right:
    "inset-y-0 right-0 h-full w-3/4 border-l sm:max-w-md data-[state=closed]:slide-out-to-right data-[state=open]:slide-in-from-right",
};

const SheetContent = React.forwardRef<
  React.ComponentRef<typeof SheetPrimitive.Content>,
  SheetContentProps
>(({ side = "right", className, children, ...props }, ref) => (
  <SheetPortal>
    <SheetOverlay />
    <SheetPrimitive.Content
      ref={ref}
      className={cn(
        "fixed z-50 flex flex-col bg-background shadow-lg transition ease-in-out duration-200 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:duration-200 data-[state=open]:duration-300",
        sheetVariants[side],
        className,
      )}
      {...props}
    >
      {children}
      <SheetPrimitive.Close className="absolute right-4 top-4 rounded-sm text-muted-foreground opacity-70 transition-opacity hover:opacity-100 focus:outline-none">
        <X className="size-4" />
        <span className="sr-only">Close</span>
      </SheetPrimitive.Close>
    </SheetPrimitive.Content>
  </SheetPortal>
));
SheetContent.displayName = SheetPrimitive.Content.displayName;

function SheetHeader({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn("flex flex-col gap-1.5 p-6", className)}
      {...props}
    />
  );
}

function SheetFooter({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn("mt-auto flex flex-col gap-2 p-6", className)}
      {...props}
    />
  );
}

function SheetTitle({
  className,
  ...props
}: React.HTMLAttributes<HTMLHeadingElement>) {
  return (
    <h3
      className={cn("text-sm font-medium text-foreground", className)}
      {...props}
    />
  );
}

function SheetDescription({
  className,
  ...props
}: React.HTMLAttributes<HTMLParagraphElement>) {
  return (
    <p
      className={cn("text-xs text-muted-foreground", className)}
      {...props}
    />
  );
}

export {
  Sheet,
  SheetPortal,
  SheetOverlay,
  SheetTrigger,
  SheetClose,
  SheetContent,
  SheetHeader,
  SheetFooter,
  SheetTitle,
  SheetDescription,
};
`,

  "src/lib/second-sdk.ts": `import { useState, useCallback, useEffect, useRef } from 'react';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type AgentStatus = 'idle' | 'running' | 'completed' | 'failed';

type AgentState = {
  status: AgentStatus;
  error: string | null;
  runId: string | null;
};

type UseAgentReturn = {
  trigger: (prompt: string) => Promise<string>;
  status: AgentStatus;
  error: string | null;
  isRunning: boolean;
  runId: string | null;
};

type Doc = Record<string, unknown> & { _id: string };

type UseCollectionReturn = {
  data: Doc[];
  loading: boolean;
  insert: (data: Record<string, unknown>) => Promise<Doc>;
  update: (docId: string, data: Record<string, unknown>) => Promise<Doc>;
  remove: (docId: string) => Promise<void>;
};

type UseDocReturn = {
  data: Doc | null;
  loading: boolean;
  update: (data: Record<string, unknown>) => Promise<Doc>;
  remove: () => Promise<void>;
};

export type IntegrationToolResult<TData = unknown> = {
  success: boolean;
  data?: TData;
  mock: boolean;
  mockReason?: string;
  statusCode?: number;
  error?: string;
  errorCode?: string;
  errorCategory?: string;
  resolution?: string;
  retryable?: boolean;
  canRequestBuilderRepair?: boolean;
  details?: Record<string, unknown>;
};

type UseIntegrationToolReturn<TInput extends Record<string, unknown>, TData> = {
  execute: (input: TInput) => Promise<IntegrationToolResult<TData>>;
  loading: boolean;
  error: string | null;
};

export type IntegrationToolFailureReportResult = {
  ok: boolean;
  status?: 'builder_repair_message_scheduled' | 'builder_repair_run_created' | string;
  builderRunId?: string;
  appendedToExisting?: boolean;
  error?: string;
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let requestCounter = 0;
function nextRequestId(): string {
  return crypto.randomUUID ? crypto.randomUUID() : String(++requestCounter);
}

function postToParent(msg: Record<string, unknown>) {
  window.parent.postMessage({ source: 'second-app', ...msg }, '*');
}

function waitForResponse<T>(type: string, match?: Record<string, unknown>, timeoutMs?: number): Promise<T> {
  return new Promise((resolve, reject) => {
    let timeoutId: number | null = null;
    const handler = (event: MessageEvent) => {
      const data = event.data;
      if (data?.source !== 'second-platform') return;
      if (data.type !== type) return;
      if (match) {
        for (const [k, v] of Object.entries(match)) {
          if (data[k] !== v) return;
        }
      }
      window.removeEventListener('message', handler);
      if (timeoutId !== null) window.clearTimeout(timeoutId);
      resolve(data as T);
    };
    window.addEventListener('message', handler);
    if (timeoutMs) {
      timeoutId = window.setTimeout(() => {
        window.removeEventListener('message', handler);
        reject(new Error(\`Timed out waiting for \${type}\`));
      }, timeoutMs);
    }
  });
}

// ---------------------------------------------------------------------------
// Data hooks — useCollection / useDoc
// ---------------------------------------------------------------------------

export function useCollection(collectionName: string): UseCollectionReturn {
  const [data, setData] = useState<Doc[]>([]);
  const [loading, setLoading] = useState(true);
  const collectionRef = useRef(collectionName);
  collectionRef.current = collectionName;

  // Initial fetch
  useEffect(() => {
    const requestId = nextRequestId();
    setLoading(true);

    const handler = (event: MessageEvent) => {
      const d = event.data;
      if (
        d?.source === 'second-platform' &&
        d.type === 'second:data:list-response' &&
        d.requestId === requestId
      ) {
        window.removeEventListener('message', handler);
        setData(d.docs ?? []);
        setLoading(false);
      }
    };
    window.addEventListener('message', handler);
    postToParent({ type: 'second:data:list', collection: collectionName, requestId });

    return () => window.removeEventListener('message', handler);
  }, [collectionName]);

  // Live change events
  useEffect(() => {
    const handler = (event: MessageEvent) => {
      const d = event.data;
      if (d?.source !== 'second-platform') return;
      if (d.type !== 'second:data:change') return;

      // Delete events from Change Streams don't include the collection name,
      // so they arrive as "__any__". Match by _id alone since it's unique.
      const collectionMatches = d.collection === collectionRef.current || d.collection === '__any__';
      if (!collectionMatches) return;

      if (d.operation === 'insert' && d.doc) {
        setData(prev => {
          if (prev.some(doc => doc._id === d.doc._id)) {
            return prev.map(doc => doc._id === d.doc._id ? d.doc : doc);
          }
          return [d.doc, ...prev];
        });
      } else if (d.operation === 'update' && d.doc) {
        setData(prev => prev.map(doc => doc._id === d.doc._id ? d.doc : doc));
      } else if (d.operation === 'delete' && d.docId) {
        setData(prev => prev.filter(doc => doc._id !== d.docId));
      }
    };
    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
  }, []);

  const insert = useCallback(async (insertData: Record<string, unknown>): Promise<Doc> => {
    const requestId = nextRequestId();
    const responsePromise = waitForResponse<{ doc: Doc }>(
      'second:data:insert-response',
      { requestId },
    );
    postToParent({
      type: 'second:data:insert',
      collection: collectionRef.current,
      data: insertData,
      requestId,
    });
    const response = await responsePromise;
    if (response.doc) {
      setData(prev => {
        if (prev.some(doc => doc._id === response.doc._id)) {
          return prev.map(doc => doc._id === response.doc._id ? response.doc : doc);
        }
        return [response.doc, ...prev];
      });
    }
    return response.doc;
  }, []);

  const update = useCallback(async (docId: string, updateData: Record<string, unknown>): Promise<Doc> => {
    const requestId = nextRequestId();
    const responsePromise = waitForResponse<{ doc: Doc }>(
      'second:data:update-response',
      { requestId },
    );
    postToParent({
      type: 'second:data:update',
      collection: collectionRef.current,
      docId,
      data: updateData,
      requestId,
    });
    const response = await responsePromise;
    if (response.doc) {
      setData(prev => prev.map(doc => doc._id === docId ? response.doc : doc));
    }
    return response.doc;
  }, []);

  const remove = useCallback(async (docId: string): Promise<void> => {
    const requestId = nextRequestId();
    const responsePromise = waitForResponse<{ docId: string }>(
      'second:data:delete-response',
      { requestId },
    );
    postToParent({
      type: 'second:data:delete',
      collection: collectionRef.current,
      docId,
      requestId,
    });
    await responsePromise;
    setData(prev => prev.filter(doc => doc._id !== docId));
  }, []);

  return { data, loading, insert, update, remove };
}

export function useDoc(collectionName: string, docId: string | null): UseDocReturn {
  const [data, setData] = useState<Doc | null>(null);
  const [loading, setLoading] = useState(true);
  const collectionRef = useRef(collectionName);
  const docIdRef = useRef(docId);
  collectionRef.current = collectionName;
  docIdRef.current = docId;

  useEffect(() => {
    if (!docId) {
      setData(null);
      setLoading(false);
      return;
    }

    const requestId = nextRequestId();
    setLoading(true);

    const handler = (event: MessageEvent) => {
      const d = event.data;
      if (
        d?.source === 'second-platform' &&
        d.type === 'second:data:doc-response' &&
        d.requestId === requestId
      ) {
        window.removeEventListener('message', handler);
        setData(d.doc ?? null);
        setLoading(false);
      }
    };
    window.addEventListener('message', handler);
    postToParent({ type: 'second:data:doc', collection: collectionName, docId, requestId });

    return () => window.removeEventListener('message', handler);
  }, [collectionName, docId]);

  // Live change events
  useEffect(() => {
    const handler = (event: MessageEvent) => {
      const d = event.data;
      if (d?.source !== 'second-platform') return;
      if (d.type !== 'second:data:change') return;
      if (d.collection !== collectionRef.current && d.collection !== '__any__') return;

      if (d.operation === 'update' && d.doc && d.doc._id === docIdRef.current) {
        setData(d.doc);
      } else if (d.operation === 'delete' && d.docId === docIdRef.current) {
        setData(null);
      }
    };
    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
  }, []);

  const update = useCallback(async (updateData: Record<string, unknown>): Promise<Doc> => {
    const requestId = nextRequestId();
    const responsePromise = waitForResponse<{ doc: Doc }>(
      'second:data:update-response',
      { requestId },
    );
    postToParent({
      type: 'second:data:update',
      collection: collectionRef.current,
      docId: docIdRef.current,
      data: updateData,
      requestId,
    });
    const response = await responsePromise;
    setData(response.doc);
    return response.doc;
  }, []);

  const remove = useCallback(async (): Promise<void> => {
    const requestId = nextRequestId();
    const responsePromise = waitForResponse<{ docId: string }>(
      'second:data:delete-response',
      { requestId },
    );
    postToParent({
      type: 'second:data:delete',
      collection: collectionRef.current,
      docId: docIdRef.current,
      requestId,
    });
    await responsePromise;
    setData(null);
  }, []);

  return { data, loading, update, remove };
}

// ---------------------------------------------------------------------------
// Integration actions — callIntegrationTool / useIntegrationTool
// ---------------------------------------------------------------------------

export async function callIntegrationTool<
  TInput extends Record<string, unknown> = Record<string, unknown>,
  TData = unknown,
>(
  toolName: string,
  input: TInput,
): Promise<IntegrationToolResult<TData>> {
  const requestId = nextRequestId();
  const responsePromise = waitForResponse<
    IntegrationToolResult<TData> & { requestId: string; toolName: string }
  >('second:integration:execute-response', { requestId }, 35_000);

  postToParent({
    type: 'second:integration:execute',
    requestId,
    toolName,
    input,
  });

  try {
    const response = await responsePromise;
    return {
      success: Boolean(response.success),
      data: response.data,
      mock: Boolean(response.mock),
      mockReason: response.mockReason,
      statusCode: response.statusCode,
      error: response.error,
      errorCode: response.errorCode,
      errorCategory: response.errorCategory,
      resolution: response.resolution,
      retryable: response.retryable,
      canRequestBuilderRepair: response.canRequestBuilderRepair,
      details: response.details,
    };
  } catch (err) {
    return {
      success: false,
      mock: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export function formatIntegrationToolError(
  result: Pick<
    IntegrationToolResult,
    'error' | 'statusCode' | 'resolution' | 'retryable'
  >,
  fallback = 'Integration request failed',
): string {
  const parts = [result.error ?? fallback];
  if (result.resolution) parts.push(result.resolution);
  if (result.retryable) parts.push('This request can be retried.');
  if (result.statusCode && !parts[0]?.includes(String(result.statusCode))) {
    parts.push(\`HTTP \${result.statusCode}\`);
  }
  return parts.filter(Boolean).join(' ');
}

export async function reportIntegrationToolFailure<
  TInput extends Record<string, unknown> = Record<string, unknown>,
  TData = unknown,
>(
  toolName: string,
  input: TInput,
  result: IntegrationToolResult<TData>,
  description: string,
  attemptedTask?: string,
): Promise<IntegrationToolFailureReportResult> {
  const requestId = nextRequestId();
  const responsePromise = waitForResponse<
    IntegrationToolFailureReportResult & { requestId: string; toolName: string }
  >('second:integration:report-failure-response', { requestId }, 15_000);

  postToParent({
    type: 'second:integration:report-failure',
    requestId,
    toolName,
    input,
    result,
    description,
    attemptedTask,
  });

  try {
    const response = await responsePromise;
    return {
      ok: Boolean(response.ok),
      status: response.status,
      builderRunId: response.builderRunId,
      appendedToExisting: response.appendedToExisting,
      error: response.error,
    };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export function useIntegrationTool<
  TInput extends Record<string, unknown> = Record<string, unknown>,
  TData = unknown,
>(toolName: string): UseIntegrationToolReturn<TInput, TData> {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const execute = useCallback(async (input: TInput) => {
    setLoading(true);
    setError(null);
    try {
      const result = await callIntegrationTool<TInput, TData>(toolName, input);
      if (!result.success) {
        setError(formatIntegrationToolError(result));
      }
      return result;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setError(message);
      return {
        success: false,
        mock: false,
        error: message,
      } satisfies IntegrationToolResult<TData>;
    } finally {
      setLoading(false);
    }
  }, [toolName]);

  return { execute, loading, error };
}

// ---------------------------------------------------------------------------
// Agent hooks — useAgent / useAgentList
// ---------------------------------------------------------------------------

export function useAgent(agentId: string): UseAgentReturn {
  const [state, setState] = useState<AgentState>({
    status: 'idle',
    error: null,
    runId: null,
  });

  useEffect(() => {
    const handler = (event: MessageEvent) => {
      const data = event.data;
      if (data?.source !== 'second-platform') return;

      if (data.type === 'second:agent:update' && data.agentId === agentId) {
        setState(prev => {
          if (prev.runId !== data.runId) return prev;
          return {
            ...prev,
            status: data.status,
            error: data.error ?? prev.error,
          };
        });
      }
    };

    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
  }, [agentId]);

  const trigger = useCallback(async (prompt: string): Promise<string> => {
    return new Promise((resolve) => {
      const requestId = crypto.randomUUID();

      const ackHandler = (event: MessageEvent) => {
        const data = event.data;
        if (
          data?.source === 'second-platform' &&
          data.type === 'second:agent:triggered' &&
          data.requestId === requestId
        ) {
          window.removeEventListener('message', ackHandler);
          setState({
            status: 'running',
            error: null,
            runId: data.runId,
          });
          resolve(data.runId);
        }
      };

      window.addEventListener('message', ackHandler);

      window.parent.postMessage({
        source: 'second-app',
        type: 'second:agent:trigger',
        requestId,
        agentId,
        prompt,
      }, '*');
    });
  }, [agentId]);

  return {
    trigger,
    status: state.status,
    error: state.error,
    isRunning: state.status === 'running',
    runId: state.runId,
  };
}

export function useAgentList(): { agents: Array<{ id: string; name: string; description: string }> } {
  const [agents, setAgents] = useState<Array<{ id: string; name: string; description: string }>>([]);

  useEffect(() => {
    const handler = (event: MessageEvent) => {
      const data = event.data;
      if (data?.source === 'second-platform' && data.type === 'second:agents:list') {
        setAgents(data.agents);
      }
    };
    window.addEventListener('message', handler);
    window.parent.postMessage({ source: 'second-app', type: 'second:agents:list-request' }, '*');
    return () => window.removeEventListener('message', handler);
  }, []);

  return { agents };
}
`,
};
