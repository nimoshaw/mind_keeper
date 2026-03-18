import fs from "node:fs/promises";
import { MindKeeperStorage } from "./storage.js";
import type {
  ActiveProfileIndexState,
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

export async function inspectActiveProfileIndex(projectRoot: string, config: MindKeeperConfig): Promise<ActiveProfileIndexState> {
  const activeProfile = resolveActiveEmbeddingProfile(config);
  const descriptorPath = profileIndexDescriptorPath(projectRoot, activeProfile.name);
  const descriptor = await readProfileDescriptor(descriptorPath);
  const reasons: string[] = [];

  if (!descriptor) {
    reasons.push("missing_descriptor");
  } else {
    if (descriptor.profileName !== activeProfile.name) {
      reasons.push("descriptor_profile_mismatch");
    }
    if (descriptor.profileKind !== activeProfile.kind) {
      reasons.push("descriptor_kind_mismatch");
    }
    if (descriptor.dimensions !== activeProfile.dimensions) {
      reasons.push("descriptor_dimension_mismatch");
    }
    if ((descriptor.model ?? null) !== (activeProfile.model ?? null)) {
      reasons.push("descriptor_model_mismatch");
    }
    if ((descriptor.baseUrl ?? null) !== (activeProfile.baseUrl ?? null)) {
      reasons.push("descriptor_base_url_mismatch");
    }
  }

  const storage = new MindKeeperStorage(projectRoot);
  try {
    const totalManifestCount = storage.countManifests();
    const activeProfileManifestCount = storage.countManifestsForEmbeddingProfile(activeProfile.name);

    if (totalManifestCount === 0) {
      return {
        profileName: activeProfile.name,
        profileKind: activeProfile.kind,
        dimensions: activeProfile.dimensions,
        model: activeProfile.model ?? null,
        descriptorPath,
        descriptorPresent: Boolean(descriptor),
        status: "empty",
        reusable: false,
        totalManifestCount,
        activeProfileManifestCount,
        reasons
      };
    }

    if (activeProfileManifestCount < totalManifestCount) {
      reasons.push("manifest_profile_drift");
    }

    return {
      profileName: activeProfile.name,
      profileKind: activeProfile.kind,
      dimensions: activeProfile.dimensions,
      model: activeProfile.model ?? null,
      descriptorPath,
      descriptorPresent: Boolean(descriptor),
      status: reasons.length === 0 ? "ready" : "rebuild_required",
      reusable: reasons.length === 0,
      totalManifestCount,
      activeProfileManifestCount,
      reasons
    };
  } finally {
    storage.close();
  }
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

async function readProfileDescriptor(filePath: string): Promise<EmbeddingProfileIndexDescriptor | null> {
  try {
    const raw = await fs.readFile(filePath, "utf8");
    return JSON.parse(raw) as EmbeddingProfileIndexDescriptor;
  } catch {
    return null;
  }
}
