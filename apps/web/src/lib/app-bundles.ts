import { deflateRawSync, inflateRawSync } from "node:zlib";
import type { AgentRuntimeId } from "@/lib/agent/runtime-registry";

export const SECOND_APP_BUNDLE_TYPE = "second.app.export.v1";
export const SECOND_APP_MANIFEST_PATH = "second-app.json";
export const SECOND_APP_FILES_PREFIX = "files/";

const ZIP_DOS_TIME = 0;
const ZIP_DOS_DATE = 33;
const ZIP_METHOD_STORE = 0;
const ZIP_METHOD_DEFLATE = 8;
const MAX_BUNDLE_BYTES = 40 * 1024 * 1024;
const MAX_MANIFEST_BYTES = 16 * 1024 * 1024;
const MAX_SOURCE_TOTAL_BYTES = 12 * 1024 * 1024;
const MAX_SOURCE_FILE_BYTES = 512 * 1024;
const MAX_FILE_COUNT = 2000;
const MAX_PATH_LENGTH = 240;

const IGNORED_TOP_LEVEL_SEGMENTS = new Set([
  "node_modules",
  ".git",
  ".next",
  ".cache",
  ".claude",
  "attachments",
  "__MACOSX",
]);

const IGNORED_FILENAMES = new Set([
  ".ds_store",
  ".env",
  ".env.local",
  ".env.development",
  ".env.production",
  ".npmrc",
  ".yarnrc",
  ".pnpmrc",
]);

export class AppBundleError extends Error {
  status: number;
  code: string;

  constructor(code: string, message: string, status = 400) {
    super(message);
    this.name = "AppBundleError";
    this.code = code;
    this.status = status;
  }
}

export type SecondAppBundleManifest = {
  type: typeof SECOND_APP_BUNDLE_TYPE;
  schemaVersion: 1;
  exportedAt: string;
  app: {
    name: string;
    description?: string | null;
    prompt?: string | null;
    runtimeId?: AgentRuntimeId | string | null;
    runtimeModel?: string | null;
    runtimeParams?: Record<string, string> | null;
  };
  source: {
    fileCount: number;
    totalBytes: number;
    includesPreviewArtifact: boolean;
  };
  runs: Array<{
    mode?: "builder" | "workspace_agent";
    messages: unknown[];
    createdAt?: string | null;
    updatedAt?: string | null;
  }>;
};

export type ParsedSecondAppBundle = {
  manifest: SecondAppBundleManifest | null;
  files: Record<string, string>;
  runs: SecondAppBundleManifest["runs"];
};

type ZipEntry = {
  path: string;
  content: Buffer;
};

