import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import { promisify } from "node:util";
import path from "node:path";

const execFileAsync = promisify(execFile);

test("status command returns the current module map and release-check command", async () => {
  const projectRoot = path.resolve("D:/projects/mind_keeper");
  const command =
    process.platform === "win32"
      ? execFileAsync("cmd.exe", ["/d", "/s", "/c", "npm run status"], {
          cwd: projectRoot,
          windowsHide: true
        })
      : execFileAsync("npm", ["run", "status"], {
          cwd: projectRoot,
          windowsHide: true
        });
  const { stdout } = await command;

  const jsonStart = stdout.indexOf("{");
  assert.notEqual(jsonStart, -1);
  const report = JSON.parse(stdout.slice(jsonStart)) as {
    status: string;
    phaseStatus: Record<string, string>;
    commands: Record<string, string | null>;
    keyModules: Record<string, string>;
    docs: string[];
    architecture: Record<string, string>;
    tests: { fileCount: number };
  };

  assert.equal(report.status, "ready-for-release-check");
  assert.equal(report.phaseStatus.releaseProductization, "done");
  assert.equal(report.phaseStatus.crossAgentCompatibilityDocs, "done");
  assert.equal(report.phaseStatus.crossAgentCompatibilityProfileIdentity, "done");
  assert.equal(report.phaseStatus.crossAgentCompatibilityCanonicalContract, "done");
  assert.equal(report.phaseStatus.crossAgentCompatibilityAccessSurface, "done");
  assert.equal(report.commands.releaseCheck, "npm run verify && npm run bench:check && npm run bench:suite:check");
  assert.equal(report.keyModules.memoryWrite, "src/app/memory-write-service.ts");
  assert.ok(report.docs.includes("docs/CROSS_AGENT_COMPAT.md"));
  assert.equal(report.architecture.runtimeProfileMode, "single-active-profile");
  assert.equal(report.architecture.canonicalContract, "stable-model-agnostic-descriptor");
  assert.equal(report.architecture.indexLayer, "active-profile-scaffolded-with-rebuild-guidance");
  assert.equal(report.architecture.accessSurface, "mcp-tool-and-canonical-entrypoints");
  assert.ok(report.tests.fileCount >= 1);
});

test("status command can save the current snapshot to manifests", async () => {
  const projectRoot = path.resolve("D:/projects/mind_keeper");
  const statusPath = path.join(projectRoot, ".mindkeeper", "manifests", "status-latest.json");

  const command =
    process.platform === "win32"
      ? execFileAsync("cmd.exe", ["/d", "/s", "/c", "npm run status:save"], {
          cwd: projectRoot,
          windowsHide: true
        })
      : execFileAsync("npm", ["run", "status:save"], {
          cwd: projectRoot,
          windowsHide: true
        });

  await command;

  const saved = JSON.parse(await fs.readFile(statusPath, "utf8")) as {
    status: string;
    docs: string[];
  };

  assert.equal(saved.status, "ready-for-release-check");
  assert.ok(saved.docs.includes("docs/EXTENSION_POINTS.md"));
  assert.ok(saved.docs.includes("docs/CROSS_AGENT_COMPAT.md"));
});
