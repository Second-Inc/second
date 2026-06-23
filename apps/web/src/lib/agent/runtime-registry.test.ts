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
  assert.deepEqual(defaults.params, { variant: "auto" });
});

test("OpenCode runtime settings parse and remain associated with OpenCode", () => {
  const parsed = parseRuntimeSettings({
    runtimeId: "opencode",
    runtimeModel: "openai/gpt-5.5",
    runtimeParams: { variant: "xhigh", ignored: "value" },
  });

  assert.deepEqual(parsed, {
    runtimeId: "opencode",
    model: "openai/gpt-5.5",
    params: { variant: "xhigh" },
  });
  assert.equal(findRuntimeForModel("openai/gpt-5.5")?.id, "opencode");
});

test("OpenCode accepts dynamic provider/model IDs from discovery", () => {
  const parsed = parseRuntimeSettings({
    runtimeId: "opencode",
    runtimeModel: "opencode/qwen-coder-free",
    runtimeParams: { variant: "high" },
  });

  assert.deepEqual(parsed, {
    runtimeId: "opencode",
    model: "opencode/qwen-coder-free",
    params: { variant: "high" },
  });
});
