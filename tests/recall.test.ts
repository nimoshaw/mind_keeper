import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { MindKeeperService } from "../src/mindkeeper.js";

test("recall can target a symbol after indexing a project", async () => {
  const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), "mind-keeper-test-project-"));
  const srcDir = path.join(projectRoot, "src");
  await fs.mkdir(srcDir, { recursive: true });

  await fs.writeFile(
    path.join(srcDir, "app.ts"),
    [
      "export class MemoryStore {",
      "  remember(text: string) {",
      "    return text;",
      "  }",
      "}",
      "",
      ...new Array(140).fill("// padding to force a later chunk for recallTask"),
      "",
      "export function recallTask(query: string) {",
      "  return query;",
      "}"
    ].join("\n"),
    "utf8"
  );

  const service = new MindKeeperService();

  try {
    await service.indexProject(projectRoot, { force: true });
    const results = await service.recall({
      projectRoot,
      query: "remember project memory text",
      symbol: "remember",
      minScore: 0,
      topK: 3,
      explain: true
    });

    assert.ok(results.length > 0);
    assert.equal(results[0]?.symbol, "remember");
    assert.match(results[0]?.path ?? "", /src[\\/]+app\.ts$/);
  } finally {
    await fs.rm(projectRoot, { recursive: true, force: true });
  }
});
