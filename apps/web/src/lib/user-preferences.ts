export const LOADER_COLOR_IDS = [
  "mono",
  "blue",
  "violet",
  "emerald",
  "amber",
  "rose",
  "custom",
] as const;

export type LoaderColorId = (typeof LOADER_COLOR_IDS)[number];

export const LOADER_STYLE_IDS = [
  "orbit",
  "blocks",
  "pulse",
  "wave",
  "pixel-cat",
  "pixel-dog",
] as const;

export type LoaderStyleId = (typeof LOADER_STYLE_IDS)[number];

export const THEME_MODES = ["system", "light", "dark"] as const;

export type ThemeMode = (typeof THEME_MODES)[number];

export const DEFAULT_CUSTOM_LOADER_COLOR = "#5E6AD2";

export type UserPreferences = {
  loaderColor: LoaderColorId;
  loaderStyle: LoaderStyleId;
  loaderCustomColor: string;
  themeMode: ThemeMode;
};

export const DEFAULT_USER_PREFERENCES: UserPreferences = {
  loaderColor: "mono",
  loaderStyle: "wave",
  loaderCustomColor: DEFAULT_CUSTOM_LOADER_COLOR,
  themeMode: "system",
};

export function isLoaderColorId(value: unknown): value is LoaderColorId {
  return (
    typeof value === "string" &&
    (LOADER_COLOR_IDS as readonly string[]).includes(value)
  );
}

export function isThemeMode(value: unknown): value is ThemeMode {
  return (
    typeof value === "string" &&
    (THEME_MODES as readonly string[]).includes(value)
  );
}

export function isLoaderStyleId(value: unknown): value is LoaderStyleId {
  return (
    typeof value === "string" &&
    (LOADER_STYLE_IDS as readonly string[]).includes(value)
  );
}

export function normalizeLoaderCustomColor(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const color = value.trim();

  if (/^#[0-9a-f]{3}$/i.test(color) || /^#[0-9a-f]{6}$/i.test(color)) {
    return color.toUpperCase();
  }

  return null;
}

export function normalizeUserPreferences(
  value: unknown,
): UserPreferences {
  if (!value || typeof value !== "object") {
    return DEFAULT_USER_PREFERENCES;
  }

  const preferences = value as Partial<UserPreferences>;
  return {
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
  };
}
