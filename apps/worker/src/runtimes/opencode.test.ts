import assert from "node:assert/strict";
import { test } from "node:test";
import { buildOpenCodeToolConfig } from "./opencode.js";
import {
  buildOpenCodeRunArgs,
  parseOpenCodeModelsVerbose,
} from "./opencode-models.js";

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

test("OpenCode verbose model output is parsed and classified", () => {
  const models = parseOpenCodeModelsVerbose(`
openai/gpt-5.5
{
  "id": "gpt-5.5",
  "providerID": "openai",
  "name": "GPT-5.5",
  "family": "gpt",
  "status": "active",
  "limit": { "context": 400000, "output": 128000 },
  "capabilities": { "toolcall": true, "reasoning": true, "attachment": true },
  "variants": { "low": {}, "high": {}, "xhigh": {} }
}
local/tiny-text
{
  "id": "tiny-text",
  "providerID": "local",
  "name": "Tiny Text",
  "capabilities": { "toolcall": false, "reasoning": false, "attachment": false },
  "variants": {}
}
opencode/qwen-coder-free
{
  "id": "qwen-coder-free",
  "providerID": "opencode",
  "name": "Qwen Coder Free",
  "family": "qwen",
  "status": "active",
  "limit": { "context": 200000 },
  "capabilities": { "toolcall": true, "reasoning": true, "attachment": false },
  "variants": { "medium": {}, "high": {} }
}
`);

  assert.equal(models.length, 3);
  assert.equal(models[0]?.id, "openai/gpt-5.5");
  assert.equal(models[0]?.toolcall, true);
  assert.equal(models[0]?.contextLimit, 400000);
  assert.deepEqual(models[0]?.variants, ["low", "high", "xhigh"]);
  assert.equal(models[0]?.supportStatus, "supported");
  assert.equal(models[1]?.toolcall, false);
  assert.equal(models[2]?.supportStatus, "supported");
});

test("OpenCode run args include variant only when selected", () => {
  assert.deepEqual(
    buildOpenCodeRunArgs({
      model: "openai/gpt-5.5",
      agent: "second-builder",
      prompt: "hello",
      variant: "xhigh",
    }),
    [
      "run",
      "--format",
      "json",
      "--model",
      "openai/gpt-5.5",
      "--variant",
      "xhigh",
      "--agent",
      "second-builder",
      "hello",
    ],
  );

  assert.deepEqual(
    buildOpenCodeRunArgs({
      model: "opencode/big-pickle",
      agent: "second-builder",
      prompt: "hello",
      sessionId: "ses_123",
    }),
    [
      "run",
      "--format",
      "json",
      "--model",
      "opencode/big-pickle",
      "--agent",
      "second-builder",
      "--session",
      "ses_123",
      "hello",
    ],
  );
});
