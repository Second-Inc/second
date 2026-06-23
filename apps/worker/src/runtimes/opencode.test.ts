import assert from "node:assert/strict";
import { test } from "node:test";
import { buildOpenCodeToolConfig } from "./opencode.js";

test("OpenCode tool config disables unsupported built-ins for restricted runs", () => {
  const tools = buildOpenCodeToolConfig([
    "WebSearch",
    "WebFetch",
    "mcp__second__set_onboarding_context",
  ]);

  assert.equal(tools.websearch, true);
  assert.equal(tools.webfetch, true);
  assert.equal(tools.second, true);
  assert.equal(tools.app_tools, false);
  assert.equal(tools.app_data, false);
  assert.equal(tools.task, false);
  assert.equal(tools.todowrite, false);
  assert.equal(tools.skill, false);
  assert.equal(tools.apply_patch, false);
  assert.equal(tools.read, false);
  assert.equal(tools.bash, false);
});

test("OpenCode tool config keeps explicit edit permission mapped to apply_patch", () => {
  const tools = buildOpenCodeToolConfig(["Edit"]);

  assert.equal(tools.edit, true);
  assert.equal(tools.apply_patch, true);
  assert.equal(tools.write, false);
});
