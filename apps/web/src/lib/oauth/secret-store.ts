import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  deleteSecret,
  isVaultConfigured,
  readSecret,
  storeSecret,
  updateSecret,
} from "@/lib/vault";

const LOCAL_SECRET_DIR = ".second-dev";
const LOCAL_SECRET_KEY_FILE = "oauth-secret-store.key";
const LOCAL_REF_PREFIX = "local:v1:";
const VAULT_REF_PREFIX = "vault:";

type StoreOAuthSecretInput = {
  workspaceId: string;
  name: string;
  value: string;
};

function parseConfiguredKey(value: string): Buffer | null {
  const trimmed = value.trim();
  if (!trimmed) return null;

  try {
    const base64 = Buffer.from(trimmed, "base64");
    if (base64.length === 32) return base64;
  } catch {
    // Fall through to the other formats.
  }

  if (/^[a-f0-9]{64}$/i.test(trimmed)) {
    return Buffer.from(trimmed, "hex");
  }

  return createHash("sha256").update(trimmed).digest();
}

function getGeneratedLocalSecretKey(): Buffer {
  const path = join(process.cwd(), LOCAL_SECRET_DIR, LOCAL_SECRET_KEY_FILE);
  if (existsSync(path)) {
    return Buffer.from(readFileSync(path, "utf-8").trim(), "base64");
  }

  mkdirSync(join(process.cwd(), LOCAL_SECRET_DIR), { recursive: true });
  const key = randomBytes(32);
  writeFileSync(path, `${key.toString("base64")}\n`, { mode: 0o600 });
  return key;
}

function getLocalEncryptionKey(): Buffer {
  const configured = process.env.SECOND_TOKEN_ENCRYPTION_KEY;
  const configuredKey = configured ? parseConfiguredKey(configured) : null;
  if (configuredKey) return configuredKey;

  if (process.env.NODE_ENV === "production") {
    throw new Error(
      "SECOND_TOKEN_ENCRYPTION_KEY is required when WorkOS Vault is not configured in production.",
    );
  }

  return getGeneratedLocalSecretKey();
}

function encryptLocal(value: string): string {
  const key = getLocalEncryptionKey();
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([
    cipher.update(value, "utf-8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return [
    LOCAL_REF_PREFIX.slice(0, -1),
    iv.toString("base64url"),
    tag.toString("base64url"),
    ciphertext.toString("base64url"),
  ].join(":");
}

function decryptLocal(ref: string): string {
  const parts = ref.split(":");
  if (parts.length !== 5 || `${parts[0]}:${parts[1]}:` !== LOCAL_REF_PREFIX) {
    throw new Error("Invalid local OAuth secret reference.");
  }

  const [, , ivRaw, tagRaw, ciphertextRaw] = parts;
  const decipher = createDecipheriv(
    "aes-256-gcm",
    getLocalEncryptionKey(),
    Buffer.from(ivRaw, "base64url"),
  );
  decipher.setAuthTag(Buffer.from(tagRaw, "base64url"));
  return Buffer.concat([
    decipher.update(Buffer.from(ciphertextRaw, "base64url")),
    decipher.final(),
  ]).toString("utf-8");
}

export function isVaultSecretRef(ref: string | null | undefined): boolean {
  return typeof ref === "string" && ref.startsWith(VAULT_REF_PREFIX);
}

export async function storeOAuthSecret(
  input: StoreOAuthSecretInput,
): Promise<string> {
  if (isVaultConfigured()) {
    const id = await storeSecret(input.name, input.value, input.workspaceId);
    return `${VAULT_REF_PREFIX}${id}`;
  }

  return encryptLocal(input.value);
}

export async function readOAuthSecret(ref: string): Promise<string> {
  if (ref.startsWith(VAULT_REF_PREFIX)) {
    return readSecret(ref.slice(VAULT_REF_PREFIX.length));
  }

  if (ref.startsWith(LOCAL_REF_PREFIX)) {
    return decryptLocal(ref);
  }

  throw new Error("Unknown OAuth secret reference.");
}

export async function upsertOAuthSecret(input: StoreOAuthSecretInput & {
  existingRef?: string | null;
}): Promise<string> {
  if (input.existingRef?.startsWith(VAULT_REF_PREFIX) && isVaultConfigured()) {
    await updateSecret(input.existingRef.slice(VAULT_REF_PREFIX.length), input.value);
    return input.existingRef;
  }

  return storeOAuthSecret(input);
}

export async function deleteOAuthSecret(ref: string | null | undefined): Promise<void> {
  if (!ref) return;
  if (!ref.startsWith(VAULT_REF_PREFIX)) return;
  await deleteSecret(ref.slice(VAULT_REF_PREFIX.length));
}
