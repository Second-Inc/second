"use client";

import { memo, useState, type ComponentProps } from "react";
import { highlight } from "sugar-high";
import {
  CheckIcon,
  CopyIcon,
  FileCodeIcon,
  FileJsonIcon,
  FileTextIcon,
  SquareTerminalIcon,
  GlobeIcon,
  BracesIcon,
  HashIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Language icon mapping
// ---------------------------------------------------------------------------

const LANG_ICONS: Record<string, React.ElementType> = {
  bash: SquareTerminalIcon,
  sh: SquareTerminalIcon,
  shell: SquareTerminalIcon,
  zsh: SquareTerminalIcon,
  json: FileJsonIcon,
  jsonc: FileJsonIcon,
  html: GlobeIcon,
  css: HashIcon,
  scss: HashIcon,
  md: FileTextIcon,
  markdown: FileTextIcon,
  yaml: FileTextIcon,
  yml: FileTextIcon,
  toml: FileTextIcon,
  ts: BracesIcon,
  tsx: BracesIcon,
  typescript: BracesIcon,
  js: BracesIcon,
  jsx: BracesIcon,
  javascript: BracesIcon,
};

function LangIcon({ lang }: { lang: string }) {
  const Icon = LANG_ICONS[lang.toLowerCase()] ?? FileCodeIcon;
  return <Icon className="size-3.5" />;
}

// ---------------------------------------------------------------------------
// Code block
// ---------------------------------------------------------------------------

/**
 * Drop-in replacement for the default `code` element rendered by
 * react-markdown. Fenced blocks get syntax highlighting + copy button;
 * inline code stays plain.
 */
export const CodeBlock = memo(function CodeBlock({
  children,
  className,
  ...props
}: ComponentProps<"code">) {
  const lang = className?.replace("language-", "") ?? "";
  const code = String(children).replace(/\n$/, "");

  // Inline code — no language class, render plain
  if (!className) {
    return (
      <code
        className="rounded-md bg-[#EBEBEB] dark:bg-white/[0.08] px-1.5 py-0.5 text-[13px] font-mono font-normal text-foreground/70 dark:text-white/70"
        {...props}
      >
        {children}
      </code>
    );
  }

  // Fenced code block — uses --sh-* CSS vars from globals.css (light/dark)
  return (
    <div
      className="not-prose group relative my-3 overflow-hidden rounded-2xl bg-[var(--composer-bg)]"
      style={{ boxShadow: "var(--composer-shadow)" }}
    >
      <div className="flex items-center justify-between border-b border-border px-4 py-3 text-xs text-muted-foreground">
        <div className="flex items-center gap-1.5 font-medium">
          <LangIcon lang={lang} />
          <span>{lang}</span>
        </div>
        <CopyButton text={code} />
      </div>
      <pre className="overflow-x-auto px-4 py-4 text-[13px] leading-relaxed">
        <code
          className="font-mono"
          dangerouslySetInnerHTML={{ __html: highlight(code) }}
        />
      </pre>
    </div>
  );
});

// ---------------------------------------------------------------------------
// Copy button
// ---------------------------------------------------------------------------

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);

  return (
    <button
      type="button"
      className={cn(
        "flex items-center gap-1 rounded-md px-2 py-1 text-xs transition-colors",
        copied
          ? "text-green-600 dark:text-green-400"
          : "text-muted-foreground hover:text-foreground hover:bg-muted/50",
      )}
      onClick={() => {
        navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      }}
    >
      {copied ? (
        <>
          <CheckIcon className="size-3" />
          Copied
        </>
      ) : (
        <>
          <CopyIcon className="size-3" />
          Copy
        </>
      )}
    </button>
  );
}
