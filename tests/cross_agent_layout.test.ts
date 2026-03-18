import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { inspectMemoryAccessSurface } from "../src/access-surface.js";
import { writeConfig } from "../src/config.js";
import { MindKeeperService } from "../src/mindkeeper.js";
import { inspectActiveProfileIndex, inspectCanonicalMemoryContract } from "../src/profile-registry.js";
import { ensureProjectScaffold } from "../src/project.js";

test("project scaffold creates canonical and active-profile index metadata for future cross-agent compatibility", async () => {
  const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), "mind-keeper-cross-agent-layout-"));

  try {
    const config = await ensureProjectScaffold(projectRoot);
    const canonicalSchemaPath = path.join(projectRoot, ".mindkeeper", "canonical", "schema.json");
    const canonicalContractPath = path.join(projectRoot, ".mindkeeper", "canonical", "contract.json");
    const profilePath = path.join(projectRoot, ".mindkeeper", "indexes", "hash-local", "profile.json");

    const canonicalSchema = JSON.parse(await fs.readFile(canonicalSchemaPath, "utf8")) as {
      kind: string;
      schemaVersion: number;
      compatibilityMode: string;
      vectorOwnership: string;
    };
    const profileDescriptor = JSON.parse(await fs.readFile(profilePath, "utf8")) as {
      kind: string;
      profileName: string;
      dimensions: number;
      compatibilityMode: string;
    };
    const canonicalContract = JSON.parse(await fs.readFile(canonicalContractPath, "utf8")) as {
      kind: string;
      partitions: string[];
      fields: Array<{ name: string }>;
      lifecycle: { runtimeProfileMode: string };
    };

    assert.equal(config.activeEmbeddingProfile, "hash-local");
    assert.equal(canonicalSchema.kind, "mindkeeper_canonical_memory");
    assert.equal(canonicalSchema.schemaVersion, 1);
    assert.equal(canonicalSchema.compatibilityMode, "model_agnostic");
    assert.equal(canonicalSchema.vectorOwnership, "profile_specific");
    assert.equal(profileDescriptor.kind, "mindkeeper_profile_index");
    assert.equal(profileDescriptor.profileName, "hash-local");
    assert.equal(profileDescriptor.dimensions, 256);
    assert.equal(profileDescriptor.compatibilityMode, "reuse_same_profile_only");
    assert.equal(canonicalContract.kind, "mindkeeper_canonical_contract");
    assert.equal(canonicalContract.lifecycle.runtimeProfileMode, "single_active_profile");
    assert.ok(canonicalContract.partitions.includes("project"));
    assert.ok(canonicalContract.fields.some((field) => field.name === "docId"));
    assert.ok(canonicalContract.fields.some((field) => field.name === "memoryTier"));
  } finally {
    await fs.rm(projectRoot, { recursive: true, force: true });
  }
});

test("active profile index state reports rebuild guidance after the embedding profile changes", async () => {
  const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), "mind-keeper-cross-agent-profile-"));
  const service = new MindKeeperService();
  const srcDir = path.join(projectRoot, "src");
  const filePath = path.join(srcDir, "memory.ts");

  await fs.mkdir(srcDir, { recursive: true });
  await fs.writeFile(
    filePath,
    [
      "export function remember(text: string) {",
      "  return text;",
      "}"
    ].join("\n"),
    "utf8"
  );

  try {
    let config = await ensureProjectScaffold(projectRoot);
    await service.indexProject(projectRoot, { force: true });

    let state = await inspectActiveProfileIndex(projectRoot, config);
    assert.equal(state.status, "ready");
    assert.equal(state.reusable, true);
    assert.equal(state.activeProfileManifestCount, state.totalManifestCount);

    await writeConfig(projectRoot, {
      ...config,
      activeEmbeddingProfile: "embedding-cheap"
    });

    config = await ensureProjectScaffold(projectRoot);
    state = await inspectActiveProfileIndex(projectRoot, config);
    assert.equal(state.profileName, "embedding-cheap");
    assert.equal(state.status, "rebuild_required");
    assert.equal(state.reusable, false);
    assert.ok(state.reasons.includes("manifest_profile_drift"));
    assert.equal(state.activeProfileManifestCount, 0);
    assert.ok(state.totalManifestCount >= 1);
  } finally {
    await fs.rm(projectRoot, { recursive: true, force: true });
  }
});

