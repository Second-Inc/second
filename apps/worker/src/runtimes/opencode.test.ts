import assert from "node:assert/strict";
import { chmodSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  clearOpenCodeJsonSupportCache,
  detectOpenCodeRunJsonSupport,
} from "./opencode-cli.js";
import { buildOpenCodeToolConfig } from "./opencode.js";
import {
  buildOpenCodeRunArgs,
  parseOpenCodeModelsVerbose,
} from "./opencode-models.js";
import { openCodeAuthEnvKeysForModel } from "./process-env.js";

function writeProbeScript(contents: string): string {
  const dir = mkdtempSync(join(tmpdir(), "second-opencode-probe-"));
  const script = join(dir, "opencode");
  writeFileSync(script, contents, "utf-8");
  chmodSync(script, 0o755);
  return script;
}

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

test("OpenCode Bedrock models receive AWS auth env keys", () => {
  assert.deepEqual(
    openCodeAuthEnvKeysForModel("amazon-bedrock/anthropic.claude-opus-4-6-v1"),
    [
      "AWS_BEARER_TOKEN_BEDROCK",
      "AWS_REGION",
      "AWS_DEFAULT_REGION",
      "AWS_PROFILE",
      "AWS_ACCESS_KEY_ID",
      "AWS_SECRET_ACCESS_KEY",
      "AWS_SESSION_TOKEN",
    ],
  );
});

test("OpenCode JSON support probe detects supported run help", () => {
  clearOpenCodeJsonSupportCache();
  const command = writeProbeScript(`#!/bin/sh
echo "opencode run"
echo "  --format  format: default or json"
`);

  const result = detectOpenCodeRunJsonSupport(command);

  assert.equal(result.supported, true);
  assert.equal(result.definitive, true);
});

test("OpenCode JSON support probe treats completed help without format as unsupported", () => {
  clearOpenCodeJsonSupportCache();
  const command = writeProbeScript(`#!/bin/sh
echo "opencode run"
echo "  --model  model to use"
`);

  const result = detectOpenCodeRunJsonSupport(command);

  if (result.supported) assert.fail("expected unsupported OpenCode help");
  assert.equal(result.definitive, true);
  assert.equal(result.reason, "unsupported");
});

test("OpenCode JSON support probe treats timeout as non-definitive", () => {
  clearOpenCodeJsonSupportCache();
  const previousTimeout = process.env.SECOND_OPENCODE_HELP_TIMEOUT_MS;
  process.env.SECOND_OPENCODE_HELP_TIMEOUT_MS = "50";
  const command = writeProbeScript(`#!/bin/sh
"${process.execPath}" -e "setTimeout(() => {}, 500)"
`);

  try {
    const result = detectOpenCodeRunJsonSupport(command);

    if (result.supported) assert.fail("expected non-definitive probe failure");
    assert.equal(result.definitive, false);
    assert.equal(result.reason, "probe_failed");
  } finally {
    if (previousTimeout === undefined) {
      delete process.env.SECOND_OPENCODE_HELP_TIMEOUT_MS;
    } else {
      process.env.SECOND_OPENCODE_HELP_TIMEOUT_MS = previousTimeout;
    }
  }
});

test("OpenCode JSON support probe caches positive support", () => {
  clearOpenCodeJsonSupportCache();
  const previousTimeout = process.env.SECOND_OPENCODE_HELP_TIMEOUT_MS;
  const command = writeProbeScript(`#!/bin/sh
echo "opencode run --format json"
`);

  try {
    assert.equal(detectOpenCodeRunJsonSupport(command).supported, true);
    process.env.SECOND_OPENCODE_HELP_TIMEOUT_MS = "50";

    writeFileSync(
      command,
      `#!/bin/sh
"${process.execPath}" -e "setTimeout(() => {}, 500)"
`,
      "utf-8",
    );
    chmodSync(command, 0o755);

    assert.equal(detectOpenCodeRunJsonSupport(command).supported, true);
  } finally {
    if (previousTimeout === undefined) {
      delete process.env.SECOND_OPENCODE_HELP_TIMEOUT_MS;
    } else {
      process.env.SECOND_OPENCODE_HELP_TIMEOUT_MS = previousTimeout;
    }
  }
});
