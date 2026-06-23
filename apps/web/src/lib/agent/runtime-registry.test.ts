import assert from "node:assert/strict";
import test from "node:test";
import {
  findRuntimeForModel,
  getDefaultRuntimeSettings,
  getRuntime,
  parseRuntimeSettings,
} from "./runtime-registry";

test("OpenCode is registered with OpenAI GPT-5.5 as the default model", () => {
  const runtime = getRuntime("opencode");
  const defaults = getDefaultRuntimeSettings("opencode");

  assert.equal(runtime.defaultModel, "openai/gpt-5.5");
  assert.equal(defaults.runtimeId, "opencode");
  assert.equal(defaults.model, "openai/gpt-5.5");
  assert.deepEqual(defaults.params, {});
});

test("OpenCode runtime settings parse and remain associated with OpenCode", () => {
  const parsed = parseRuntimeSettings({
    runtimeId: "opencode",
    runtimeModel: "openai/gpt-5.5",
    runtimeParams: { ignored: "value" },
  });

  assert.deepEqual(parsed, {
    runtimeId: "opencode",
    model: "openai/gpt-5.5",
    params: {},
  });
  assert.equal(findRuntimeForModel("openai/gpt-5.5")?.id, "opencode");
});