test("canonical memory contract can be inspected as a stable model-agnostic schema descriptor", async () => {
  const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), "mind-keeper-canonical-contract-"));

  try {
    await ensureProjectScaffold(projectRoot);
    const contract = await inspectCanonicalMemoryContract(projectRoot);

    assert.ok(contract);
    assert.equal(contract?.kind, "mindkeeper_canonical_contract");
    assert.equal(contract?.schemaVersion, 1);
    assert.equal(contract?.canonicalFiles.contractPath, ".mindkeeper/canonical/contract.json");
    assert.ok(contract?.governanceSignals.includes("superseded"));
    assert.ok(contract?.fields.some((field) => field.name === "conflictSubjects"));
  } finally {
    await fs.rm(projectRoot, { recursive: true, force: true });
  }
});

test("memory access surface exposes canonical paths, active profile state, and safe compatibility rules", async () => {
  const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), "mind-keeper-access-surface-"));
  const service = new MindKeeperService();
  const srcDir = path.join(projectRoot, "src");

  await fs.mkdir(srcDir, { recursive: true });
  await fs.writeFile(path.join(srcDir, "memory.ts"), "export const remembered = true;\n", "utf8");

  try {
    await ensureProjectScaffold(projectRoot);
    await service.indexProject(projectRoot, { force: true });

    const report = await inspectMemoryAccessSurface(projectRoot);
    assert.equal(report.runtimeRules.profileMode, "single_active_profile");
    assert.equal(report.runtimeRules.sharedLayer, "canonical_memory");
    assert.ok(report.canonical.contractPath.endsWith(path.join(".mindkeeper", "canonical", "contract.json")));
    assert.ok((report.canonical.contractFieldCount ?? 0) > 5);
    assert.equal(report.activeProfileIndex.status, "ready");
    assert.ok(report.compatibilityLevels.some((level) => level.level === "different_agent_different_profile" && level.indexReuse === false));
    assert.ok(report.recommendedAccess.primary.includes("inspect_memory_access_surface"));
  } finally {
    await fs.rm(projectRoot, { recursive: true, force: true });
  }
});

test("canonical memory inspection summarizes source kinds, tiers, branches, and recent entries", async () => {
  const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), "mind-keeper-canonical-inspect-"));
  const service = new MindKeeperService();
  const srcDir = path.join(projectRoot, "src");
  const filePath = path.join(srcDir, "memory.ts");

  await fs.mkdir(srcDir, { recursive: true });
  await fs.writeFile(
    filePath,
    [
      "export function remember(text: string) {",
      "  return text;",
      "}"
    ].join("\n"),
    "utf8"
  );

  try {
    await ensureProjectScaffold(projectRoot);
    await service.indexProject(projectRoot, { force: true });
    await service.remember({
      projectRoot,
      content: "Stable local workflow note for canonical inspection.",
      sourceKind: "manual",
      title: "Canonical workflow note",
      tags: ["workflow"]
    });
    const decision = await service.rememberDecision({
      projectRoot,
      title: "Canonical decision",
      decision: "Use canonical inspection before cross-agent reuse.",
      tags: ["compatibility"]
    });
    await service.disableSource({
      projectRoot,
      docId: decision.docId
    });

    const report = await service.inspectCanonicalMemory(projectRoot, { recentLimit: 3 });
    assert.ok(report.totalSources >= 3);
    assert.ok(report.activeSources >= 2);
    assert.ok(report.disabledSources >= 1);
    assert.ok(report.sourceKindSummary.some((item) => item.sourceKind === "project" && item.count >= 1));
    assert.ok(report.sourceKindSummary.some((item) => item.sourceKind === "decision" && item.disabledCount >= 1));
    assert.ok(report.tierSummary.some((item) => item.memoryTier === "stable"));
    assert.ok(report.branchSummary.length >= 1);
    assert.ok(report.recentSources.length <= 3);
    assert.ok(report.recentSources.some((item) => item.sourceKind === "decision" && item.isDisabled));
  } finally {
    await fs.rm(projectRoot, { recursive: true, force: true });
  }
});
