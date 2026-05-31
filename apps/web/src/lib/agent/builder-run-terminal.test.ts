import assert from "node:assert/strict";
import test from "node:test";

const modulePath = "./builder-run-terminal.ts";
const { classifyBuilderRunTerminalState } = await import(modulePath);

test("completed when done_building produced source files", () => {
  assert.deepEqual(
    classifyBuilderRunTerminalState({
      isWorkspaceAgentRun: false,
      sourceFiles: { "dist/index.html": "<html></html>" },
      toolCalls: [{
        toolName: "Write",
        inputAvailable: true,
        outputAvailable: true,
        flushedWithoutOutput: false,
      }],
    }),
    { status: "completed" },
  );
});

test("failed when builder wrote files without a successful done_building snapshot", () => {
  const decision = classifyBuilderRunTerminalState({
    isWorkspaceAgentRun: false,
    sourceFiles: null,
    toolCalls: [{
      toolName: "Write",
      inputAvailable: true,
      outputAvailable: true,
      flushedWithoutOutput: false,
    }],
  });

  assert.equal(decision.status, "failed");
  if (decision.status === "failed") {
    assert.equal(decision.code, "build_incomplete");
    assert.match(decision.message, /stopped before calling done_building/);
  }
});

test("completed when builder stops at an agents approval checkpoint after writing agents.json", () => {
  assert.deepEqual(
    classifyBuilderRunTerminalState({
      isWorkspaceAgentRun: false,
      sourceFiles: null,
      toolCalls: [
        {
          toolName: "Write",
          inputAvailable: true,
          outputAvailable: true,
          flushedWithoutOutput: false,
        },
        {
          toolName: "mcp__second__present_agents",
          inputAvailable: true,
          outputAvailable: true,
          flushedWithoutOutput: false,
          approvalStop: true,
        },
      ],
    }),
    { status: "completed" },
  );
});

test("failed when done_building was attempted but did not produce a snapshot", () => {
  const decision = classifyBuilderRunTerminalState({
    isWorkspaceAgentRun: false,
    sourceFiles: null,
    toolCalls: [{
      toolName: "mcp__second__done_building",
      inputAvailable: true,
      outputAvailable: true,
      flushedWithoutOutput: false,
    }],
  });

  assert.equal(decision.status, "failed");
  if (decision.status === "failed") {
    assert.equal(decision.code, "build_incomplete");
    assert.match(decision.message, /successful app build/);
  }
});

test("completed for read-only builder answers", () => {
  assert.deepEqual(
    classifyBuilderRunTerminalState({
      isWorkspaceAgentRun: false,
      sourceFiles: null,
      toolCalls: [{
        toolName: "Read",
        inputAvailable: true,
        outputAvailable: true,
        flushedWithoutOutput: false,
      }],
    }),
    { status: "completed" },
  );
});

test("completed for workspace agent runs without done_building", () => {
  assert.deepEqual(
    classifyBuilderRunTerminalState({
      isWorkspaceAgentRun: true,
      sourceFiles: null,
      toolCalls: [{
        toolName: "Write",
        inputAvailable: true,
        outputAvailable: true,
        flushedWithoutOutput: false,
      }],
    }),
    { status: "completed" },
  );
});
