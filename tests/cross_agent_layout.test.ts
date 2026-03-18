import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { inspectMemoryAccessSurface } from "../src/access-surface.js";
import { writeConfig } from "../src/config.js";
import { MindKeeperService } from "../src/mindkeeper.js";
import {
  inspectActiveProfileIndex,
  inspectCanonicalMemoryContract,
  repairProfileRegistry,
  validateActiveProfileIndex
} from "../src/profile-registry.js";
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

test("canonical memory export excludes project content by default and can include manual content safely", async () => {
  const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), "mind-keeper-canonical-export-"));
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
      content: "Canonical export manual note content.",
      sourceKind: "manual",
      title: "Exportable manual note",
      tags: ["export"]
    });

    const withoutProjectContent = await service.exportCanonicalMemory(projectRoot, {
      includeContent: true,
      limit: 10
    });
    const projectItem = withoutProjectContent.items.find((item) => item.sourceKind === "project");
    const manualItem = withoutProjectContent.items.find((item) => item.sourceKind === "manual");

    assert.ok(projectItem);
    assert.equal(projectItem?.contentIncluded, false);
    assert.equal(projectItem?.content, null);
    assert.ok(manualItem);
    assert.equal(manualItem?.contentIncluded, true);
    assert.equal(manualItem?.content, "Canonical export manual note content.");

    const withProjectContent = await service.exportCanonicalMemory(projectRoot, {
      includeContent: true,
      includeProjectContent: true,
      sourceKinds: ["project"],
      limit: 10
    });
    assert.equal(withProjectContent.items.length, 1);
    assert.equal(withProjectContent.items[0]?.sourceKind, "project");
    assert.equal(withProjectContent.items[0]?.contentIncluded, true);
    assert.ok((withProjectContent.items[0]?.content ?? "").includes("export function remember"));
  } finally {
    await fs.rm(projectRoot, { recursive: true, force: true });
  }
});

test("profile index validation reports a healthy active profile as reusable", async () => {
  const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), "mind-keeper-profile-validate-ready-"));
  const service = new MindKeeperService();
  const srcDir = path.join(projectRoot, "src");

  await fs.mkdir(srcDir, { recursive: true });
  await fs.writeFile(path.join(srcDir, "memory.ts"), "export const reusable = true;\n", "utf8");

  try {
    await ensureProjectScaffold(projectRoot);
    await service.indexProject(projectRoot, { force: true });

    const report = await validateActiveProfileIndex(projectRoot);
    assert.equal(report.severity, "ok");
    assert.equal(report.recommendedAction, "none");
    assert.equal(report.activeProfileIndex?.status, "ready");
    assert.equal(report.activeProfileIndex?.reusable, true);
    assert.equal(report.configPresent, true);
  } finally {
    await fs.rm(projectRoot, { recursive: true, force: true });
  }
});

test("profile index validation recommends a rebuild after active profile drift", async () => {
  const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), "mind-keeper-profile-validate-drift-"));
  const service = new MindKeeperService();
  const srcDir = path.join(projectRoot, "src");

  await fs.mkdir(srcDir, { recursive: true });
  await fs.writeFile(path.join(srcDir, "memory.ts"), "export const drift = true;\n", "utf8");

  try {
    const initialConfig = await ensureProjectScaffold(projectRoot);
    await service.indexProject(projectRoot, { force: true });
    await writeConfig(projectRoot, {
      ...initialConfig,
      activeEmbeddingProfile: "embedding-cheap"
    });

    const report = await validateActiveProfileIndex(projectRoot);
    assert.equal(report.severity, "error");
    assert.equal(report.recommendedAction, "rebuild_active_profile_index");
    assert.ok(report.issues.includes("manifest_profile_drift"));
    assert.equal(report.activeProfileIndex?.profileName, "embedding-cheap");
  } finally {
    await fs.rm(projectRoot, { recursive: true, force: true });
  }
});

test("profile index validation recommends repairing the registry when config is missing", async () => {
  const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), "mind-keeper-profile-validate-missing-config-"));

  try {
    const report = await validateActiveProfileIndex(projectRoot);
    assert.equal(report.severity, "error");
    assert.equal(report.recommendedAction, "repair_profile_registry");
    assert.equal(report.activeProfileIndex, null);
    assert.equal(report.configPresent, false);
    assert.ok(report.issues.includes("missing_config"));
  } finally {
    await fs.rm(projectRoot, { recursive: true, force: true });
  }
});

