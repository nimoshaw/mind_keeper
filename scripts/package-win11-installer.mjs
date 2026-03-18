import fs from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const packageJson = JSON.parse(await fs.readFile(path.join(repoRoot, "package.json"), "utf8"));
const portableRoot = path.join(repoRoot, "artifacts", "win11", "MindKeeper-win11-x64");
const installerOutDir = path.join(repoRoot, "artifacts", "win11-installer");
const installerScript = path.join(repoRoot, "packaging", "win11-installer.iss");

function run(command, args, cwd = repoRoot) {
  const result = spawnSync(command, args, {
    cwd,
    stdio: "pipe",
    encoding: "utf8",
    shell: process.platform === "win32"
  });

  if (result.status !== 0) {
    const output = [result.stdout, result.stderr].filter(Boolean).join("\n").trim();
    throw new Error(output || `Command failed: ${command} ${args.join(" ")}`);
  }

  return result.stdout.trim();
}

async function ensurePortablePackage() {
  try {
    await fs.access(path.join(portableRoot, "mind-keeper.exe"));
  } catch {
    run("npm", ["run", "package:win11"]);
  }
}

async function pathExists(targetPath) {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

async function findIscc() {
  const envPath = process.env.ISCC_EXE;
  if (envPath) {
    return envPath;
  }

  try {
    const output = run("where.exe", ["iscc"]);
    const first = output.split(/\r?\n/).map((line) => line.trim()).find(Boolean);
    if (first) {
      return first;
    }
  } catch {
    // Fall through to common install paths.
  }

  const candidates = [
    "C:\\Program Files (x86)\\Inno Setup 6\\ISCC.exe",
    "C:\\Program Files\\Inno Setup 6\\ISCC.exe"
  ];

  for (const candidate of candidates) {
    if (await pathExists(candidate)) {
      return candidate;
    }
  }

  return null;
}

async function main() {
  await ensurePortablePackage();
  await fs.mkdir(installerOutDir, { recursive: true });

  const iscc = await findIscc();
  if (!iscc) {
    throw new Error(
      [
        "Inno Setup 6 was not found.",
        "Install Inno Setup 6 and ensure ISCC.exe is available in PATH,",
        "or set the ISCC_EXE environment variable to the full ISCC.exe path.",
        `Portable package is ready at: ${portableRoot}`
      ].join("\n")
    );
  }

  const args = [
    `/DAppVersion=${packageJson.version}`,
    `/DSourceRoot=${portableRoot}`,
    `/O${installerOutDir}`,
    installerScript
  ];

  const output = run(iscc, args);
  const setupPath = path.join(installerOutDir, `MindKeeperSetup-${packageJson.version}-win11-x64.exe`);
  await fs.access(setupPath);

  console.log(output);
  console.log(`\n[Mind Keeper] Win11 installer ready: ${setupPath}`);
}

await main();
