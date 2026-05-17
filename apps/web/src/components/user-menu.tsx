"use client";

import {
  BarChart3Icon,
  LogOutIcon,
  MonitorIcon,
  MoonIcon,
  PaletteIcon,
  SunIcon,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@/components/ui/sidebar";
import {
  AppLoader,
  LoaderPickerContent,
} from "@/components/app-loader";
import { useThemePreference } from "@/components/loader-preferences-provider";
import {
  captureAnalyticsEvent,
  openAnalyticsSettingsDialog,
  resetAnalyticsAnonymousId,
} from "@/lib/analytics";
import type { ThemeMode } from "@/lib/user-preferences";

type UserMenuProps = {
  user: { displayName: string };
  workspaceId: string;
};

const THEME_OPTIONS: Array<{
  value: ThemeMode;
  label: string;
}> = [
  { value: "system", label: "System" },
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
];

function ThemeModeIcon({ mode }: { mode: ThemeMode }) {
  switch (mode) {
    case "light":
      return <SunIcon />;
    case "dark":
      return <MoonIcon />;
    default:
      return <MonitorIcon />;
  }
}

export function UserMenu({ user, workspaceId }: UserMenuProps) {
  const { isMobile } = useSidebar();
  const { preferences, setThemeMode } = useThemePreference();
  const currentTheme =
    THEME_OPTIONS.find((option) => option.value === preferences.themeMode) ??
    THEME_OPTIONS[0];

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <SidebarMenuButton
              size="lg"
              className="px-1 data-open:bg-sidebar-accent data-open:text-sidebar-accent-foreground"
              onClick={() => {
                captureAnalyticsEvent("sidebar clicked", {
                  workspace_id: workspaceId,
                  target: "profile",
                });
              }}
            >
              <div className="flex size-6 shrink-0 items-center justify-center rounded-full bg-sidebar-accent text-[0.625rem] font-semibold text-sidebar-accent-foreground">
                {user.displayName.charAt(0).toUpperCase()}
              </div>
              <div className="grid flex-1 text-left text-xs leading-tight">
                <span className="truncate font-medium">{user.displayName}</span>
              </div>
            </SidebarMenuButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            className="w-[--radix-dropdown-menu-trigger-width] min-w-56"
            align="start"
            alignOffset={isMobile ? 0 : -6}
            collisionPadding={12}
            side={isMobile ? "bottom" : "right"}
            sideOffset={isMobile ? 4 : 6}
          >
            <DropdownMenuLabel>Account</DropdownMenuLabel>

            <DropdownMenuSub>
              <DropdownMenuSubTrigger className="[&>svg:last-child]:ml-1">
                <ThemeModeIcon mode={currentTheme.value} />
                <span>Theme</span>
                <span className="ml-auto mr-4 text-[11px] text-muted-foreground">
                  {currentTheme.label}
                </span>
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent className="w-40" collisionPadding={12}>
                <DropdownMenuRadioGroup
                  value={preferences.themeMode}
                  onValueChange={(value) => setThemeMode(value as ThemeMode)}
                >
                  {THEME_OPTIONS.map((option) => (
                    <DropdownMenuRadioItem
                      key={option.value}
                      value={option.value}
                    >
                      <ThemeModeIcon mode={option.value} />
                      <span>{option.label}</span>
                    </DropdownMenuRadioItem>
                  ))}
                </DropdownMenuRadioGroup>
              </DropdownMenuSubContent>
            </DropdownMenuSub>

            <DropdownMenuSub>
              <DropdownMenuSubTrigger className="[&>svg:last-child]:ml-1">
                <PaletteIcon />
                <span>Loading indicator</span>
                <AppLoader
                  size="xs"
                  interactive={false}
                  className="ml-auto mr-4"
                />
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent className="w-48" collisionPadding={12}>
                <LoaderPickerContent />
              </DropdownMenuSubContent>
            </DropdownMenuSub>

            <DropdownMenuItem
              onSelect={() => {
                window.setTimeout(openAnalyticsSettingsDialog, 0);
              }}
            >
              <BarChart3Icon />
              <span>Usage data settings</span>
            </DropdownMenuItem>

            <DropdownMenuSeparator />

            <form
              action="/api/auth/logout"
              method="post"
              onSubmit={() => {
                resetAnalyticsAnonymousId();
              }}
            >
              <DropdownMenuItem asChild variant="destructive">
                <button type="submit" className="w-full">
                  <LogOutIcon />
                  <span>Sign out</span>
                </button>
              </DropdownMenuItem>
            </form>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}
