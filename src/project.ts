import fs from "node:fs/promises";
import path from "node:path";
import { configPath, defaultConfig, loadConfig, mindkeeperRoot, writeConfig } from "./config.js";
import type { MindKeeperConfig } from "./types.js";

const SUBDIRS = [
  "knowledge",
  "diary",
  "decisions",
  "imports",
  "manifests",
  "vector",
  "cache"
] as const;

export async function ensureProjectScaffold(projectRoot: string): Promise<MindKeeperConfig> {
  const projectName = path.basename(projectRoot);
  const root = mindkeeperRoot(projectRoot);
  await fs.mkdir(root, { recursive: true });

  for (const subdir of SUBDIRS) {
    await fs.mkdir(path.join(root, subdir), { recursive: true });
  }

  try {
    await fs.access(configPath(projectRoot));
  } catch {
    await writeConfig(projectRoot, defaultConfig(projectName));
  }

  return loadConfig(projectRoot);
}
