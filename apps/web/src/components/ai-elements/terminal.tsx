"use client";

import { memo, useState } from "react";
import {
  CheckIcon,
  CopyIcon,
} from "lucide-react";
import { AppLoader } from "@/components/app-loader";
import { cn } from "@/lib/utils";

type TerminalProps = {
  command?: string;
  output?: string | null;
  isRunning?: boolean;
};

export const Terminal = memo(function Terminal({
  command,
  output,
  isRunning,
}: TerminalProps) {
  const [copied, setCopied] = useState(false);

  return (
    <div
      className="not-prose overflow-hidden rounded-2xl bg-[var(--composer-bg)] text-[13px] font-mono"
      style={{ boxShadow: "var(--composer-shadow)" }}
    >
      {/* Traffic lights + copy */}
      <div className="flex items-center justify-between px-4 pt-3 pb-0">
        <div className="flex items-center gap-1.5">
          <div className="size-2.5 rounded-full bg-[#ff5f57]" />
          <div className="size-2.5 rounded-full bg-[#febc2e]" />
          <div className="size-2.5 rounded-full bg-[#28c840]" />
        </div>
        <div className="ml-auto flex items-center gap-2">
          {!isRunning && command && (
            <span className="flex items-center gap-1 text-xs text-emerald-600 dark:text-emerald-400">
              <CheckIcon className="size-3" />
            </span>
          )}
          {isRunning && (
            <AppLoader size="xs" />
          )}
          {command && !isRunning && (
            <button
            type="button"
            className={cn(
              "flex items-center gap-1 rounded-md px-2 py-1 text-xs transition-colors",
              copied
                ? "text-green-600 dark:text-green-400"
                : "text-zinc-400 dark:text-zinc-500 hover:text-zinc-600 dark:hover:text-zinc-300",
            )}
            onClick={() => {
              navigator.clipboard.writeText(command);
              setCopied(true);
              setTimeout(() => setCopied(false), 2000);
            }}
          >
            {copied ? (
              <CheckIcon className="size-3" />
            ) : (
              <CopyIcon className="size-3" />
            )}
          </button>
          )}
        </div>
      </div>

      {/* Body */}
      <div className="px-4 py-3">
        {/* Command */}
        {command && (
          <div className="break-words text-emerald-700 dark:text-green-400">
            <span className="select-none text-zinc-400 dark:text-zinc-600">$ </span>
            {command}
          </div>
        )}

        {/* Output */}
        {output && (
          <pre className="mt-1.5 max-h-48 overflow-y-auto text-zinc-600 dark:text-zinc-400 whitespace-pre-wrap break-words leading-relaxed">
            {output}
          </pre>
        )}

        {/* Running with no output yet */}
        {isRunning && !output && !command && (
          <div className="text-zinc-400 dark:text-zinc-500">Running...</div>
        )}
      </div>
    </div>
  );
});
