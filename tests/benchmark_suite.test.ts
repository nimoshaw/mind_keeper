import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

async function createTempProject(root: string, name: string): Promise<string> {
  const projectRoot = path.join(root, name);
  await fs.mkdir(path.join(projectRoot, "src"), { recursive: true });
  await fs.writeFile(
    path.join(projectRoot, "src", "memory.ts"),
    [
      "export function remember(text: string) {",
      "  return text;",
      "}",
      "",
      "export function recall(query: string) {",
      "  return query;",
      "}"
    ].join("\n"),
    "utf8"
  );
  return projectRoot;
}

function runBenchmark(workdir: string, args: string[]): unknown {
  const output = execFileSync(
    process.execPath,
    ["--import", "tsx", "scripts/benchmark.ts", ...args],
    {
      cwd: workdir,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "inherit"]
    }
  );

  return JSON.parse(output);
}

test("suite benchmark check compares against the same profile and exposes per-project baselines", async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "mind-keeper-bench-suite-test-"));
  const historyDir = path.join(tempRoot, "history");
  const benchmarkRoot = path.resolve("D:/projects/mind_keeper");

  try {
    await createTempProject(tempRoot, "repo-a");
    const suitePath = path.join(tempRoot, "team.alpha.json");
    await fs.writeFile(
      suitePath,
      JSON.stringify(
        {
          projects: [
            {
              name: "repo-a",
              root: "./repo-a",
              query: "remember recall"
            }
          ]
        },
        null,
        2
      ),
      "utf8"
    );

    runBenchmark(benchmarkRoot, ["--suite", suitePath, "--out", path.join(tempRoot, "latest.json"), "--history-dir", historyDir]);
    const checked = runBenchmark(benchmarkRoot, ["--suite", suitePath, "--history-dir", historyDir, "--check-regressions"]) as {
      suiteProfile?: string;
      comparison?: { suiteProjects?: Array<{ name: string; baselineIndexMs: number | null; baselineRecallMs: number | null }> };
    };

    assert.equal(checked.suiteProfile, "team.alpha");
    assert.ok(checked.comparison?.suiteProjects);
    assert.equal(checked.comparison?.suiteProjects?.[0]?.name, "repo-a");
    assert.ok(typeof checked.comparison?.suiteProjects?.[0]?.baselineIndexMs === "number");
    assert.ok(typeof checked.comparison?.suiteProjects?.[0]?.baselineRecallMs === "number");
  } finally {
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
});

test("suite benchmark check is read-only and does not append history samples", async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "mind-keeper-bench-readonly-"));
  const historyDir = path.join(tempRoot, "history");
  const benchmarkRoot = path.resolve("D:/projects/mind_keeper");

  try {
    await createTempProject(tempRoot, "repo-a");
    const suitePath = path.join(tempRoot, "readonly.profile.json");
    await fs.writeFile(
      suitePath,
      JSON.stringify(
        {
          projects: [
            {
              name: "repo-a",
              root: "./repo-a",
              query: "remember recall"
            }
          ]
        },
        null,
        2
      ),
      "utf8"
    );

    runBenchmark(benchmarkRoot, ["--suite", suitePath, "--out", path.join(tempRoot, "latest.json"), "--history-dir", historyDir]);
    const before = JSON.parse(await fs.readFile(path.join(historyDir, "index.json"), "utf8")) as unknown[];
    runBenchmark(benchmarkRoot, ["--suite", suitePath, "--history-dir", historyDir, "--check-regressions"]);
    const after = JSON.parse(await fs.readFile(path.join(historyDir, "index.json"), "utf8")) as unknown[];

    assert.equal(after.length, before.length);
  } finally {
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
});
