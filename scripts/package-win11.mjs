import fs from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const packageJsonPath = path.join(repoRoot, "package.json");
const packageJson = JSON.parse(await fs.readFile(packageJsonPath, "utf8"));
const appName = "MindKeeper";
const arch = process.arch === "x64" ? "x64" : process.arch;
const releaseRoot = path.join(repoRoot, "artifacts", "win11", `${appName}-win11-${arch}`);
const appRoot = path.join(releaseRoot, "app");
const exePath = path.join(releaseRoot, "mind-keeper.exe");
const releaseNotesPath = path.join(releaseRoot, "WIN11_RELEASE.md");
const manifestPath = path.join(releaseRoot, "release-manifest.json");
const mcpConfigExamplePath = path.join(releaseRoot, "mcp-client-config.example.json");

function run(command, args, cwd = repoRoot) {
  const result = spawnSync(command, args, {
    cwd,
    stdio: "inherit",
    shell: process.platform === "win32"
  });

  if (result.status !== 0) {
    throw new Error(`Command failed: ${command} ${args.join(" ")}`);
  }
}

async function ensureBuild() {
  const distEntry = path.join(repoRoot, "dist", "index.js");
  try {
    await fs.access(distEntry);
  } catch {
    run("npm", ["run", "build"]);
  }
}

async function copyIntoRelease() {
  await fs.rm(releaseRoot, { recursive: true, force: true });
  await fs.mkdir(appRoot, { recursive: true });

  await fs.cp(path.join(repoRoot, "dist"), path.join(appRoot, "dist"), { recursive: true });
  const runtimePackageJson = {
    name: packageJson.name,
    version: packageJson.version,
    private: true,
    description: packageJson.description,
    type: packageJson.type,
    engines: packageJson.engines,
    dependencies: packageJson.dependencies
  };

  await fs.writeFile(path.join(appRoot, "package.json"), JSON.stringify(runtimePackageJson, null, 2));
  await fs.copyFile(path.join(repoRoot, "README.md"), path.join(releaseRoot, "README.md"));
  await fs.copyFile(path.join(repoRoot, "docs", "WIN11_RELEASE.md"), releaseNotesPath);
}

async function installRuntimeDependencies() {
  run("npm", ["install", "--omit=dev", "--package-lock=false"], appRoot);
}

async function buildLauncher() {
  run("npx", [
    "@yao-pkg/pkg",
    "scripts/win11-launcher.cjs",
    "--target",
    "host",
    "--no-bytecode",
    "--public",
    "--public-packages",
    "*",
    "--output",
    exePath
  ]);
}

async function writeManifest() {
  const manifest = {
    name: packageJson.name,
    version: packageJson.version,
    platform: process.platform,
    arch,
    node: process.version,
    packagedAt: new Date().toISOString(),
    executable: "mind-keeper.exe",
    appEntry: "app/dist/index.js"
  };

  await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2));
}

async function writeMcpConfigExample() {
  const configExample = {
    command: "C:/Program Files/Mind Keeper/mind-keeper.exe",
    args: [],
    notes: [
      "Replace the command path if you are using the portable zip instead of the installed Setup.exe build.",
      "For the portable zip, point command directly at that extracted mind-keeper.exe."
    ]
  };

  await fs.writeFile(mcpConfigExamplePath, JSON.stringify(configExample, null, 2));
}

async function verifyExecutable() {
  const result = spawnSync(exePath, ["--self-check"], {
    cwd: releaseRoot,
    encoding: "utf8",
    shell: false
  });

  if (result.status !== 0) {
    throw new Error(result.stderr || result.stdout || "Packaged executable self-check failed.");
  }

  const output = JSON.parse(result.stdout);
  if (output.name !== packageJson.name || output.version !== packageJson.version) {
    throw new Error("Packaged executable returned an unexpected self-check payload.");
  }
}

async function main() {
  await ensureBuild();
  await copyIntoRelease();
  await installRuntimeDependencies();
  await buildLauncher();
  await writeManifest();
  await writeMcpConfigExample();
  await verifyExecutable();

  console.log(`\n[Mind Keeper] Win11 package ready: ${releaseRoot}`);
}

await main();
