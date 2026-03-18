import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

type PackageJson = {
  name?: string;
  version?: string;
  scripts?: Record<string, string>;
};

async function main(): Promise<void> {
  const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const outPath = parseOutArg(process.argv.slice(2), projectRoot);
  const packageJson = JSON.parse(await fs.readFile(path.join(projectRoot, "package.json"), "utf8")) as PackageJson;
  const testFiles = await fs.readdir(path.join(projectRoot, "tests"));

  const report = {
    project: packageJson.name ?? "mind-keeper",
    version: packageJson.version ?? "0.0.0",
    status: "ready-for-release-check",
    phaseStatus: {
      refactorFoundation: "done",
      memoryDistillation: "done",
      lightWaveRecall: "done",
      fastDeepRecall: "done",
      lightweightGraph: "done",
      hygieneGovernance: "done",
      crossAgentCompatibilityDocs: "done",
      crossAgentCompatibilityProfileIdentity: "done",
      crossAgentCompatibilityCanonicalContract: "done",
      releaseProductization: "done"
    },
    commands: {
      check: packageJson.scripts?.check ?? null,
      test: packageJson.scripts?.test ?? null,
      verify: packageJson.scripts?.verify ?? null,
      releaseCheck: packageJson.scripts?.["release:check"] ?? null
    },
    keyModules: {
      facadeEntry: "src/mindkeeper.ts",
      facadeImplementation: "src/mindkeeper-facade.ts",
      memoryWrite: "src/app/memory-write-service.ts",
      projectIndex: "src/app/project-index-service.ts",
      recall: "src/app/recall-service.ts",
      session: "src/app/session-service.ts",
      hygiene: "src/app/hygiene-service.ts",
      source: "src/app/source-service.ts"
    },
    docs: [
      "README.md",
      "docs/STATUS.md",
      "docs/CAPABILITIES.md",
      "docs/EXTENSION_POINTS.md",
      "docs/CROSS_AGENT_COMPAT.md",
      "docs/MCP_TOOLS_ADDENDUM.md",
      "docs/RELEASE_ADDENDUM.md",
      "docs/QUALITY_ADDENDUM.md"
    ],
    architecture: {
      canonicalLayer: "planned-and-scaffolded",
      canonicalContract: "stable-model-agnostic-descriptor",
      indexLayer: "active-profile-scaffolded-with-rebuild-guidance",
      runtimeProfileMode: "single-active-profile",
      currentCompatibilityTrack: "storage-boundary-refinement"
    },
    tests: {
      fileCount: testFiles.filter((name) => name.endsWith(".test.ts")).length
    }
  };

  if (outPath) {
    await fs.mkdir(path.dirname(outPath), { recursive: true });
    await fs.writeFile(outPath, JSON.stringify(report, null, 2), "utf8");
  }

  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}

function parseOutArg(args: string[], projectRoot: string): string | null {
  const outIndex = args.findIndex((arg) => arg === "--out");
  if (outIndex === -1 || outIndex === args.length - 1) {
    return null;
  }

  const rawPath = args[outIndex + 1];
  return path.isAbsolute(rawPath) ? rawPath : path.resolve(projectRoot, rawPath);
}

await main();