test("active profile rebuild reindexes canonical sources under the new embedding profile", async () => {
  const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), "mind-keeper-profile-rebuild-"));
  const service = new MindKeeperService();
  const srcDir = path.join(projectRoot, "src");
  const filePath = path.join(srcDir, "memory.ts");

  await fs.mkdir(srcDir, { recursive: true });
  await fs.writeFile(
    filePath,
    [
      "export function remember(text: string) {",
      "  return text.trim();",
      "}"
    ].join("\n"),
    "utf8"
  );

  try {
    const initialConfig = await ensureProjectScaffold(projectRoot);
    await service.indexProject(projectRoot, { force: true });
    await service.remember({
      projectRoot,
      content: "Canonical manual memory that should survive an active-profile rebuild.",
      sourceKind: "manual",
      title: "Rebuild-safe memory"
    });
    await writeConfig(projectRoot, {
      ...initialConfig,
      activeEmbeddingProfile: "hash-alt",
      embeddingProfiles: [
        ...initialConfig.embeddingProfiles,
        {
          name: "hash-alt",
          kind: "hash",
          dimensions: 256
        }
      ]
    });

    const before = await validateActiveProfileIndex(projectRoot);
    assert.equal(before.recommendedAction, "rebuild_active_profile_index");

    const rebuild = await service.rebuildActiveProfileIndex(projectRoot);
    assert.equal(rebuild.profileName, "hash-alt");
    assert.equal(rebuild.validationBefore.recommendedAction, "rebuild_active_profile_index");
    assert.equal(rebuild.validationAfter.recommendedAction, "none");
    assert.equal(rebuild.validationAfter.activeProfileIndex?.status, "ready");
    assert.ok(rebuild.rebuiltSourceCounts.manual >= 1);
    assert.ok(rebuild.projectIndexResult.indexedFiles >= 1);
  } finally {
    await fs.rm(projectRoot, { recursive: true, force: true });
  }
});

test("profile registry repair recreates missing descriptors for the active profile", async () => {
  const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), "mind-keeper-profile-repair-descriptor-"));
  const service = new MindKeeperService();
  const srcDir = path.join(projectRoot, "src");

  await fs.mkdir(srcDir, { recursive: true });
  await fs.writeFile(path.join(srcDir, "memory.ts"), "export const repairable = true;\n", "utf8");

  try {
    await ensureProjectScaffold(projectRoot);
    await service.indexProject(projectRoot, { force: true });
    const descriptorPath = path.join(projectRoot, ".mindkeeper", "indexes", "hash-local", "profile.json");
    await fs.rm(descriptorPath, { force: true });

    const before = await validateActiveProfileIndex(projectRoot);
    assert.equal(before.recommendedAction, "rebuild_active_profile_index");
    assert.ok(before.issues.includes("missing_descriptor"));

    const repair = await repairProfileRegistry(projectRoot);
    assert.equal(repair.createdConfig, false);
    assert.equal(repair.activeProfileName, "hash-local");
    assert.ok(repair.repairedPaths.includes(descriptorPath));
    assert.equal(repair.validationAfter.activeProfileIndex?.descriptorPresent, true);
  } finally {
    await fs.rm(projectRoot, { recursive: true, force: true });
  }
});

test("profile registry repair recreates a missing config and canonical metadata", async () => {
  const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), "mind-keeper-profile-repair-config-"));

  try {
    const repair = await repairProfileRegistry(projectRoot);
    const createdConfigPath = path.join(projectRoot, ".mindkeeper", "config.toml");
    const contractPath = path.join(projectRoot, ".mindkeeper", "canonical", "contract.json");

    assert.equal(repair.createdConfig, true);
    assert.equal(repair.validationBefore.recommendedAction, "repair_profile_registry");
    assert.ok(repair.repairedPaths.includes(createdConfigPath));
    assert.ok(repair.repairedPaths.includes(contractPath));
    assert.equal(repair.validationAfter.configPresent, true);
  } finally {
    await fs.rm(projectRoot, { recursive: true, force: true });
  }
});
