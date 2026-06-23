import assert from "node:assert/strict";
import test from "node:test";
import { tmpdir } from "node:os";
import { runJsonlCliRuntime } from "./cli-events.js";
import type { AgentRuntimeSettings } from "./types.js";

const settings: AgentRuntimeSettings = {
  runtimeId: "opencode",
  model: "openai/gpt-5.5",
  params: {},
};

function messageContent(message: unknown): Array<Record<string, unknown>> {
  const record =
    message && typeof message === "object" && !Array.isArray(message)
      ? (message as { message?: { content?: unknown } })
      : {};
  return Array.isArray(record.message?.content)
    ? (record.message.content as Array<Record<string, unknown>>)
    : [];
}

test("stops consuming CLI events after an approval-stop tool result", async () => {
  const script = `
    console.log(JSON.stringify({
      type: "tool_use",
      sessionID: "ses_approval",
      part: {
        type: "tool",
        tool: "second_present_plan",
        callID: "call_plan",
        state: {
          status: "completed",
          input: { title: "Tiny Todo" },
          output: "{\\"ok\\":true,\\"status\\":\\"presented\\"}"
        }
      }
    }));
    console.log(JSON.stringify({
      type: "text",
      sessionID: "ses_approval",
      part: {
        type: "text",
        text: "SHOULD_NOT_STREAM",
        sessionID: "ses_approval"
      }
    }));
    setTimeout(() => {}, 1000);
  `;

  const messages = [];
  for await (const message of runJsonlCliRuntime({
    runtimeId: "opencode",
    command: process.execPath,
    args: ["-e", script],
    cwd: tmpdir(),
    env: process.env as Record<string, string>,
    settings,
  })) {
    messages.push(message);
  }

  const text = messages
    .flatMap(messageContent)
    .filter((part) => part?.type === "text")
    .map((part) => part.text)
    .join("\n");

  assert.equal(text.includes("SHOULD_NOT_STREAM"), false);
  assert.equal(
    messages.some(
      (message) =>
        message.type === "assistant" &&
        messageContent(message).some(
          (part) =>
            part?.type === "tool_use" &&
            part.name === "mcp__second__present_plan",
        ),
    ),
    true,
  );
});

test("throws when a CLI JSON stream emits a provider error event", async () => {
  const script = `
    console.log(JSON.stringify({
      type: "error",
      error: {
        type: "service_unavailable_error",
        code: "server_is_overloaded",
        message: "Our servers are currently overloaded. Please try again later."
      }
    }));
    setTimeout(() => {}, 1000);
  `;

  await assert.rejects(
    async () => {
      for await (const _message of runJsonlCliRuntime({
        runtimeId: "opencode",
        command: process.execPath,
        args: ["-e", script],
        cwd: tmpdir(),
        env: process.env as Record<string, string>,
        settings,
      })) {
        // Drain the stream until it throws.
      }
    },
    /server_is_overloaded: Our servers are currently overloaded/,
  );
});
