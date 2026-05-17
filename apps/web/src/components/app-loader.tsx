"use client";

import { type CSSProperties, useEffect, useState } from "react";
import { CheckIcon, ChevronDownIcon } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useLoaderPreferences } from "@/components/loader-preferences-provider";
import { cn } from "@/lib/utils";
import type {
  LoaderColorId,
  LoaderStyleId,
  UserPreferences,
} from "@/lib/user-preferences";

type LoaderColorMeta = {
  id: LoaderColorId;
  label: string;
  accent: string;
  border: string;
};

type LoaderStyleMeta = {
  id: LoaderStyleId;
  label: string;
  category: "Shapes";
  description: string;
};

export const LOADER_COLORS: LoaderColorMeta[] = [
  {
    id: "mono",
    label: "Mono",
    accent: "var(--muted-foreground)",
    border: "color-mix(in oklab, var(--foreground) 16%, transparent)",
  },
  {
    id: "blue",
    label: "Blue",
    accent: "oklch(0.64 0.18 250)",
    border: "oklch(0.64 0.18 250 / 0.28)",
  },
  {
    id: "violet",
    label: "Violet",
    accent: "oklch(0.66 0.19 300)",
    border: "oklch(0.66 0.19 300 / 0.28)",
  },
  {
    id: "emerald",
    label: "Emerald",
    accent: "oklch(0.67 0.16 155)",
    border: "oklch(0.67 0.16 155 / 0.28)",
  },
  {
    id: "amber",
    label: "Amber",
    accent: "oklch(0.76 0.16 80)",
    border: "oklch(0.76 0.16 80 / 0.3)",
  },
  {
    id: "rose",
    label: "Rose",
    accent: "oklch(0.66 0.19 20)",
    border: "oklch(0.66 0.19 20 / 0.28)",
  },
  {
    id: "custom",
    label: "Custom",
    accent: "var(--second-loader-custom-color)",
    border: "color-mix(in oklab, var(--second-loader-custom-color) 34%, transparent)",
  },
];

export const LOADER_STYLES: LoaderStyleMeta[] = [
  {
    id: "orbit",
    label: "Cascade",
    category: "Shapes",
    description: "Diagonal sweep",
  },
  {
    id: "pulse",
    label: "Bloom",
    category: "Shapes",
    description: "Center outward",
  },
  {
    id: "wave",
    label: "Rain",
    category: "Shapes",
    description: "Falling columns",
  },
  {
    id: "pixel-cat",
    label: "Pinwheel",
    category: "Shapes",
    description: "Rotating arms",
  },
  {
    id: "pixel-dog",
    label: "Heartbeat",
    category: "Shapes",
    description: "Rhythmic pulse",
  },
  {
    id: "blocks",
    label: "Random",
    category: "Shapes",
    description: "Shuffled every cycle",
  },
];

const SIZE_CLASS = {
  xs: "size-4",
  sm: "size-5",
  md: "size-6",
  lg: "size-8",
  xl: "size-12",
} as const;

const TRIGGER_SIZE_CLASS = {
  xs: "size-6",
  sm: "size-7",
  md: "size-8",
  lg: "size-10",
  xl: "size-16",
} as const;

type AppLoaderProps = {
  size?: keyof typeof SIZE_CLASS;
  interactive?: boolean;
  className?: string;
  label?: string;
  onOpenChange?: (open: boolean) => void;
};

export function loaderColorMeta(color: LoaderColorId): LoaderColorMeta {
  return LOADER_COLORS.find((option) => option.id === color) ?? LOADER_COLORS[0];
}

export function loaderStyleMeta(style: LoaderStyleId): LoaderStyleMeta {
  return LOADER_STYLES.find((option) => option.id === style) ?? LOADER_STYLES[0];
}

function loaderAccent(preferences: UserPreferences): string {
  return preferences.loaderColor === "custom"
    ? preferences.loaderCustomColor
    : loaderColorMeta(preferences.loaderColor).accent;
}

/* ── Shared 3×3 grid ───────────────────────────────────────────────── */

const GRID = [
  [3, 3], [8, 3], [13, 3],
  [3, 8], [8, 8], [13, 8],
  [3, 13], [8, 13], [13, 13],
] as const;

