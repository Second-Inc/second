import { build } from "esbuild";
import {
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readlinkSync,
  readdirSync,
  rmSync,
} from "node:fs";
import { spawn } from "node:child_process";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..", "..", "..");
const cliRoot = join(__dirname, "..");
const args = process.argv.slice(2);
const outIndex = args.indexOf("--out");
const runtimeId = readFlag("--runtime-id");
const cliDist =
  outIndex === -1
    ? join(cliRoot, "dist")
    : resolve(process.cwd(), args[outIndex + 1] ?? "dist");
const webAppDir = join(root, "apps", "web");

function run(cmd, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, {
      cwd: options.cwd,
      env: process.env,
      stdio: "inherit",
    });

    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) {
        resolve();
        return;
      }

      reject(new Error(`${cmd} ${args.join(" ")} exited with code ${code}`));
    });
  });
}

await build({
  entryPoints: [join(root, "apps/worker/src/index.ts")],
  bundle: true,
  platform: "node",
  target: "node20",
  format: "esm",
  outfile: join(cliDist, "worker.mjs"),
  external: ["@img/sharp-*", "sharp"],
  banner: {
    js: "import{createRequire as __cr}from'module';const require=__cr(import.meta.url);",
  },
});

console.log(`Worker bundled -> ${join(cliDist, "worker.mjs")}`);

console.log("Building Next standalone web server...");
await run("npm", ["--prefix", webAppDir, "run", "build"]);

const standaloneDir = join(webAppDir, ".next", "standalone");
const standaloneServer = join(standaloneDir, "server.js");

if (!existsSync(standaloneServer)) {
  throw new Error(
    `Expected Next standalone server at ${standaloneServer}. Check apps/web/next.config.ts output setting.`,
  );
}

const webDist = join(cliDist, "web");
rmSync(webDist, { recursive: true, force: true });
mkdirSync(webDist, { recursive: true });
cpSync(standaloneDir, webDist, { recursive: true });
materializeStandaloneExternalModules({
  sourceRoot: standaloneDir,
  targetRoot: webDist,
});

const staticDir = join(webAppDir, ".next", "static");
if (existsSync(staticDir)) {
  cpSync(staticDir, join(webDist, ".next", "static"), {
    recursive: true,
  });
}

const publicDir = join(webAppDir, "public");
if (existsSync(publicDir)) {
  cpSync(publicDir, join(webDist, "public"), {
    recursive: true,
  });
}

console.log(`Web bundled -> ${webDist}`);

if (process.env.SECOND_CLI_SKIP_BUNDLED_RUNTIME === "1") {
  rmSync(join(cliDist, "runtime"), { recursive: true, force: true });
  console.log("Runtime bundle skipped; expecting @second-inc/runtime-* optional dependency.");
} else {
  console.log("Bundling local runtime binaries...");
  const prepareRuntimeArgs = [
    join(cliRoot, "scripts", "prepare-runtime.mjs"),
    "--out",
    join(cliDist, "runtime"),
  ];
  if (runtimeId) {
    prepareRuntimeArgs.push("--runtime-id", runtimeId);
  }
  await run("node", prepareRuntimeArgs);
}

function readFlag(name) {
  const index = args.indexOf(name);
  if (index === -1) return undefined;
  const value = args[index + 1];
  return value && !value.startsWith("-") ? value : undefined;
}

function materializeStandaloneExternalModules({ sourceRoot, targetRoot }) {
  const sourceModules = join(sourceRoot, ".next", "node_modules");
  const targetModules = join(targetRoot, ".next", "node_modules");

  if (!existsSync(sourceModules)) return;

  rmSync(targetModules, { recursive: true, force: true });
  mkdirSync(targetModules, { recursive: true });

  for (const entry of readdirSync(sourceModules)) {
    const sourcePath = join(sourceModules, entry);
    const targetPath = join(targetModules, entry);
    const stat = lstatSync(sourcePath);

    if (stat.isSymbolicLink()) {
      const linkedPath = resolve(dirname(sourcePath), readlinkSync(sourcePath));
      cpSync(linkedPath, targetPath, { recursive: true });
      continue;
    }

    cpSync(sourcePath, targetPath, { recursive: true });
  }
}
