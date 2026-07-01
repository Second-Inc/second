import { readRuntimeConfig } from "@/lib/config";
import { isVaultConfigured } from "@/lib/vault";

export function isLocalSecondInstall(): boolean {
  return process.env.SECOND_LOCAL_INSTALL === "1";
}

export function sourceControlRuntimeLabel(): "local" | "cloud" {
  return isLocalSecondInstall() ? "local" : "cloud";
}

export function sourceControlSecretStorageLabel(): string {
  return isVaultConfigured() ? "WorkOS Vault" : "encrypted local storage";
}

export function canShowLocalSourceControlFeatures(): boolean {
  return readRuntimeConfig().authMode === "none" && isLocalSecondInstall();
}
