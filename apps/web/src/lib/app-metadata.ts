import { updateAppGeneratedMetadata } from "@/lib/db";
import { workerFetch } from "@/lib/worker-client";
import type { AgentRuntimeSettings } from "@/lib/agent/runtime-registry";

type WorkerMetadataResponse = {
  name?: unknown;
  description?: unknown;
  error?: unknown;
};

function cleanGeneratedName(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const name = value
    .trim()
    .replace(/^["']+|["']+$/g, "")
    .replace(/\s+/g, " ")
    .replace(/\s+\(\d+\)$/, "")
    .slice(0, 80)
    .trim();
  return name.length >= 2 ? name : null;
}

function cleanGeneratedDescription(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const description = value.trim().replace(/\s+/g, " ").slice(0, 300).trim();
  return description.length >= 2 ? description : null;
}

export async function generateAndUpdateAppMetadata(input: {
  workspaceId: string;
  appId: string;
  prompt: string;
  fallbackName: string;
  runtimeSettings: AgentRuntimeSettings;
}): Promise<void> {
  const startedAt = Date.now();
  console.info(
    `[app-metadata] start appId=${input.appId} workspaceId=${input.workspaceId} runtime=${input.runtimeSettings.runtimeId} model=${input.runtimeSettings.model}`,
  );

  try {
    console.info(`[app-metadata] worker request appId=${input.appId}`);
    const response = await workerFetch(`/sessions/${input.appId}/metadata`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        prompt: input.prompt,
        fallbackName: input.fallbackName,
        runtimeId: input.runtimeSettings.runtimeId,
        runtimeModel: input.runtimeSettings.model,
        runtimeParams: input.runtimeSettings.params,
      }),
    });

    console.info(
      `[app-metadata] worker response appId=${input.appId} status=${response.status} elapsedMs=${Date.now() - startedAt}`,
    );

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      console.warn(
        `[app-metadata] Worker metadata generation failed appId=${input.appId} status=${response.status} bodyLength=${body.length}`,
      );
      return;
    }

    const payload = (await response.json().catch(() => null)) as
      | WorkerMetadataResponse
      | null;
    const name = cleanGeneratedName(payload?.name);
    const description = cleanGeneratedDescription(payload?.description);

    if (!name || !description) {
      console.warn(
        `[app-metadata] Worker returned invalid metadata appId=${input.appId} hasName=${Boolean(name)} hasDescription=${Boolean(description)} keys=${Object.keys(payload ?? {}).join(",")}`,
      );
      return;
    }

    const updated = await updateAppGeneratedMetadata({
      workspaceId: input.workspaceId,
      appId: input.appId,
      name,
      description,
    });
    console.info(
      `[app-metadata] db update appId=${input.appId} matched=${Boolean(updated)} name=${JSON.stringify(updated?.name ?? name)} descriptionLength=${description.length} elapsedMs=${Date.now() - startedAt}`,
    );
  } catch (error) {
    console.warn(
      `[app-metadata] failed appId=${input.appId} elapsedMs=${Date.now() - startedAt}: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
}
