"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import {
  DEFAULT_USER_PREFERENCES,
  isLoaderColorId,
  isLoaderStyleId,
  isThemeMode,
  normalizeLoaderCustomColor,
  normalizeUserPreferences,
  type LoaderColorId,
  type LoaderStyleId,
  type ThemeMode,
  type UserPreferences,
} from "@/lib/user-preferences";

type LoaderPreferencesContextValue = {
  preferences: UserPreferences;
  setLoaderColor: (color: LoaderColorId) => void;
  setLoaderStyle: (style: LoaderStyleId) => void;
  setLoaderCustomColor: (color: string) => void;
  setThemeMode: (mode: ThemeMode) => void;
};

const LoaderPreferencesContext =
  createContext<LoaderPreferencesContextValue | null>(null);
const LOADER_PREFERENCES_CHANNEL = "second-loader-preferences";

type PreferencesMessage = Partial<{
  loaderColor: unknown;
  loaderStyle: unknown;
  loaderCustomColor: unknown;
  themeMode: unknown;
}>;

function applyThemeMode(mode: ThemeMode) {
  if (typeof window === "undefined") return;

  const systemDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
  const effectiveMode = mode === "system" ? (systemDark ? "dark" : "light") : mode;
  document.documentElement.classList.toggle("dark", effectiveMode === "dark");
  document.documentElement.classList.toggle("light", effectiveMode === "light");
  document.documentElement.style.colorScheme = effectiveMode;
}

export function LoaderPreferencesProvider({
  children,
}: {
  children: ReactNode;
}) {
  const [preferences, setPreferences] = useState<UserPreferences>(
    DEFAULT_USER_PREFERENCES,
  );

  useEffect(() => {
    applyThemeMode(preferences.themeMode);

    if (preferences.themeMode !== "system") return;

    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const handleChange = () => applyThemeMode("system");
    media.addEventListener("change", handleChange);
    return () => media.removeEventListener("change", handleChange);
  }, [preferences.themeMode]);

  useEffect(() => {
    let cancelled = false;
    const channel =
      typeof BroadcastChannel === "undefined"
        ? null
        : new BroadcastChannel(LOADER_PREFERENCES_CHANNEL);

    channel?.addEventListener("message", (event) => {
      const data = event.data as PreferencesMessage;
      const loaderColor = data.loaderColor;
      const loaderStyle = data.loaderStyle;
      const loaderCustomColor = normalizeLoaderCustomColor(
        data.loaderCustomColor,
      );
      const themeMode = data.themeMode;
      setPreferences((current) => {
        const next = {
          ...current,
          ...(isLoaderColorId(loaderColor) ? { loaderColor } : {}),
          ...(isLoaderStyleId(loaderStyle) ? { loaderStyle } : {}),
          ...(loaderCustomColor ? { loaderCustomColor } : {}),
          ...(isThemeMode(themeMode) ? { themeMode } : {}),
        };
        return next;
      });
    });

    fetch("/api/me/preferences", { cache: "no-store" })
      .then((response) => (response.ok ? response.json() : null))
      .then((body: { preferences?: unknown } | null) => {
        if (cancelled || !body) return;
        const next = normalizeUserPreferences(body.preferences);
        setPreferences(next);
      })
      .catch(() => {
        // Keep local defaults when no authenticated preference is available.
      });

    return () => {
      cancelled = true;
      channel?.close();
    };
  }, []);

  const patchPreferences = useCallback((patch: Partial<UserPreferences>) => {
    fetch("/api/me/preferences", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    }).catch(() => {
      // Optimistic UI is acceptable; the next load will reconcile saved state.
    });
  }, []);

  const broadcastPreferences = useCallback((patch: PreferencesMessage) => {
    if (typeof BroadcastChannel === "undefined") return;

    const channel = new BroadcastChannel(LOADER_PREFERENCES_CHANNEL);
    channel.postMessage(patch);
    channel.close();
  }, []);

  const setLoaderColor = useCallback((color: LoaderColorId) => {
    setPreferences((current) => {
      const next = { ...current, loaderColor: color };
      return next;
    });
    broadcastPreferences({ loaderColor: color });
    patchPreferences({ loaderColor: color });
  }, [broadcastPreferences, patchPreferences]);

  const setLoaderStyle = useCallback((style: LoaderStyleId) => {
    setPreferences((current) => {
      const next = { ...current, loaderStyle: style };
      return next;
    });
    broadcastPreferences({ loaderStyle: style });
    patchPreferences({ loaderStyle: style });
  }, [broadcastPreferences, patchPreferences]);

  const setLoaderCustomColor = useCallback((color: string) => {
    const nextColor = normalizeLoaderCustomColor(color);
    if (!nextColor) return;

    setPreferences((current) => {
      const next = {
        ...current,
        loaderColor: "custom" as const,
        loaderCustomColor: nextColor,
      };
      return next;
    });
    broadcastPreferences({
      loaderColor: "custom",
      loaderCustomColor: nextColor,
    });
    patchPreferences({
      loaderColor: "custom",
      loaderCustomColor: nextColor,
    });
  }, [broadcastPreferences, patchPreferences]);

  const setThemeMode = useCallback((mode: ThemeMode) => {
    setPreferences((current) => {
      const next = { ...current, themeMode: mode };
      return next;
    });
    broadcastPreferences({ themeMode: mode });
    patchPreferences({ themeMode: mode });
  }, [broadcastPreferences, patchPreferences]);

  const value = useMemo(
    () => ({
      preferences: {
        loaderColor: isLoaderColorId(preferences.loaderColor)
          ? preferences.loaderColor
          : DEFAULT_USER_PREFERENCES.loaderColor,
        loaderStyle: isLoaderStyleId(preferences.loaderStyle)
          ? preferences.loaderStyle
          : DEFAULT_USER_PREFERENCES.loaderStyle,
        loaderCustomColor:
          normalizeLoaderCustomColor(preferences.loaderCustomColor) ??
          DEFAULT_USER_PREFERENCES.loaderCustomColor,
        themeMode: isThemeMode(preferences.themeMode)
          ? preferences.themeMode
          : DEFAULT_USER_PREFERENCES.themeMode,
      },
      setLoaderColor,
      setLoaderStyle,
      setLoaderCustomColor,
      setThemeMode,
    }),
    [
      preferences.loaderColor,
      preferences.loaderCustomColor,
      preferences.loaderStyle,
      preferences.themeMode,
      setLoaderColor,
      setLoaderCustomColor,
      setLoaderStyle,
      setThemeMode,
    ],
  );

  return (
    <LoaderPreferencesContext.Provider value={value}>
      {children}
    </LoaderPreferencesContext.Provider>
  );
}

export function useLoaderPreferences() {
  const context = useContext(LoaderPreferencesContext);
  if (!context) {
    return {
      preferences: DEFAULT_USER_PREFERENCES,
      setLoaderColor: () => {},
      setLoaderStyle: () => {},
      setLoaderCustomColor: () => {},
      setThemeMode: () => {},
    } satisfies LoaderPreferencesContextValue;
  }
  return context;
}

export function useThemePreference() {
  return useLoaderPreferences();
}
