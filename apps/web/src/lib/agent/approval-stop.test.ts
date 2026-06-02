import assert from "node:assert/strict";
import test from "node:test";

const modulePath = "./approval-stop.ts";
const { isApprovalStopToolOutput } = await import(modulePath);

test("detects Codex MCP content envelope for presented agents", () => {
  assert.equal(
    isApprovalStopToolOutput("mcp__second__present_agents", {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            ok: true,
            status: "presented",
            source: "agents.json",
          }),
        },
      ],
    }),
    true,
  );
});

test("detects Claude-style content array for presented agents", () => {
  assert.equal(
    isApprovalStopToolOutput("mcp__second__present_agents", [
      {
        type: "text",
        text: JSON.stringify({
          ok: true,
          status: "presented",
          source: "agents.json",
        }),
      },
    ]),
    true,
  );
});

test("does not treat failed agents presentation as approval stop", () => {
  assert.equal(
    isApprovalStopToolOutput("mcp__second__present_agents", {
      content: [
        {
          type: "text",
          text: JSON.stringify({ ok: false, status: "error" }),
        },
      ],
    }),
    false,
  );
});

test("always treats plan and suggestions tools as approval stops", () => {
  assert.equal(
    isApprovalStopToolOutput("mcp__second__present_plan", { error: "ignored" }),
    true,
  );
  assert.equal(
    isApprovalStopToolOutput("mcp__second__present_suggestions", null),
    true,
  );
});
