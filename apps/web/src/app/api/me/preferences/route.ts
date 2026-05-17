import { NextResponse } from "next/server";
import {
  guardErrorToApiResponse,
  isRequestGuardError,
  requireReadyState,
} from "@/lib/auth";
import { updateUserPreferences } from "@/lib/db";
import {
  isLoaderColorId,
  isLoaderStyleId,
  isThemeMode,
  normalizeLoaderCustomColor,
  normalizeUserPreferences,
} from "@/lib/user-preferences";

export async function GET(request: Request) {
  try {
    const readyState = await requireReadyState({ headers: request.headers });
    return NextResponse.json({
      preferences: normalizeUserPreferences(readyState.user.preferences),
    });
  } catch (error) {
    if (isRequestGuardError(error)) return guardErrorToApiResponse(error);
    throw error;
  }
}

export async function PATCH(request: Request) {
  let readyState: Awaited<ReturnType<typeof requireReadyState>>;

  try {
    readyState = await requireReadyState({ headers: request.headers });
  } catch (error) {
    if (isRequestGuardError(error)) return guardErrorToApiResponse(error);
    throw error;
  }

  const body = (await request.json().catch(() => null)) as {
    loaderColor?: unknown;
    loaderStyle?: unknown;
    loaderCustomColor?: unknown;
    themeMode?: unknown;
  } | null;

  if (!body) {
    return NextResponse.json({ error: "invalid_preferences" }, { status: 400 });
  }

  const loaderColor = body.loaderColor;
  const loaderStyle = body.loaderStyle;
  const loaderCustomColor = body.loaderCustomColor;
  const themeMode = body.themeMode;

  if (loaderColor !== undefined && !isLoaderColorId(loaderColor)) {
    return NextResponse.json({ error: "invalid_loader_color" }, { status: 400 });
  }

  if (loaderStyle !== undefined && !isLoaderStyleId(loaderStyle)) {
    return NextResponse.json({ error: "invalid_loader_style" }, { status: 400 });
  }

  const normalizedLoaderCustomColor =
    loaderCustomColor === undefined
      ? undefined
      : normalizeLoaderCustomColor(loaderCustomColor) ?? undefined;

  if (loaderCustomColor !== undefined && !normalizedLoaderCustomColor) {
    return NextResponse.json(
      { error: "invalid_loader_custom_color" },
      { status: 400 },
    );
  }

  if (themeMode !== undefined && !isThemeMode(themeMode)) {
    return NextResponse.json({ error: "invalid_theme_mode" }, { status: 400 });
  }

  if (
    loaderColor === undefined &&
    loaderStyle === undefined &&
    normalizedLoaderCustomColor === undefined &&
    themeMode === undefined
  ) {
    return NextResponse.json({ error: "empty_preferences" }, { status: 400 });
  }

  const preferences = await updateUserPreferences({
    userId: readyState.user._id,
    ...(loaderColor !== undefined ? { loaderColor } : {}),
    ...(loaderStyle !== undefined ? { loaderStyle } : {}),
    ...(normalizedLoaderCustomColor !== undefined
      ? { loaderCustomColor: normalizedLoaderCustomColor }
      : {}),
    ...(themeMode !== undefined ? { themeMode } : {}),
  });

  return NextResponse.json({ preferences });
}
