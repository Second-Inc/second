import { NextResponse } from "next/server";
import {
  guardErrorToApiResponse,
  isRequestGuardError,
  requireReadyState,
} from "@/lib/auth";
import { readRuntimeConfig } from "@/lib/config";
import { workerFetch } from "@/lib/worker-client";

type DetectionResult = {
  claudeCli: { available: boolean; version?: string };
  codexCli: { available: boolean; version?: string };
  opencodeCli: { available: boolean; version?: string };
  runtimes: Record<
    string,
    {
      available: boolean;
      version?: string;
      features?: { jsonEvents?: boolean };
      auth: { envKeyConfigured: boolean; cliLikelyConfigured: boolean };
    }
  >;
  apiKeyConfigured: boolean;
  workerReachable: boolean;
  error?: string;
};

function workerUnavailableProviderResult(error: string): DetectionResult {
  return {
    claudeCli: { available: false },
    codexCli: { available: false },
    opencodeCli: { available: false },
    runtimes: {
      "claude-code": {
        available: false,
        auth: {
          envKeyConfigured: Boolean(process.env.ANTHROPIC_API_KEY),
          cliLikelyConfigured: false,
        },
      },
      "codex-cli": {
        available: false,
        auth: {
          envKeyConfigured: Boolean(process.env.CODEX_API_KEY || process.env.OPENAI_API_KEY),
          cliLikelyConfigured: false,
        },
      },
      opencode: {
        available: false,
        features: { jsonEvents: false },
        auth: {
          envKeyConfigured: Boolean(
            process.env.OPENAI_API_KEY ||
              process.env.ANTHROPIC_API_KEY ||
              (process.env.CLAUDE_CODE_USE_BEDROCK &&
                (process.env.AWS_BEARER_TOKEN_BEDROCK ||
                  process.env.AWS_ACCESS_KEY_ID ||
                  process.env.AWS_PROFILE)) ||
              process.env.GOOGLE_API_KEY ||
              process.env.GEMINI_API_KEY,
          ),
          cliLikelyConfigured: false,
        },
      },
    },
    apiKeyConfigured: Boolean(process.env.ANTHROPIC_API_KEY),
    workerReachable: false,
    ...(error ? { error } : {}),
  };
}

export async function GET(request: Request) {
  const config = readRuntimeConfig();

  if (config.authMode !== "none") {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  try {
    await requireReadyState({ headers: request.headers });
  } catch (error) {
    if (isRequestGuardError(error)) return guardErrorToApiResponse(error);
    throw error;
  }

  try {
    const res = await workerFetch("/detect-provider");
    if (!res.ok) {
      return NextResponse.json(
        workerUnavailableProviderResult(`Worker returned ${res.status}`),
      );
    }

    const data = (await res.json()) as Omit<DetectionResult, "workerReachable">;
    return NextResponse.json({
      ...data,
      workerReachable: true,
    });
  } catch {
    return NextResponse.json(workerUnavailableProviderResult("Worker not reachable"));
  }
}
