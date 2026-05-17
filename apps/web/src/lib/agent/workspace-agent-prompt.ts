import type { AgentRuntimeId } from "@/lib/agent/runtime-registry";
import type { RuntimeSkillReference } from "@/lib/db";
import type { WorkspaceAgentRunSnapshot } from "@/lib/db/types";

function formatCurrentDateForPrompt(date: Date = new Date()): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day} (current year: ${year})`;
}

function formatSkills(skills: RuntimeSkillReference[]): string {
  if (skills.length === 0) return "No Library skills are attached.";

  return skills
    .map(
      (skill) =>
        `- ${skill.displayName} (${skill.slug}, revision ${skill.revisionNumber}): ${skill.description}`,
    )
    .join("\n");
}

export function appendSelectedSkillGuidance(input: {
  systemPrompt: string;
  skills: RuntimeSkillReference[];
  runtimeId: AgentRuntimeId;
}): string {
  if (input.skills.length === 0) return input.systemPrompt;

  const mentionSyntax = input.runtimeId === "codex-cli" ? "$" : "/";
  return [
    input.systemPrompt,
    "",
    "SELECTED LIBRARY SKILLS:",
    formatSkills(input.skills),
    "",
    `The selected skills are installed in the runtime as local skill files. Use the Skill tool or explicit ${mentionSyntax}<skill-name> invocation when a selected skill is relevant to the user's request.`,
  ].join("\n");
}

export function getWorkspaceAgentSystemPrompt(input: {
  workspaceId: string;
  workspaceName: string;
  agent: WorkspaceAgentRunSnapshot;
  skills: RuntimeSkillReference[];
  runtimeId: AgentRuntimeId;
  runtimeModel: string;
}): string {
  const mentionSyntax = input.runtimeId === "codex-cli" ? "$" : "/";
  return [
    `You are ${input.agent.displayName}, a workspace agent in Second.`,
    `Workspace: "${input.workspaceName}" (ID: ${input.workspaceId}).`,
    `Important: CURRENT DATE: ${formatCurrentDateForPrompt()}. Use this date and year when reasoning about recency.`,
    `Important: CURRENT RUNTIME MODEL ID / SLUG: ${input.runtimeModel}.`,
    "If asked for your model ID / slug, return the current runtime model ID / slug above exactly.",
    "",
    "AGENT INSTRUCTIONS:",
    input.agent.systemPrompt,
    "",
    "SELECTED LIBRARY SKILLS:",
    formatSkills(input.skills),
    "",
    `The selected skills are installed as local skill files. Use the Skill tool or explicit ${mentionSyntax}<skill-name> invocation when a selected skill is relevant.`,
    "",
    "BOUNDARIES:",
    "- You are not the Builder agent and you are not building or editing an app in this chat.",
    "- Do not write files, run shell/build commands, or modify source code.",
    "- Do not ask for or reveal cookies, headers, tokens, API keys, or secret values.",
    "- Integrations and custom workspace tools are not enabled for workspace agents in this iteration. If a requested action needs one, say that it is not connected yet and provide the best non-destructive guidance you can.",
  ].join("\n");
}
