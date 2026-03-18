import fs from "node:fs/promises";
import path from "node:path";
import { buildCanonicalMemoryContractDescriptor } from "./canonical-contract.js";
import { configPath, defaultConfig, loadConfig, writeConfig } from "./config.js";
import { MindKeeperStorage } from "./storage.js";
import type {
  ActiveProfileIndexState,
  CanonicalMemoryContractDescriptor,
  CanonicalMemorySchemaDescriptor,
  EmbeddingProfile,
  EmbeddingProfileIndexDescriptor,
  MindKeeperConfig,
  ProfileIndexValidationReport,
  ProfileRegistryRepairReport
} from "./types.js";
import {
  CANONICAL_MEMORY_SCHEMA_VERSION,
  MINDKEEPER_LAYOUT_VERSION,
  PROFILE_INDEX_SCHEMA_VERSION,
  canonicalContractPath,
  canonicalRoot,
  canonicalSchemaPath,
  indexesRoot,
  legacyVectorRoot,
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
  await writeJsonIfChanged(canonicalContractPath(projectRoot), buildCanonicalMemoryContractDescriptor());
  await writeJsonIfChanged(
    profileIndexDescriptorPath(projectRoot, activeProfile.name),
    buildEmbeddingProfileIndexDescriptor(activeProfile)
  );
}

export async function inspectCanonicalMemoryContract(projectRoot: string): Promise<CanonicalMemoryContractDescriptor | null> {
  return readJsonDescriptor<CanonicalMemoryContractDescriptor>(canonicalContractPath(projectRoot));
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

export async function validateActiveProfileIndex(projectRoot: string): Promise<ProfileIndexValidationReport> {
  const config = await readProjectConfig(projectRoot);
  const legacyVectorLayoutPresent = await hasDirectoryEntries(legacyVectorRoot(projectRoot));

  if (!config) {
    return {
      projectRoot,
      activeProfileIndex: null,
      severity: "error",
      recommendedAction: "repair_profile_registry",
      summary: "Mind Keeper config is missing, so the active profile index cannot be validated safely.",
      issues: ["missing_config"],
      legacyVectorLayoutPresent,
      descriptorPresent: false,
      configPresent: false
    };
  }

  let state: ActiveProfileIndexState;
  try {
    state = await inspectActiveProfileIndex(projectRoot, config);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const issues = classifyValidationIssues(message);
    return {
      projectRoot,
      activeProfileIndex: null,
      severity: "error",
      recommendedAction: "review_project_config",
      summary: issues.includes("unknown_active_embedding_profile")
        ? "The active embedding profile in config does not exist in embeddingProfiles and must be corrected before validation can continue."
        : "Mind Keeper could not interpret the active embedding profile configuration safely.",
      issues,
      legacyVectorLayoutPresent,
      descriptorPresent: false,
      configPresent: true
    };
  }
  const issues = [...state.reasons];

  if (state.status === "ready" && state.reusable) {
    return {
      projectRoot,
      activeProfileIndex: state,
      severity: "ok",
      recommendedAction: "none",
      summary: "The active profile index is healthy and reusable for the current embedding profile.",
      issues,
      legacyVectorLayoutPresent,
      descriptorPresent: state.descriptorPresent,
      configPresent: true
    };
  }

  if (state.status === "empty") {
    const recommendedAction = state.descriptorPresent ? "index_project" : "repair_profile_registry";
    return {
      projectRoot,
      activeProfileIndex: state,
      severity: state.descriptorPresent ? "warn" : "error",
      recommendedAction,
      summary: state.descriptorPresent
        ? "The active profile index is scaffolded but still empty. Index the project before relying on profile reuse."
        : "The active profile descriptor is missing, so the profile registry should be repaired before indexing.",
      issues,
      legacyVectorLayoutPresent,
      descriptorPresent: state.descriptorPresent,
      configPresent: true
    };
  }

  return {
    projectRoot,
    activeProfileIndex: state,
    severity: "error",
    recommendedAction: "rebuild_active_profile_index",
    summary: "The active profile index no longer matches the current embedding profile contract and should be rebuilt.",
    issues,
    legacyVectorLayoutPresent,
    descriptorPresent: state.descriptorPresent,
    configPresent: true
  };
}

function classifyValidationIssues(message: string): string[] {
  if (/^Unknown embedding profile "([^"]+)"/.test(message)) {
    return ["unknown_active_embedding_profile"];
  }
  return ["invalid_active_embedding_profile_config"];
}

export async function repairProfileRegistry(projectRoot: string): Promise<ProfileRegistryRepairReport> {
  const validationBefore = await validateActiveProfileIndex(projectRoot);
  const repairedPaths: string[] = [];
  const filePath = configPath(projectRoot);
  let createdConfig = false;

  if (!(await pathExists(filePath))) {
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await writeConfig(projectRoot, defaultConfig(path.basename(projectRoot)));
    createdConfig = true;
    repairedPaths.push(filePath);
  }

  const config = await loadConfig(projectRoot);
  const activeProfile = resolveActiveEmbeddingProfile(config);
  const directories = [
    canonicalRoot(projectRoot),
    indexesRoot(projectRoot),
    profileIndexRoot(projectRoot, activeProfile.name)
  ];

  for (const directoryPath of directories) {
    await fs.mkdir(directoryPath, { recursive: true });
    repairedPaths.push(directoryPath);
  }

  await writeJsonDescriptor(
    canonicalSchemaPath(projectRoot),
    buildCanonicalMemorySchemaDescriptor(),
    repairedPaths
  );
  await writeJsonDescriptor(
    canonicalContractPath(projectRoot),
    buildCanonicalMemoryContractDescriptor(),
    repairedPaths
  );
  await writeJsonDescriptor(
    profileIndexDescriptorPath(projectRoot, activeProfile.name),
    buildEmbeddingProfileIndexDescriptor(activeProfile),
    repairedPaths
  );

  const validationAfter = await validateActiveProfileIndex(projectRoot);

  return {
    projectRoot,
    createdConfig,
    activeProfileName: activeProfile.name,
    repairedPaths: Array.from(new Set(repairedPaths)),
    validationBefore,
    validationAfter
  };
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
  return readJsonDescriptor<EmbeddingProfileIndexDescriptor>(filePath);
}

async function readJsonDescriptor<T>(filePath: string): Promise<T | null> {
  try {
    const raw = await fs.readFile(filePath, "utf8");
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

async function readProjectConfig(projectRoot: string): Promise<MindKeeperConfig | null> {
  try {
    return await loadConfig(projectRoot);
  } catch {
    return null;
  }
}

async function hasDirectoryEntries(directoryPath: string): Promise<boolean> {
  try {
    const entries = await fs.readdir(directoryPath);
    return entries.length > 0;
  } catch {
    return false;
  }
}

async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

async function writeJsonDescriptor(filePath: string, data: object, repairedPaths: string[]): Promise<void> {
  await writeJsonIfChanged(filePath, data);
  repairedPaths.push(filePath);
}