function GridLoader({
  size = "sm",
  delays,
  interval = 100,
}: {
  size?: keyof typeof SIZE_CLASS;
  delays: readonly number[];
  interval?: number;
}) {
  return (
    <svg
      viewBox="0 0 16 16"
      aria-hidden="true"
      className={cn("second-loader-glyph shrink-0", SIZE_CLASS[size])}
    >
      {GRID.map(([cx, cy], index) => (
        <rect
          key={`${cx}-${cy}`}
          className="second-loader-dot"
          x={cx - 1.5}
          y={cy - 1.5}
          width={3}
          height={3}
          rx={0.8}
          style={{ animationDelay: `${delays[index] * interval}ms` }}
        />
      ))}
    </svg>
  );
}

/* Cascade — diagonal sweep, top-left → bottom-right */
const CASCADE_DELAYS =  [0, 1, 2, 1, 2, 3, 2, 3, 4] as const;

/* Random — shuffled each cycle */
function shuffle(): number[] {
  const arr = [0, 1, 2, 3, 4, 5, 6, 7, 8];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

const ANIM_CYCLE_MS = 1400;

function RandomGridLoader({ size = "sm" }: { size?: keyof typeof SIZE_CLASS }) {
  const [delays, setDelays] = useState(shuffle);

  useEffect(() => {
    const interval = 100;
    const maxDelay = 8;
    const timer = window.setInterval(() => {
      setDelays(shuffle());
    }, ANIM_CYCLE_MS + maxDelay * interval);
    return () => window.clearInterval(timer);
  }, []);

  return <GridLoader size={size} delays={delays} interval={100} />;
}

/* Bloom — radiates outward from center */
const BLOOM_DELAYS =    [2, 1, 2, 1, 0, 1, 2, 1, 2] as const;

/* Rain — columns fall left to right */
const RAIN_DELAYS =     [0, 2, 4, 1, 3, 5, 2, 4, 6] as const;

/* Pinwheel — rotating arms around center */
const PINWHEEL_DELAYS = [0, 3, 6, 1, 4, 7, 2, 5, 8] as const;

/* Heartbeat — center pulses, edges follow in waves */
const HEARTBEAT_DELAYS = [1, 2, 1, 2, 0, 2, 1, 2, 1] as const;

function LoaderGlyph({
  size = "sm",
  styleId,
}: {
  size?: keyof typeof SIZE_CLASS;
  styleId: LoaderStyleId;
}) {
  if (styleId === "blocks") return <RandomGridLoader size={size} />;
  if (styleId === "pulse") return <GridLoader size={size} delays={BLOOM_DELAYS} interval={150} />;
  if (styleId === "wave") return <GridLoader size={size} delays={RAIN_DELAYS} interval={90} />;
  if (styleId === "pixel-cat") return <GridLoader size={size} delays={PINWHEEL_DELAYS} interval={85} />;
  if (styleId === "pixel-dog") return <GridLoader size={size} delays={HEARTBEAT_DELAYS} interval={140} />;
  return <GridLoader size={size} delays={CASCADE_DELAYS} interval={105} />;
}

function loaderStyle(preferences: UserPreferences): CSSProperties {
  const current = loaderColorMeta(preferences.loaderColor);

  return {
    "--second-loader-accent": loaderAccent(preferences),
    "--second-loader-border": current.border,
    "--second-loader-custom-color": preferences.loaderCustomColor,
  } as CSSProperties;
}

function PickerPreview({
  option,
  active,
  onSelect,
}: {
  option: LoaderStyleMeta;
  active: boolean;
  onSelect: () => void;
}) {
  const { preferences } = useLoaderPreferences();

  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        "loader-style-item flex w-full items-center gap-2.5 rounded-md px-2 py-1 text-left text-xs transition-all",
        active ? "bg-accent" : "hover:bg-accent/50",
      )}
      style={loaderStyle(preferences)}
    >
      <span className="flex size-6 shrink-0 items-center justify-center">
        <LoaderGlyph size="sm" styleId={option.id} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="font-medium">{option.label}</span>
      </span>
      {active && <CheckIcon className="size-3.5 shrink-0 text-foreground/50" />}
    </button>
  );
}

function ColorButton({
  option,
  active,
  onSelect,
}: {
  option: LoaderColorMeta;
  active: boolean;
  onSelect: () => void;
}) {
  const { preferences } = useLoaderPreferences();
  const accent =
    option.id === "custom" ? preferences.loaderCustomColor : option.accent;

  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        "flex w-full items-center gap-2.5 rounded-md px-2 py-1 text-left text-xs transition-colors",
        active ? "bg-accent" : "hover:bg-accent/50",
      )}
    >
      <span
        className="size-3 shrink-0 rounded-full ring-1 ring-black/10 dark:ring-white/15"
        style={{ background: accent }}
      />
      <span className="min-w-0 flex-1 truncate">{option.label}</span>
      {active && <CheckIcon className="size-3.5 shrink-0 text-foreground/50" />}
    </button>
  );
}

