import assert from "node:assert/strict";
import test from "node:test";
import type { UIMessage } from "ai";
import {
  buildRuntimePrompt,
  getRuntimePromptHandoffDebug,
} from "./conversation-handoff";

const approvalMessages = [
  {
    id: "user-1",
    role: "user",
    parts: [
      {
        type: "text",
        text: "create a very simple app where i ask a question and a sub agent just answers. only normal webfetch",
      },
    ],
  },
  {
    id: "assistant-1",
    role: "assistant",
    parts: [
      {
        type: "text",
        text: "A dead-simple Q&A app for E2E testing.",
      },
      {
        type: "dynamic-tool",
        toolName: "mcp__second__present_plan",
        toolCallId: "toolu_plan",
        state: "output-available",
        preliminary: false,
        input: {
          overview:
            "A minimal Q&A app: one text input, one button, one agent that answers using WebFetch.",
          features: [
            { name: "Ask a question" },
            { name: "Display answer" },
          ],
          agents:
            "1 agent: Q&A Agent (WebFetch) takes a question and answers it.",
          backend: "Not available",
          dataFlow: "The agent writes its answer to the database.",
        },
      },
    ],
  },
  {
    id: "user-2",
    role: "user",
    parts: [
      {
        type: "text",
        text: "Plan approved. Continue with the build.",
      },
    ],
  },
] as unknown as UIMessage[];

test("approval continuation includes approved plan context even when native session covered earlier messages", () => {
  const input = {
    messages: approvalMessages,
    nativeHistoryMessageCount: 2,
    targetRuntimeId: "claude-code",
    targetModel: "claude-opus-4-6",
  } as const;

  const debug = getRuntimePromptHandoffDebug(input);
  const prompt = buildRuntimePrompt(input);

  assert.equal(debug.approvalContextIncluded, true);
  assert.equal(debug.usedApprovalHandoff, true);
  assert.equal(debug.approvalStopToolName, "mcp__second__present_plan");
  assert.equal(debug.handoffStart, 0);
  assert.match(prompt, /approved the latest build plan/);
  assert.match(prompt, /A minimal Q&A app/);
  assert.match(prompt, /Ask a question/);
  assert.match(prompt, /Plan approved\. Continue with the build\./);
});

test("normal continuation still trusts provider-covered history", () => {
  const messages = [
    {
      id: "user-1",
      role: "user",
      parts: [{ type: "text", text: "First message" }],
    },
    {
      id: "assistant-1",
      role: "assistant",
      parts: [{ type: "text", text: "First answer" }],
    },
    {
      id: "user-2",
      role: "user",
      parts: [{ type: "text", text: "Latest message" }],
    },
  ] as unknown as UIMessage[];

  const prompt = buildRuntimePrompt({
    messages,
    nativeHistoryMessageCount: 2,
    targetRuntimeId: "claude-code",
    targetModel: "claude-opus-4-6",
  });

  assert.equal(prompt, "Latest message");
});

test("handoff prompt does not claim the user changed model or runtime", () => {
  const messages = [
    {
      id: "user-1",
      role: "user",
      parts: [{ type: "text", text: "First message" }],
    },
    {
      id: "assistant-1",
      role: "assistant",
      parts: [{ type: "text", text: "First answer" }],
    },
    {
      id: "user-2",
      role: "user",
      parts: [{ type: "text", text: "Latest message" }],
    },
  ] as unknown as UIMessage[];

  const prompt = buildRuntimePrompt({
    messages,
    nativeHistoryMessageCount: 0,
    targetRuntimeId: "codex-cli",
    targetModel: "gpt-5.5",
  });

  assert.match(prompt, /restored Second conversation context/);
  assert.doesNotMatch(prompt, /changed the model or runtime/);
});
