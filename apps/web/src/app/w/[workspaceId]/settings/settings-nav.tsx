"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  BlocksIcon,
  Code2Icon,
  GitBranchIcon,
  // LifeBuoyIcon,
  PlugIcon,
  ShieldIcon,
  UserRoundCogIcon,
  UsersRoundIcon,
} from "lucide-react";
import { announceNavigationIntentFromClick } from "@/lib/navigation-intent";
import { cn } from "@/lib/utils";

type SettingsNavProps = {
  workspaceId: string;
};

const NAV_SECTIONS = [
  {
    label: "Access",
    items: [
      { href: "members", label: "Members", icon: UsersRoundIcon },
      { href: "teams", label: "Teams", icon: UserRoundCogIcon },
    ],
  },
  {
    label: "Workspace",
    items: [
      { href: "integrations", label: "Integrations", icon: BlocksIcon },
      { href: "source-control", label: "Source Control", icon: GitBranchIcon },
      { href: "connected-apps", label: "Connected Apps", icon: PlugIcon },
    ],
  },
  {
    label: "Governance",
    items: [
      { href: "audit-logs", label: "Audit logs", icon: ShieldIcon },
    ],
  },
  {
    label: "Security",
    items: [
      { href: "runtime-settings", label: "Runtime settings", icon: Code2Icon },
      // { href: "diagnostics", label: "Diagnostics", icon: LifeBuoyIcon },
    ],
  },
];

export function SettingsNav({ workspaceId }: SettingsNavProps) {
  const pathname = usePathname();

  return (
    <nav
      data-second-desktop-drag-region
      className="flex w-56 shrink-0 flex-col border-r border-border px-3 py-6"
    >
      <h2 className="mb-5 px-3 text-xs font-semibold">
        Workspace Settings
      </h2>
      <div className="flex flex-col gap-5">
        {NAV_SECTIONS.map((section) => (
          <div key={section.label} className="flex flex-col gap-0.5">
            <span className="mb-1 px-3 text-[11px] font-medium uppercase tracking-wider text-muted-foreground/60">
              {section.label}
            </span>
            {section.items.map((item) => {
              const href = `/w/${workspaceId}/settings/${item.href}`;
              const active = pathname === href || pathname.startsWith(`${href}/`);
              const Icon = item.icon;
              const disabled = "disabled" in item && item.disabled;

              if (disabled) {
                return (
                  <span
                    key={item.href}
                    className="flex cursor-not-allowed items-center gap-2.5 rounded-md px-3 py-1.5 text-xs text-muted-foreground/40 [&_svg]:size-4 [&_svg]:shrink-0"
                  >
                    <Icon />
                    {item.label}
                  </span>
                );
              }

              return (
                <Link
                  key={item.href}
                  href={href}
                  onClick={announceNavigationIntentFromClick}
                  className={cn(
                    "flex items-center gap-2.5 rounded-md px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground [&_svg]:size-4 [&_svg]:shrink-0",
                    active && "bg-muted font-medium text-foreground",
                  )}
                >
                  <Icon />
                  {item.label}
                </Link>
              );
            })}
          </div>
        ))}
      </div>
    </nav>
  );
}
