const DEFAULT_POSTHOG_TOKEN = "phc_Xg1Id4ZaOowXb3UWqiPo8z3XTRXwTUgY0bD3zD7xWex";
const DEFAULT_POSTHOG_HOST = "https://us.i.posthog.com";

type AnalyticsPublicConfig = {
  posthogToken: string;
  posthogHost: string;
};

function readEnvValue(
  env: NodeJS.ProcessEnv,
  keys: string[],
): string {
  for (const key of keys) {
    const value = env[key]?.trim();
    if (value) return value;
  }
  return "";
}

export function readAnalyticsPublicConfig(
  env: NodeJS.ProcessEnv = process.env,
): AnalyticsPublicConfig {
  if (
    env.SECOND_POSTHOG_DISABLED === "1" ||
    env.SECOND_TELEMETRY_DISABLED === "1"
  ) {
    return {
      posthogToken: "",
      posthogHost: DEFAULT_POSTHOG_HOST,
    };
  }

  return {
    posthogToken:
      readEnvValue(env, [
        "SECOND_POSTHOG_TOKEN",
        "NEXT_PUBLIC_POSTHOG_TOKEN",
      ]) || DEFAULT_POSTHOG_TOKEN,
    posthogHost:
      readEnvValue(env, [
        "SECOND_POSTHOG_HOST",
        "NEXT_PUBLIC_POSTHOG_HOST",
      ]) || DEFAULT_POSTHOG_HOST,
  };
}

