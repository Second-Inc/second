import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "..", "..");
const artifactPlatform =
  process.env.SECOND_DESKTOP_ARTIFACT_PLATFORM ?? defaultArtifactPlatform();
const runtimeId =
  process.env.SECOND_DESKTOP_RUNTIME_ID ?? defaultRuntimeId(artifactPlatform);
const macIdentity =
  process.env.CSC_LINK || process.env.CSC_NAME ? undefined : null;
const payloadDir = resolve(repoRoot, "packages", `cli-local-${runtimeId}`);
const wslRootfsPath = resolve(
  __dirname,
  "resources",
  "wsl",
  "second-wsl-rootfs.tar",
);

if (!existsSync(payloadDir)) {
  throw new Error(`Missing desktop payload directory: ${payloadDir}`);
}

const extraResources = [];

if (artifactPlatform === "windows-x64") {
  extraResources.push({
    from: wslRootfsPath,
    to: "wsl/second-wsl-rootfs.tar",
  });
} else {
  extraResources.push({
    from: payloadDir,
    to: `payloads/${runtimeId}`,
    filter: ["package.json", "bin/**", "dist/**"],
  });
}

export default {
  appId: "com.second.desktop",
  productName: "Second",
  artifactName: `Second-\${version}-${artifactPlatform}.\${ext}`,
  asar: true,
  npmRebuild: false,
  directories: {
    output: "release",
  },
  files: [
    "package.json",
    "src/main/**",
    "src/preload/**",
    "src/renderer/**",
    "node_modules/**",
  ],
  extraResources,
  afterSign: "scripts/notarize.mjs",
  mac: {
    category: "public.app-category.developer-tools",
    hardenedRuntime: true,
    gatekeeperAssess: false,
    icon: "resources/icon.icns",
    identity: macIdentity,
    entitlements: "resources/entitlements.mac.plist",
    entitlementsInherit: "resources/entitlements.mac.plist",
    target: ["dmg"],
  },
  dmg: {
    sign: false,
  },
  win: {
    target: [
      {
        target: "nsis",
        arch: ["x64"],
      },
    ],
    signAndEditExecutable: true,
  },
  nsis: {
    oneClick: false,
    perMachine: false,
    allowToChangeInstallationDirectory: true,
    createDesktopShortcut: true,
    createStartMenuShortcut: true,
  },
  linux: {
    category: "Development",
    target: [
      {
        target: "AppImage",
        arch: ["x64"],
      },
    ],
  },
};

function defaultArtifactPlatform() {
  if (process.platform === "darwin") {
    return `mac-${process.arch === "arm64" ? "arm64" : "x64"}`;
  }
  if (process.platform === "win32") return "windows-x64";
  return "linux-x64";
}

function defaultRuntimeId(platform) {
  if (platform === "mac-arm64") return "darwin-arm64";
  if (platform === "mac-x64") return "darwin-x64";
  if (platform === "linux-x64") return "linux-x64";
  if (platform === "windows-x64") return "linux-x64";
  return `${process.platform}-${process.arch}`;
}