export function LoaderPickerContent() {
  const {
    preferences,
    setLoaderColor,
    setLoaderCustomColor,
    setLoaderStyle,
  } = useLoaderPreferences();

  return (
    <div className="flex flex-col py-1">
      <p className="px-3 pb-0.5 pt-1 text-[11px] font-medium text-muted-foreground">
        Style
      </p>
      <div className="loader-style-list flex flex-col px-1">
        {LOADER_STYLES.map((option) => (
          <PickerPreview
            key={option.id}
            option={option}
            active={preferences.loaderStyle === option.id}
            onSelect={() => setLoaderStyle(option.id)}
          />
        ))}
      </div>

      <div className="mx-3 my-1.5 border-t border-border/60" />

      <p className="px-3 pb-0.5 pt-0.5 text-[11px] font-medium text-muted-foreground">
        Color
      </p>
      <div className="flex flex-col px-1">
        {LOADER_COLORS.filter((o) => o.id !== "custom").map((option) => (
          <ColorButton
            key={option.id}
            option={option}
            active={preferences.loaderColor === option.id}
            onSelect={() => setLoaderColor(option.id)}
          />
        ))}
      </div>

      <div className="mx-3 my-1.5 border-t border-border/60" />

      <div
        className="px-1"
        onKeyDown={(event) => event.stopPropagation()}
      >
        <label className="flex w-full cursor-pointer items-center gap-2.5 rounded-md px-2 py-1 text-xs transition-colors hover:bg-accent/50">
          <input
            aria-label="Custom loader color"
            type="color"
            value={preferences.loaderCustomColor}
            onChange={(event) => {
              setLoaderCustomColor(event.target.value);
              setLoaderColor("custom");
            }}
            className="size-3 shrink-0 cursor-pointer appearance-none rounded-full border-0 bg-transparent p-0 [&::-webkit-color-swatch-wrapper]:p-0 [&::-webkit-color-swatch]:rounded-full [&::-webkit-color-swatch]:border-0 [&::-moz-color-swatch]:rounded-full [&::-moz-color-swatch]:border-0"
          />
          <span className="min-w-0 flex-1">Custom</span>
          {preferences.loaderColor === "custom" && (
            <CheckIcon className="size-3.5 shrink-0 text-foreground/50" />
          )}
        </label>
      </div>
    </div>
  );
}

export function AppLoader({
  size = "sm",
  interactive = true,
  className,
  label = "Loading",
  onOpenChange,
}: AppLoaderProps) {
  const { preferences } = useLoaderPreferences();
  const style = loaderStyle(preferences);

  if (!interactive) {
    return (
      <span
        className={cn("inline-flex items-center justify-center", className)}
        style={style}
        aria-label={label}
        role="status"
      >
        <LoaderGlyph size={size} styleId={preferences.loaderStyle} />
      </span>
    );
  }

  return (
    <DropdownMenu onOpenChange={onOpenChange}>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className={cn(
            "group/loader relative inline-flex shrink-0 items-center justify-center rounded-lg border border-transparent text-muted-foreground outline-none transition-colors hover:border-[color:var(--second-loader-border)] hover:bg-muted/40 focus-visible:border-[color:var(--second-loader-border)] focus-visible:bg-muted/40 focus-visible:ring-2 focus-visible:ring-ring/25",
            TRIGGER_SIZE_CLASS[size],
            className,
          )}
          style={style}
          aria-label="Customize loader"
        >
          <LoaderGlyph size={size} styleId={preferences.loaderStyle} />
          <ChevronDownIcon className="pointer-events-none absolute -right-0.5 -top-0.5 size-3 rounded-sm bg-background/80 text-muted-foreground opacity-0 shadow-sm transition-opacity group-hover/loader:opacity-100 group-data-[state=open]/loader:opacity-100" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" side="bottom" className="w-48">
        <LoaderPickerContent />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function LoaderColorRadioGroup() {
  const { preferences, setLoaderColor } = useLoaderPreferences();

  return (
    <div className="flex flex-col px-1">
      {LOADER_COLORS.map((option) => (
        <ColorButton
          key={option.id}
          option={option}
          active={preferences.loaderColor === option.id}
          onSelect={() => setLoaderColor(option.id)}
        />
      ))}
    </div>
  );
}
