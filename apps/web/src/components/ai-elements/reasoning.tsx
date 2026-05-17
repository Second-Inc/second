"use client";

import type { ComponentProps } from "react";
import {
  createContext,
  memo,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { BrainIcon, ChevronDownIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------

type ReasoningContextValue = {
  isOpen: boolean;
  setIsOpen: (open: boolean) => void;
  label: string;
};

const ReasoningContext = createContext<ReasoningContextValue | null>(null);

function useReasoningContext() {
  const ctx = useContext(ReasoningContext);
  if (!ctx) throw new Error("Reasoning.* must be used within <Reasoning>");
  return ctx;
}

// ---------------------------------------------------------------------------
// Text cleanup
// ---------------------------------------------------------------------------

function reasoningText(text: string): string {
  return text.replace(/\*\*([^*\n]+)\*\*/g, "$1");
}


// ---------------------------------------------------------------------------
// Root
// ---------------------------------------------------------------------------

export type ReasoningProps = ComponentProps<typeof Collapsible> & {
  done?: boolean;
  storageKey?: string;
};

const AUTO_COLLAPSE_DELAY_MS = 1000;
const reasoningUserOpenState = new Map<string, boolean>();

export const Reasoning = memo(function Reasoning({
  className,
  done = false,
  storageKey,
  children,
  ...props
}: ReasoningProps) {
  const [isOpen, setIsOpenState] = useState(() => {
    if (storageKey && reasoningUserOpenState.has(storageKey)) {
      return reasoningUserOpenState.get(storageKey) ?? !done;
    }
    return !done;
  });
  const userInteractedRef = useRef(
    storageKey ? reasoningUserOpenState.has(storageKey) : false,
  );
  const previousDoneRef = useRef(done);

  const label = done ? "Done reasoning" : "Reasoning\u2026";

  const setIsOpen = useCallback(
    (next: boolean) => {
      setIsOpenState(next);
    },
    [],
  );

  const handleOpenChange = useCallback(
    (next: boolean) => {
      userInteractedRef.current = true;
      if (storageKey) reasoningUserOpenState.set(storageKey, next);
      setIsOpen(next);
    },
    [setIsOpen, storageKey],
  );

  useEffect(() => {
    if (!done) {
      previousDoneRef.current = false;
      return;
    }

    if (previousDoneRef.current || userInteractedRef.current) {
      previousDoneRef.current = true;
      return;
    }

    previousDoneRef.current = true;
    const timeout = window.setTimeout(() => {
      if (!userInteractedRef.current) setIsOpen(false);
    }, AUTO_COLLAPSE_DELAY_MS);

    return () => window.clearTimeout(timeout);
  }, [done, setIsOpen]);

  const contextValue = useMemo(
    () => ({ isOpen, setIsOpen, label }),
    [isOpen, label, setIsOpen],
  );

  return (
    <ReasoningContext.Provider value={contextValue}>
      <Collapsible
        className={cn("not-prose", className)}
        onOpenChange={handleOpenChange}
        open={isOpen}
        {...props}
      >
        {children}
      </Collapsible>
    </ReasoningContext.Provider>
  );
});

// ---------------------------------------------------------------------------
// Trigger
// ---------------------------------------------------------------------------

export const ReasoningTrigger = memo(function ReasoningTrigger({
  className,
  children,
  ...props
}: ComponentProps<typeof CollapsibleTrigger>) {
  const { isOpen, label } = useReasoningContext();

  return (
    <CollapsibleTrigger
      className={cn(
        "flex w-full items-center gap-2 text-sm text-muted-foreground transition-colors hover:text-foreground",
        className,
      )}
      {...props}
    >
      {children ?? (
        <>
          <BrainIcon className="size-4" />
          <span>{label}</span>
          <ChevronDownIcon
            className={cn(
              "size-4 transition-transform",
              isOpen ? "rotate-180" : "rotate-0",
            )}
          />
        </>
      )}
    </CollapsibleTrigger>
  );
});

// ---------------------------------------------------------------------------
// Content
// ---------------------------------------------------------------------------

const SCROLLBAR_CSS = `.reasoning-scroll{overflow-y:auto;scrollbar-width:thin;scrollbar-color:hsl(var(--border)) transparent}.reasoning-scroll::-webkit-scrollbar{-webkit-appearance:none;width:5px}.reasoning-scroll::-webkit-scrollbar-thumb{background:hsl(var(--border));border-radius:3px}.reasoning-scroll::-webkit-scrollbar-track{background:transparent}`;
const COLLAPSIBLE_ANIMATION_CSS = `.reasoning-content{overflow:hidden;will-change:height,opacity}.reasoning-content[data-state=open]{animation:reasoning-slide-down 180ms cubic-bezier(.16,1,.3,1)}.reasoning-content[data-state=closed]{animation:reasoning-slide-up 160ms cubic-bezier(.7,0,.84,0)}@keyframes reasoning-slide-down{from{height:0;opacity:0}to{height:var(--radix-collapsible-content-height);opacity:1}}@keyframes reasoning-slide-up{from{height:var(--radix-collapsible-content-height);opacity:1}to{height:0;opacity:0}}`;
let scrollbarStyleInjected = false;
let animationStyleInjected = false;

export const ReasoningContent = memo(function ReasoningContent({
  className,
  children,
  ...props
}: ComponentProps<typeof CollapsibleContent> & { children: string }) {
  const { isOpen } = useReasoningContext();
  const scrollRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    if (!scrollbarStyleInjected) {
      const s = document.createElement("style");
      s.textContent = SCROLLBAR_CSS;
      document.head.appendChild(s);
      scrollbarStyleInjected = true;
    }
    if (!animationStyleInjected) {
      const s = document.createElement("style");
      s.textContent = COLLAPSIBLE_ANIMATION_CSS;
      document.head.appendChild(s);
      animationStyleInjected = true;
    }
  }, []);

  useLayoutEffect(() => {
    if (!isOpen) return;
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  }, [children, isOpen]);

  return (
    <CollapsibleContent className={cn("reasoning-content", className)} {...props}>
      <div className="relative pt-3">
        <div
          ref={scrollRef}
          className="reasoning-scroll max-h-44 scroll-smooth"
        >
          <p className="text-sm text-muted-foreground/60 leading-relaxed whitespace-pre-wrap pb-6">
            {reasoningText(children)}
          </p>
        </div>
        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-6 bg-gradient-to-t from-background to-transparent" />
      </div>
    </CollapsibleContent>
  );
});
