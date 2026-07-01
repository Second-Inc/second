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
  isOpenCodeModelId,
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

test("OpenCode model IDs can include nested provider model paths", () => {
  assert.equal(isOpenCodeModelId("vllm//models/Qwen/Qwen3-Coder-30B-A3B-Instruct"), true);
  assert.equal(isOpenCodeModelId("openrouter/google/gemini-2.5-flash"), true);
  assert.equal(isOpenCodeModelId("vllm/"), false);
  assert.equal(isOpenCodeModelId("/models/Qwen/Qwen3"), false);
});

test("OpenCode verbose parser accepts nested and plain model output", () => {
  const models = parseOpenCodeModelsVerbose(`
vllm//models/Qwen/Qwen3-Coder-30B-A3B-Instruct
{
  "id": "/models/Qwen/Qwen3-Coder-30B-A3B-Instruct",
  "providerID": "vllm",
  "name": "Qwen3 Coder 30B",
  "family": "qwen",
  "status": "active",
  "capabilities": { "toolcall": true, "reasoning": true, "attachment": false },
  "variants": {}
}
llm//models/openai/gpt-oss-120b
`);

  assert.equal(models.length, 2);
  assert.equal(models[0]?.id, "vllm//models/Qwen/Qwen3-Coder-30B-A3B-Instruct");
  assert.equal(models[0]?.providerId, "vllm");
  assert.equal(models[0]?.modelId, "/models/Qwen/Qwen3-Coder-30B-A3B-Instruct");
  assert.equal(models[0]?.supportStatus, "recommended");
  assert.equal(models[1]?.id, "llm//models/openai/gpt-oss-120b");
  assert.equal(models[1]?.toolcall, true);
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

test("OpenCode custom providers receive env keys referenced in provider config", () => {
  const command = writeProbeScript("#!/bin/sh\nexit 0\n");
  const configPath = join(command, "..", "opencode.json");
  writeFileSync(
    configPath,
    JSON.stringify({
      provider: {
        vllm: {
          options: {
            baseURL: "https://models.example.test/v1",
            apiKey: "{env:VLLM_API_KEY}",
            headers: {
              "x-litellm-token": "{env:LITELLM_TOKEN}",
              authorization: "Bearer {env:INTERNAL_API_TOKEN}",
            },
          },
          models: {
            "/models/Qwen/Qwen3-Coder": {},
          },
        },
        openai: {
          options: {
            apiKey: "{env:OPENAI_BACKUP_KEY}",
          },
        },
      },
    }),
    "utf-8",
  );

  const previousConfigFile = process.env.SECOND_OPENCODE_CONFIG_FILE;
  process.env.SECOND_OPENCODE_CONFIG_FILE = configPath;

  try {
    assert.deepEqual(
      openCodeAuthEnvKeysForModel("vllm//models/Qwen/Qwen3-Coder").sort(),
      ["LITELLM_TOKEN", "VLLM_API_KEY"].sort(),
    );
  } finally {
    if (previousConfigFile === undefined) {
      delete process.env.SECOND_OPENCODE_CONFIG_FILE;
    } else {
      process.env.SECOND_OPENCODE_CONFIG_FILE = previousConfigFile;
    }
  }
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