type FileSummary = {
  fileCount: number;
  totalBytes: number;
  includesPreviewArtifact: boolean;
};

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)}MB`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function createCrc32Table(): Uint32Array {
  const table = new Uint32Array(256);

  for (let i = 0; i < table.length; i += 1) {
    let value = i;
    for (let bit = 0; bit < 8; bit += 1) {
      value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }
    table[i] = value >>> 0;
  }

  return table;
}

const CRC32_TABLE = createCrc32Table();

function crc32(bytes: Buffer): number {
  let crc = 0xffffffff;

  for (const byte of bytes) {
    crc = CRC32_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }

  return (crc ^ 0xffffffff) >>> 0;
}

function normalizeZipPath(path: string): string {
  return path.replaceAll("\\", "/").replace(/^\.\/+/, "");
}

function isIgnoredAppPath(path: string): boolean {
  const normalized = normalizeZipPath(path);
  const segments = normalized.split("/").filter(Boolean);
  if (segments.length === 0) return true;
  if (segments.some((segment) => segment.startsWith("."))) return true;
  if (segments.some((segment) => IGNORED_TOP_LEVEL_SEGMENTS.has(segment))) {
    return true;
  }
  const filename = segments[segments.length - 1].toLowerCase();
  if (IGNORED_FILENAMES.has(filename) || filename.startsWith(".env.")) {
    return true;
  }
  return false;
}

export function shouldIncludeAppBundleFile(path: string): boolean {
  const normalized = normalizeZipPath(path);
  if (!normalized || normalized.length > MAX_PATH_LENGTH) return false;
  if (normalized.startsWith("/") || normalized.includes("\0")) return false;
  if (/^[a-zA-Z]:\//.test(normalized)) return false;
  if (normalized.split("/").some((segment) => segment === "..")) return false;
  return !isIgnoredAppPath(normalized);
}

function sanitizeImportedFilePath(path: string): string | null {
  const normalized = normalizeZipPath(path);
  if (!shouldIncludeAppBundleFile(normalized)) return null;
  return normalized;
}

function sourceSummary(files: Record<string, string>): FileSummary {
  let totalBytes = 0;

  for (const content of Object.values(files)) {
    totalBytes += Buffer.byteLength(content, "utf-8");
  }

  return {
    fileCount: Object.keys(files).length,
    totalBytes,
    includesPreviewArtifact: Boolean(
      files["dist/index.html"] ||
        files["index.html"] ||
        files["src/App.tsx"] ||
        files["src/App.jsx"] ||
        files["src/main.tsx"] ||
        files["src/main.jsx"],
    ),
  };
}

export function filterBundleSourceFiles(
  files: Record<string, string>,
): Record<string, string> {
  const filtered: Record<string, string> = {};

  for (const [path, content] of Object.entries(files)) {
    const sanitized = sanitizeImportedFilePath(path);
    if (!sanitized) continue;
    filtered[sanitized] = content;
  }

  validateBundleSourceFiles(filtered);
  return Object.fromEntries(
    Object.entries(filtered).sort(([a], [b]) => a.localeCompare(b)),
  );
}

export function validateBundleSourceFiles(files: Record<string, string>): void {
  const entries = Object.entries(files);
  if (entries.length === 0) {
    throw new AppBundleError(
      "missing_files",
      "The app bundle does not contain any importable files.",
      400,
    );
  }
  if (entries.length > MAX_FILE_COUNT) {
    throw new AppBundleError(
      "too_many_files",
      `The app bundle contains ${entries.length} files. The limit is ${MAX_FILE_COUNT}.`,
      413,
    );
  }

  let totalBytes = 0;
  for (const [path, content] of entries) {
    if (!shouldIncludeAppBundleFile(path)) {
      throw new AppBundleError(
        "invalid_path",
        `The app bundle contains an unsafe file path: ${path}`,
        400,
      );
    }
    if (content.includes("\0")) {
      throw new AppBundleError(
        "binary_file",
        `The app bundle contains a binary file that cannot be imported: ${path}`,
        400,
      );
    }
    const fileBytes = Buffer.byteLength(content, "utf-8");
    if (fileBytes > MAX_SOURCE_FILE_BYTES) {
      throw new AppBundleError(
        "file_too_large",
        `Cannot import "${path}" (${formatBytes(fileBytes)}). Per-file limit is ${formatBytes(MAX_SOURCE_FILE_BYTES)}.`,
        413,
      );
    }
    totalBytes += fileBytes;
    if (totalBytes > MAX_SOURCE_TOTAL_BYTES) {
      throw new AppBundleError(
        "bundle_too_large",
        `The app bundle source is too large (${formatBytes(totalBytes)}). Maximum allowed is ${formatBytes(MAX_SOURCE_TOTAL_BYTES)}.`,
        413,
      );
    }
  }
}

function normalizeManifest(value: unknown): SecondAppBundleManifest {
  if (!isRecord(value)) {
    throw new AppBundleError(
      "invalid_manifest",
      "The app bundle manifest is invalid.",
      400,
    );
  }
  if (value.type !== SECOND_APP_BUNDLE_TYPE || value.schemaVersion !== 1) {
    throw new AppBundleError(
      "unsupported_bundle",
      "This app bundle version is not supported.",
      400,
    );
  }

  const app = isRecord(value.app) ? value.app : {};
  const source = isRecord(value.source) ? value.source : {};
  const runs = Array.isArray(value.runs) ? value.runs : [];

  return {
    type: SECOND_APP_BUNDLE_TYPE,
    schemaVersion: 1,
    exportedAt:
      typeof value.exportedAt === "string"
        ? value.exportedAt
        : new Date().toISOString(),
    app: {
      name: typeof app.name === "string" ? app.name : "Imported app",
      description:
        typeof app.description === "string" ? app.description : null,
      prompt: typeof app.prompt === "string" ? app.prompt : null,
      runtimeId:
        typeof app.runtimeId === "string" ? app.runtimeId : null,
      runtimeModel:
        typeof app.runtimeModel === "string" ? app.runtimeModel : null,
      runtimeParams: isStringRecord(app.runtimeParams)
        ? app.runtimeParams
        : null,
    },
    source: {
      fileCount:
        typeof source.fileCount === "number" ? source.fileCount : 0,
      totalBytes:
        typeof source.totalBytes === "number" ? source.totalBytes : 0,
      includesPreviewArtifact:
        typeof source.includesPreviewArtifact === "boolean"
          ? source.includesPreviewArtifact
          : false,
    },
    runs: runs.flatMap((run): SecondAppBundleManifest["runs"] => {
      if (!isRecord(run) || !Array.isArray(run.messages)) return [];
      return [{
        mode: run.mode === "workspace_agent" ? "workspace_agent" : "builder",
        messages: run.messages,
        createdAt: typeof run.createdAt === "string" ? run.createdAt : null,
        updatedAt: typeof run.updatedAt === "string" ? run.updatedAt : null,
      }];
    }),
  };
}

function isStringRecord(value: unknown): value is Record<string, string> {
  return (
    isRecord(value) &&
    Object.values(value).every((entry) => typeof entry === "string")
  );
}

function decodeUtf8TextFile(path: string, content: Buffer): string {
  const text = content.toString("utf-8");
  if (!Buffer.from(text, "utf-8").equals(content)) {
    throw new AppBundleError(
      "binary_file",
      `The app bundle contains a binary file that cannot be imported: ${path}`,
      400,
    );
  }
  return text;
}

function singlePlainZipRoot(paths: string[]): string | null {
  let root: string | null = null;

  for (const path of paths) {
    const normalized = normalizeZipPath(path);
    if (!normalized || isIgnoredAppPath(normalized)) continue;
    const segments = normalized.split("/").filter(Boolean);
    if (segments.length <= 1) return null;
    if (root === null) {
      root = segments[0];
      continue;
    }
    if (segments[0] !== root) return null;
  }

  return root;
}

function stripPlainZipRoot(path: string, root: string | null): string {
  if (!root) return path;
  const normalized = normalizeZipPath(path);
  return normalized.startsWith(`${root}/`)
    ? normalized.slice(root.length + 1)
    : normalized;
}

function zipLocalHeader(input: {
  pathBytes: Buffer;
  contentBytes: Buffer;
  compressedBytes: Buffer;
  method: number;
  checksum: number;
}): Buffer {
  const header = Buffer.alloc(30 + input.pathBytes.length);
  header.writeUInt32LE(0x04034b50, 0);
  header.writeUInt16LE(20, 4);
  header.writeUInt16LE(0x0800, 6);
  header.writeUInt16LE(input.method, 8);
  header.writeUInt16LE(ZIP_DOS_TIME, 10);
  header.writeUInt16LE(ZIP_DOS_DATE, 12);
  header.writeUInt32LE(input.checksum, 14);
  header.writeUInt32LE(input.compressedBytes.length, 18);
  header.writeUInt32LE(input.contentBytes.length, 22);
  header.writeUInt16LE(input.pathBytes.length, 26);
  header.writeUInt16LE(0, 28);
  input.pathBytes.copy(header, 30);
  return header;
}

function zipCentralHeader(input: {
  pathBytes: Buffer;
  contentBytes: Buffer;
  compressedBytes: Buffer;
  method: number;
  checksum: number;
  offset: number;
}): Buffer {
  const header = Buffer.alloc(46 + input.pathBytes.length);
  header.writeUInt32LE(0x02014b50, 0);
  header.writeUInt16LE(20, 4);
  header.writeUInt16LE(20, 6);
  header.writeUInt16LE(0x0800, 8);
  header.writeUInt16LE(input.method, 10);
  header.writeUInt16LE(ZIP_DOS_TIME, 12);
  header.writeUInt16LE(ZIP_DOS_DATE, 14);
  header.writeUInt32LE(input.checksum, 16);
  header.writeUInt32LE(input.compressedBytes.length, 20);
  header.writeUInt32LE(input.contentBytes.length, 24);
  header.writeUInt16LE(input.pathBytes.length, 28);
  header.writeUInt16LE(0, 30);
  header.writeUInt16LE(0, 32);
  header.writeUInt16LE(0, 34);
  header.writeUInt16LE(0, 36);
  header.writeUInt32LE(0, 38);
  header.writeUInt32LE(input.offset, 42);
  input.pathBytes.copy(header, 46);
  return header;
}

export function createZip(entries: Array<[string, string]>): Buffer {
  const localParts: Buffer[] = [];
  const centralParts: Buffer[] = [];
  let offset = 0;
  let centralSize = 0;

  for (const [path, content] of entries) {
    const pathBytes = Buffer.from(path, "utf-8");
    const contentBytes = Buffer.from(content, "utf-8");
    const compressedBytes = deflateRawSync(contentBytes);
    const method = ZIP_METHOD_DEFLATE;
    const checksum = crc32(contentBytes);

    const localHeader = zipLocalHeader({
      pathBytes,
      contentBytes,
      compressedBytes,
      method,
      checksum,
    });
    localParts.push(localHeader, compressedBytes);

    const centralHeader = zipCentralHeader({
      pathBytes,
      contentBytes,
      compressedBytes,
      method,
      checksum,
      offset,
    });
    centralParts.push(centralHeader);
    centralSize += centralHeader.length;
    offset += localHeader.length + compressedBytes.length;
  }

  const centralOffset = offset;
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralSize, 12);
  end.writeUInt32LE(centralOffset, 16);
  end.writeUInt16LE(0, 20);

  return Buffer.concat([...localParts, ...centralParts, end]);
}

function findEndOfCentralDirectory(zip: Buffer): number {
  const signature = Buffer.from([0x50, 0x4b, 0x05, 0x06]);
  const minOffset = Math.max(0, zip.length - 22 - 65535);

  for (
    let offset = zip.length - 22;
    offset >= minOffset;
    offset -= 1
  ) {
    if (zip.subarray(offset, offset + 4).equals(signature)) {
      return offset;
    }
  }

  return -1;
}

function parseZipEntries(zip: Buffer): ZipEntry[] {
  if (zip.length > MAX_BUNDLE_BYTES) {
    throw new AppBundleError(
      "bundle_too_large",
      `The app bundle is too large (${formatBytes(zip.length)}). Maximum allowed is ${formatBytes(MAX_BUNDLE_BYTES)}.`,
      413,
    );
  }

  const eocdOffset = findEndOfCentralDirectory(zip);
  if (eocdOffset < 0) {
    throw new AppBundleError("invalid_zip", "The uploaded file is not a valid ZIP archive.");
  }

  const entryCount = zip.readUInt16LE(eocdOffset + 10);
  const centralDirectorySize = zip.readUInt32LE(eocdOffset + 12);
  const centralDirectoryOffset = zip.readUInt32LE(eocdOffset + 16);
  if (
    centralDirectoryOffset + centralDirectorySize > zip.length ||
    centralDirectoryOffset < 0
  ) {
    throw new AppBundleError("invalid_zip", "The ZIP central directory is invalid.");
  }

  const entries: ZipEntry[] = [];
  let offset = centralDirectoryOffset;
  for (let index = 0; index < entryCount; index += 1) {
    if (offset + 46 > zip.length || zip.readUInt32LE(offset) !== 0x02014b50) {
      throw new AppBundleError("invalid_zip", "The ZIP central directory is invalid.");
    }

    const method = zip.readUInt16LE(offset + 10);
    const expectedChecksum = zip.readUInt32LE(offset + 16);
    const compressedSize = zip.readUInt32LE(offset + 20);
    const uncompressedSize = zip.readUInt32LE(offset + 24);
    const nameLength = zip.readUInt16LE(offset + 28);
    const extraLength = zip.readUInt16LE(offset + 30);
    const commentLength = zip.readUInt16LE(offset + 32);
    const localOffset = zip.readUInt32LE(offset + 42);
    const nameStart = offset + 46;
    const nameEnd = nameStart + nameLength;
    if (nameEnd > zip.length) {
      throw new AppBundleError("invalid_zip", "The ZIP entry name is invalid.");
    }

    const entryPath = normalizeZipPath(zip.toString("utf-8", nameStart, nameEnd));
    offset = nameEnd + extraLength + commentLength;
    if (!entryPath || entryPath.endsWith("/")) continue;
    if (method !== ZIP_METHOD_STORE && method !== ZIP_METHOD_DEFLATE) {
      throw new AppBundleError(
        "unsupported_zip_method",
        `The ZIP entry "${entryPath}" uses an unsupported compression method.`,
        400,
      );
    }
    if (uncompressedSize > MAX_BUNDLE_BYTES) {
      throw new AppBundleError(
        "entry_too_large",
        `The ZIP entry "${entryPath}" is too large.`,
        413,
      );
    }
    if (localOffset + 30 > zip.length || zip.readUInt32LE(localOffset) !== 0x04034b50) {
      throw new AppBundleError("invalid_zip", "The ZIP local file header is invalid.");
    }
    const localNameLength = zip.readUInt16LE(localOffset + 26);
    const localExtraLength = zip.readUInt16LE(localOffset + 28);
    const dataStart = localOffset + 30 + localNameLength + localExtraLength;
    const dataEnd = dataStart + compressedSize;
    if (dataStart > zip.length || dataEnd > zip.length) {
      throw new AppBundleError("invalid_zip", "The ZIP entry data is invalid.");
    }

    const compressed = zip.subarray(dataStart, dataEnd);
    let content: Buffer;
    try {
      content =
        method === ZIP_METHOD_DEFLATE ? inflateRawSync(compressed) : compressed;
    } catch {
      throw new AppBundleError("invalid_zip", `The ZIP entry "${entryPath}" is corrupted.`);
    }
    if (content.length !== uncompressedSize) {
      throw new AppBundleError("invalid_zip", `The ZIP entry "${entryPath}" is corrupted.`);
    }
    if (crc32(content) !== expectedChecksum) {
      throw new AppBundleError("invalid_zip", `The ZIP entry "${entryPath}" is corrupted.`);
    }

    entries.push({ path: entryPath, content });
  }

  return entries;
}

export function createSecondAppBundle(input: {
  app: SecondAppBundleManifest["app"];
  files: Record<string, string>;
  runs: SecondAppBundleManifest["runs"];
}): Buffer {
  const files = filterBundleSourceFiles(input.files);
  const summary = sourceSummary(files);
  const manifest: SecondAppBundleManifest = {
    type: SECOND_APP_BUNDLE_TYPE,
    schemaVersion: 1,
    exportedAt: new Date().toISOString(),
    app: input.app,
    source: summary,
    runs: input.runs,
  };

  const entries: Array<[string, string]> = [
    [SECOND_APP_MANIFEST_PATH, JSON.stringify(manifest, null, 2)],
    ...Object.entries(files).map(
      ([path, content]): [string, string] => [
        `${SECOND_APP_FILES_PREFIX}${path}`,
        content,
      ],
    ),
  ];

  return createZip(entries);
}

export function parseSecondAppBundle(zip: Buffer): ParsedSecondAppBundle {
  const entries = parseZipEntries(zip);
  const manifestEntry = entries.find(
    (entry) => entry.path === SECOND_APP_MANIFEST_PATH,
  );
  let manifest: SecondAppBundleManifest | null = null;

  if (manifestEntry) {
    if (manifestEntry.content.length > MAX_MANIFEST_BYTES) {
      throw new AppBundleError(
        "manifest_too_large",
        "The app bundle manifest is too large.",
        413,
      );
    }
    try {
      manifest = normalizeManifest(
        JSON.parse(manifestEntry.content.toString("utf-8")) as unknown,
      );
    } catch (error) {
      if (error instanceof AppBundleError) throw error;
      throw new AppBundleError(
        "invalid_manifest",
        "The app bundle manifest is not valid JSON.",
        400,
      );
    }
  }

  const files: Record<string, string> = {};
  const plainZipRoot = manifest
    ? null
    : singlePlainZipRoot(entries.map((entry) => entry.path));
  for (const entry of entries) {
    if (entry.path === SECOND_APP_MANIFEST_PATH) continue;
    const rawPath = manifest
      ? entry.path.startsWith(SECOND_APP_FILES_PREFIX)
        ? entry.path.slice(SECOND_APP_FILES_PREFIX.length)
        : null
      : stripPlainZipRoot(entry.path, plainZipRoot);
    if (!rawPath) continue;

    const path = sanitizeImportedFilePath(rawPath);
    if (!path) continue;

    const content = decodeUtf8TextFile(path, entry.content);
    files[path] = content;
  }

  const filtered = filterBundleSourceFiles(files);
  return {
    manifest,
    files: filtered,
    runs: manifest?.runs ?? [],
  };
}

export function appBundleFilename(appName: string): string {
  const safe = appName
    .trim()
    .replace(/[^a-zA-Z0-9._ -]+/g, "")
    .replace(/\s+/g, "-")
    .slice(0, 80)
    .replace(/^-+|-+$/g, "");
  return `${safe || "second-app"}.second-app.zip`;
}
