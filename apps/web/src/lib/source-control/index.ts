import { githubSourceControlProvider } from "@/lib/source-control/providers/github";
import type {
  SourceControlProvider,
  SourceControlProviderKey,
} from "@/lib/source-control/types";

const PROVIDERS: Record<SourceControlProviderKey, SourceControlProvider> = {
  github: githubSourceControlProvider,
};

export function getSourceControlProvider(
  provider: SourceControlProviderKey,
): SourceControlProvider {
  return PROVIDERS[provider];
}

export * from "./types";
