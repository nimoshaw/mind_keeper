import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
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
