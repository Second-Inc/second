import { runAgent } from "../runner.js";
import type { RuntimeAdapter, RuntimeRunResultMessage } from "./types.js";

export const claudeRuntimeAdapter: RuntimeAdapter = {
  id: "claude-code",
  async *run(input): AsyncGenerator<RuntimeRunResultMessage> {
    const resumeSessionId =
      input.sessionState?.runtimeId === "claude-code"
        ? input.sessionState.sessionId ?? undefined
        : undefined;

    for await (const message of runAgent(
      input.prompt,
      input.config,
      resumeSessionId,
      input.settings.model,
      input.settings.params.effort,
      input.settings.params.thinking,
    )) {
      const runtimeMessage = message as RuntimeRunResultMessage;
      if (message.type === "system" && message.subtype === "init" && message.session_id) {
        runtimeMessage.providerSessionState = {
          runtimeId: "claude-code",
          sessionId: message.session_id,
          data: input.sessionState?.data ?? null,
          format: "claude-jsonl",
        };
      }
      yield runtimeMessage;
    }
  },
};
