import fs from "node:fs/promises";
import type {
  CanonicalMemorySchemaDescriptor,
  EmbeddingProfile,
  EmbeddingProfileIndexDescriptor,
  MindKeeperConfig
} from "./types.js";
import {
  CANONICAL_MEMORY_SCHEMA_VERSION,
  MINDKEEPER_LAYOUT_VERSION,
  PROFILE_INDEX_SCHEMA_VERSION,
  canonicalRoot,
  canonicalSchemaPath,
  indexesRoot,
  profileIndexDescriptorPath,
  profileIndexRoot
} from "./storage-layout.js";

export function resolveEmbeddingProfile(config: MindKeeperConfig, profileName: string): EmbeddingProfile {
  const profile = config.embeddingProfiles.find((item) => item.name === profileName);
  if (!profile) {
    throw new Error(`Unknown embedding profile "${profileName}".`);
  }
  return profile;
}

export function resolveActiveEmbeddingProfile(config: MindKeeperConfig): EmbeddingProfile {
  return resolveEmbeddingProfile(config, config.activeEmbeddingProfile);
}

export function buildCanonicalMemorySchemaDescriptor(): CanonicalMemorySchemaDescriptor {
  return {
    kind: "mindkeeper_canonical_memory",
    schemaVersion: CANONICAL_MEMORY_SCHEMA_VERSION,
    layoutVersion: MINDKEEPER_LAYOUT_VERSION,
    compatibilityMode: "model_agnostic",
    vectorOwnership: "profile_specific"
  };
}

export function buildEmbeddingProfileIndexDescriptor(profile: EmbeddingProfile): EmbeddingProfileIndexDescriptor {
  return {
    kind: "mindkeeper_profile_index",
    schemaVersion: PROFILE_INDEX_SCHEMA_VERSION,
    profileName: profile.name,
    profileKind: profile.kind,
    model: profile.model ?? null,
    baseUrl: profile.baseUrl ?? null,
    dimensions: profile.dimensions,
    compatibilityMode: "reuse_same_profile_only"
  };
}

export async function ensureProfileRegistryScaffold(projectRoot: string, config: MindKeeperConfig): Promise<void> {
  const activeProfile = resolveActiveEmbeddingProfile(config);
  await fs.mkdir(canonicalRoot(projectRoot), { recursive: true });
  await fs.mkdir(indexesRoot(projectRoot), { recursive: true });
  await fs.mkdir(profileIndexRoot(projectRoot, activeProfile.name), { recursive: true });

  await writeJsonIfChanged(canonicalSchemaPath(projectRoot), buildCanonicalMemorySchemaDescriptor());
  await writeJsonIfChanged(
    profileIndexDescriptorPath(projectRoot, activeProfile.name),
    buildEmbeddingProfileIndexDescriptor(activeProfile)
  );
}

async function writeJsonIfChanged(filePath: string, data: object): Promise<void> {
  const next = `${JSON.stringify(data, null, 2)}\n`;

  try {
    const current = await fs.readFile(filePath, "utf8");
    if (current === next) {
      return;
    }
  } catch {
    // Treat missing files as needing a write.
  }

  await fs.writeFile(filePath, next, "utf8");
}
