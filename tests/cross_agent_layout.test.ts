import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { writeConfig } from "../src/config.js";
import { MindKeeperService } from "../src/mindkeeper.js";
import { inspectActiveProfileIndex } from "../src/profile-registry.js";
import { ensureProjectScaffold } from "../src/project.js";

test("project scaffold creates canonical and active-profile index metadata for future cross-agent compatibility", async () => {
  const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), "mind-keeper-cross-agent-layout-"));

  try {
    const config = await ensureProjectScaffold(projectRoot);
    const canonicalSchemaPath = path.join(projectRoot, ".mindkeeper", "canonical", "schema.json");
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

    assert.equal(config.activeEmbeddingProfile, "hash-local");
    assert.equal(canonicalSchema.kind, "mindkeeper_canonical_memory");
    assert.equal(canonicalSchema.schemaVersion, 1);
    assert.equal(canonicalSchema.compatibilityMode, "model_agnostic");
    assert.equal(canonicalSchema.vectorOwnership, "profile_specific");
    assert.equal(profileDescriptor.kind, "mindkeeper_profile_index");
    assert.equal(profileDescriptor.profileName, "hash-local");
    assert.equal(profileDescriptor.dimensions, 256);
    assert.equal(profileDescriptor.compatibilityMode, "reuse_same_profile_only");
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
