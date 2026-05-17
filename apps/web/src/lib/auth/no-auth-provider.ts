import type { AuthProvider } from "@/lib/auth/types";
import { readNoAuthSessionUserId } from "@/lib/auth/session";

export const noAuthProvider: AuthProvider = {
  async resolveActor(request) {
    const userId = readNoAuthSessionUserId(request.headers);

    if (!userId) {
      return null;
    }

    return {
      userId,
      provider: "none",
    };
  },
};
