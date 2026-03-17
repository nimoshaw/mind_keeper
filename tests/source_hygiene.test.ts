import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { MindKeeperService } from "../src/mindkeeper.js";

test("disable_source and enable_source toggle whether a memory participates in recall", async () => {
  const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), "mind-keeper-source-hygiene-"));
  const service = new MindKeeperService();

  try {
    const memory = await service.remember({
      projectRoot,
      sourceKind: "manual",
      title: "Diagnostics recall note",
      content: "Prefer diagnostics-aware context recall for current-file workflows.",
      tags: ["diagnostics", "context"]
    });

    const beforeDisable = await service.recall({
      projectRoot,
      query: "diagnostics aware context recall",
      topK: 5,
      minScore: 0
    });

    assert.ok(beforeDisable.some((item) => item.docId === memory.docId));

    const disableResult = await service.disableSource({
      projectRoot,
      path: memory.path,
      reason: "Temporary noisy note during retrieval tuning."
    });

    assert.equal(disableResult.updated, true);
    assert.equal(disableResult.docId, memory.docId);

    const listedDisabled = await service.listSources(projectRoot);
    const disabledSource = listedDisabled.find((item) => item.docId === memory.docId);
    assert.ok(disabledSource);
    assert.equal(disabledSource?.isDisabled, true);
    assert.equal(disabledSource?.disabledReason, "Temporary noisy note during retrieval tuning.");

    const afterDisable = await service.recall({
      projectRoot,
      query: "diagnostics aware context recall",
      topK: 5,
      minScore: 0
    });

    assert.equal(afterDisable.some((item) => item.docId === memory.docId), false);

    const enableResult = await service.enableSource({
      projectRoot,
      docId: memory.docId
    });

    assert.equal(enableResult.updated, true);
    assert.equal(enableResult.docId, memory.docId);

    const listedEnabled = await service.listSources(projectRoot);
    const enabledSource = listedEnabled.find((item) => item.docId === memory.docId);
    assert.ok(enabledSource);
    assert.equal(enabledSource?.isDisabled, false);
    assert.equal(enabledSource?.disabledReason, null);

    const afterEnable = await service.recall({
      projectRoot,
      query: "diagnostics aware context recall",
      topK: 5,
      minScore: 0
    });

    assert.ok(afterEnable.some((item) => item.docId === memory.docId));
  } finally {
    await fs.rm(projectRoot, { recursive: true, force: true });
  }
});
