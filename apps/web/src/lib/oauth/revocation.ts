import { readOAuthSecret } from "@/lib/oauth/secret-store";

export function oauthRevocationUrlForProvider(providerKey: string): string | null {
  if (providerKey === "google") return "https://oauth2.googleapis.com/revoke";
  return null;
}

export async function revokeOAuthTokenAtProvider(input: {
  providerKey: string;
  tokenRef: string | null | undefined;
}): Promise<boolean> {
  if (!input.tokenRef) return false;

  const revocationUrl = oauthRevocationUrlForProvider(input.providerKey);
  if (!revocationUrl) return false;

  try {
    const token = await readOAuthSecret(input.tokenRef);
    const response = await fetch(revocationUrl, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ token }),
    });
    return response.ok;
  } catch {
    return false;
  }
}
