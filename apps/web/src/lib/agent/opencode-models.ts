export type OpenCodeModelSupportStatus =
  | "supported"
  | "recommended"
  | "available";

export type OpenCodeDiscoveredModel = {
  id: string;
  providerId: string;
  modelId: string;
  name: string;
  family?: string;
  status?: string;
  toolcall: boolean;
  reasoning: boolean;
  attachment: boolean;
  contextLimit?: number;
  outputLimit?: number;
  variants: string[];
  supportStatus: OpenCodeModelSupportStatus;
  supportLabel: string;
  description: string;
};

export type OpenCodeModelDiscoveryResult = {
  available: boolean;
  models: OpenCodeDiscoveredModel[];
  totalCount: number;
  filteredOutCount: number;
  refreshed: boolean;
  error?: string;
};

export function isOpenCodeModelId(value: string): boolean {
  const trimmed = value.trim();
  const separatorIndex = trimmed.indexOf("/");
  if (separatorIndex <= 0 || separatorIndex >= trimmed.length - 1) return false;

  const providerId = trimmed.slice(0, separatorIndex);
  const modelId = trimmed.slice(separatorIndex + 1);
  return /^[a-z0-9_.-]+$/i.test(providerId) && !/\s/.test(modelId);
}

export function openCodeVariantOptions(model: OpenCodeDiscoveredModel | null): string[] {
  const variants = model?.variants ?? [];
  return ["auto", ...variants.filter((variant) => variant !== "auto")];
}

export function normalizeOpenCodeVariant(
  value: string | undefined,
  model: OpenCodeDiscoveredModel | null,
): string {
  const requested = value?.trim() || "auto";
  if (requested === "auto") return "auto";
  if (!model) return requested;
  return model.variants.includes(requested) ? requested : "auto";
}
