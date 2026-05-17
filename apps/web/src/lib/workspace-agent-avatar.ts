export const WORKSPACE_AGENT_GRADIENTS = [
  "linear-gradient(120deg, #d4fc79 0%, #96e6a1 100%)",
  "linear-gradient(120deg, #a1c4fd 0%, #c2e9fb 100%)",
  "linear-gradient(to right, #4facfe 0%, #00f2fe 100%)",
  "linear-gradient(to top, #fddb92 0%, #d1fdff 100%)",
  "linear-gradient(to right, #eea2a2 0%, #bbc1bf 19%, #57c6e1 42%, #b49fda 79%, #7ac5d8 100%)",
  "linear-gradient(to top, #fff1eb 0%, #ace0f9 100%)",
  "linear-gradient(to right, #f78ca0 0%, #f9748f 19%, #fd868c 60%, #fe9a8b 100%)",
  "linear-gradient(to top, #accbee 0%, #e7f0fd 100%)",
  "linear-gradient(to right, #74ebd5 0%, #9face6 100%)",
  "linear-gradient(to top, #30cfd0 0%, #330867 100%)",
];

const EXPLICIT_GRADIENT_PREFIX = "gradient:";

function gradientIndex(index: number): number {
  return (
    ((index % WORKSPACE_AGENT_GRADIENTS.length) + WORKSPACE_AGENT_GRADIENTS.length) %
    WORKSPACE_AGENT_GRADIENTS.length
  );
}

export function workspaceAgentGradientSeedForIndex(index: number): string {
  return `${EXPLICIT_GRADIENT_PREFIX}${gradientIndex(index)}`;
}

export function workspaceAgentGradient(seed: string): string {
  if (seed.startsWith(EXPLICIT_GRADIENT_PREFIX)) {
    const index = Number(seed.slice(EXPLICIT_GRADIENT_PREFIX.length));
    if (Number.isInteger(index)) {
      return WORKSPACE_AGENT_GRADIENTS[gradientIndex(index)];
    }
  }

  const hash = seed.split("").reduce((acc, c) => acc + c.charCodeAt(0), 0);
  return WORKSPACE_AGENT_GRADIENTS[hash % WORKSPACE_AGENT_GRADIENTS.length];
}

export function randomWorkspaceAgentGradientSeed(): string {
  const index = Math.floor(Math.random() * WORKSPACE_AGENT_GRADIENTS.length);
  return workspaceAgentGradientSeedForIndex(index);
}
