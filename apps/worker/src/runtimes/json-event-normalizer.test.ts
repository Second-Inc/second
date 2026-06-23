import assert from "node:assert/strict";
import test from "node:test";
import { generateSyntheticSdkMessagesFromJsonEvent } from "./json-event-normalizer.js";
import type { AgentRuntimeSettings } from "./types.js";

const settings: AgentRuntimeSettings = {
  runtimeId: "opencode",
  model: "openai/gpt-5.5",
  params: {},
};

test("normalizes OpenCode text parts", () => {
  const messages = generateSyntheticSdkMessagesFromJsonEvent({
    runtimeId: "opencode",
    event: {
      type: "text",
      sessionID: "ses_123",
      part: {
        type: "text",
        text: "OK",
        sessionID: "ses_123",
      },
    },
    settings,
    pendingToolCalls: new Map(),
  });

  assert.equal(messages[0]?.type, "system");
  assert.equal(messages[0]?.session_id, "ses_123");
  const assistant = messages.find((message) => message.type === "assistant");
  assert.deepEqual(assistant?.message, {
    role: "assistant",
    content: [{ type: "text", text: "OK" }],
  });
});

test("does not emit duplicate OpenCode init for an already known session", () => {
  const messages = generateSyntheticSdkMessagesFromJsonEvent({
    runtimeId: "opencode",
    event: {
      type: "text",
      sessionID: "ses_123",
      part: {
        type: "text",
        text: "OK",
        sessionID: "ses_123",
      },
    },
    settings,
    sessionState: {
      runtimeId: "opencode",
      sessionId: "ses_123",
      format: "opencode-session",
    },
    pendingToolCalls: new Map(),
  });

  assert.equal(messages.some((message) => message.type === "system"), false);
  assert.deepEqual(messages[0]?.message, {
    role: "assistant",
    content: [{ type: "text", text: "OK" }],
  });
});

test("normalizes OpenCode completed tool parts", () => {
  const pendingToolCalls = new Map<string, string>();
  const messages = generateSyntheticSdkMessagesFromJsonEvent({
    runtimeId: "opencode",
    event: {
      type: "tool_use",
      sessionID: "ses_123",
      part: {
        type: "tool",
        tool: "bash",
        callID: "call_123",
        state: {
          status: "completed",
          input: { command: "pwd" },
          output: "/tmp/app\n",
        },
      },
    },
    settings,
    pendingToolCalls,
  });

  assert.equal(pendingToolCalls.get("call_123"), "Bash");
  assert.deepEqual(
    messages.find((message) => message.type === "assistant")?.message,
    {
      role: "assistant",
      content: [
        {
          type: "tool_use",
          id: "call_123",
          name: "Bash",
          input: { command: "pwd" },
        },
      ],
    },
  );
  assert.deepEqual(
    messages.find((message) => message.type === "user")?.message,
    {
      role: "user",
      content: [
        {
          type: "tool_result",
          tool_use_id: "call_123",
          content: "/tmp/app\n",
        },
      ],
    },
  );
});

test("normalizes OpenCode MCP tool names", () => {
  const pendingToolCalls = new Map<string, string>();
  const messages = generateSyntheticSdkMessagesFromJsonEvent({
    runtimeId: "opencode",
    event: {
      type: "tool_use",
      sessionID: "ses_123",
      part: {
        type: "tool",
        tool: "second_present_plan",
        callID: "call_plan",
        state: {
          status: "completed",
          input: { title: "Tiny Todo" },
          output: "{\"ok\":true,\"status\":\"presented\"}",
        },
      },
    },
    settings,
    pendingToolCalls,
  });

  assert.equal(
    pendingToolCalls.get("call_plan"),
    "mcp__second__present_plan",
  );
  assert.deepEqual(
    messages.find((message) => message.type === "assistant")?.message,
    {
      role: "assistant",
      content: [
        {
          type: "tool_use",
          id: "call_plan",
          name: "mcp__second__present_plan",
          input: { title: "Tiny Todo" },
        },
      ],
    },
  );
});

test("normalizes OpenCode step token usage", () => {
  const messages = generateSyntheticSdkMessagesFromJsonEvent({
    runtimeId: "opencode",
    event: {
      type: "step_finish",
      sessionID: "ses_123",
      part: {
        type: "step-finish",
        tokens: {
          input: 258,
          output: 5,
          cache: { read: 11776, write: 12 },
        },
        cost: 0.42,
      },
    },
    settings,
    pendingToolCalls: new Map(),
  });

  const result = messages.find((message) => message.type === "result") as
    | {
        total_cost_usd?: number;
        modelUsage?: Record<string, unknown>;
      }
    | undefined;
  assert.equal(result?.total_cost_usd, 0.42);
  assert.deepEqual(result?.modelUsage?.["openai/gpt-5.5"], {
    inputTokens: 258,
    outputTokens: 5,
    cacheReadInputTokens: 11776,
    cacheCreationInputTokens: 12,
    costUSD: 0.42,
  });
});
