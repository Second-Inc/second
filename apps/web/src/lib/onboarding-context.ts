export const ONBOARDING_CONTEXT_MAX_LENGTH = 3000;

export function normalizeOnboardingContextText(value: unknown): string | null {
  if (typeof value !== "string") return null;

  const normalized = value
    .replace(/\r\n/g, "\n")
    .replace(/\n{4,}/g, "\n\n\n")
    .trim()
    .slice(0, ONBOARDING_CONTEXT_MAX_LENGTH)
    .trim();

  return normalized.length > 0 ? normalized : null;
}

export function hasOnboardingContext(value: string | null | undefined): boolean {
  return Boolean(value?.trim());
}
