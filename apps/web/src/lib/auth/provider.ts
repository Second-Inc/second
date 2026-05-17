import { readRuntimeConfig } from "@/lib/config";
import { noAuthProvider } from "@/lib/auth/no-auth-provider";
import type { AuthActor, AuthProvider, AuthRequest } from "@/lib/auth/types";

export function loadAuthProvider(): AuthProvider {
  const config = readRuntimeConfig();

  if (config.authMode === "none") {
    return noAuthProvider;
  }

  throw new Error(
    "[auth] SECOND_AUTH_MODE=external requires an external/private auth provider extension, which is not included in this OSS build.",
  );
}

export async function resolveActor(request: AuthRequest): Promise<AuthActor | null> {
  const provider = loadAuthProvider();
  return provider.resolveActor(request);
}
