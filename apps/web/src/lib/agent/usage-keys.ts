export function encodeUsageModelKey(model: string): string {
  return encodeURIComponent(model).replace(/\./g, "%2E");
}

export function decodeUsageModelKey(modelKey: string): string {
  try {
    return decodeURIComponent(modelKey);
  } catch {
    return modelKey;
  }
}
