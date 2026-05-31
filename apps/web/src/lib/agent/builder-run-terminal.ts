export type BuilderToolCallSummary = {
  toolName: string;
  inputAvailable: boolean;
  outputAvailable: boolean;
  flushedWithoutOutput: boolean;
  approvalStop?: boolean;
};

export type BuilderRunTerminalDecision =
  | { status: "completed" }
  | {
      status: "failed";
      code: "build_incomplete";
      message: string;
    };

const DONE_BUILDING_TOOL = "mcp__second__done_building";

const FILE_MUTATION_TOOLS = new Set([
  "Write",
  "Edit",
  "MultiEdit",
  "NotebookEdit",
]);

function isImplementationTool(toolName: string): boolean {
  return FILE_MUTATION_TOOLS.has(toolName);
}

export function classifyBuilderRunTerminalState(input: {
  isWorkspaceAgentRun: boolean;
  sourceFiles: Record<string, string> | null;
  toolCalls: BuilderToolCallSummary[];
}): BuilderRunTerminalDecision {
  if (input.isWorkspaceAgentRun || input.sourceFiles) {
    return { status: "completed" };
  }

  const stoppedForApproval = input.toolCalls.some(
    (tool) =>
      tool.approvalStop === true &&
      tool.outputAvailable &&
      !tool.flushedWithoutOutput,
  );
  if (stoppedForApproval) {
    return { status: "completed" };
  }

  const attemptedDoneBuilding = input.toolCalls.some(
    (tool) => tool.toolName === DONE_BUILDING_TOOL,
  );
  if (attemptedDoneBuilding) {
    return {
      status: "failed",
      code: "build_incomplete",
      message:
        "The agent stopped before producing a successful app build. Retry to continue from the latest code.",
    };
  }

  const changedFiles = input.toolCalls.some((tool) =>
    isImplementationTool(tool.toolName)
  );
  if (changedFiles) {
    return {
      status: "failed",
      code: "build_incomplete",
      message:
        "The agent wrote files but stopped before calling done_building successfully. Retry to continue from the latest code.",
    };
  }

  return { status: "completed" };
}
