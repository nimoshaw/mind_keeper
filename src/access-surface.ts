import { inspectActiveProfileIndex, inspectCanonicalMemoryContract } from "./profile-registry.js";
import { ensureProjectScaffold } from "./project.js";
import { canonicalContractPath, canonicalRoot, canonicalSchemaPath } from "./storage-layout.js";
import type { MemoryAccessSurfaceReport } from "./types.js";

export async function inspectMemoryAccessSurface(projectRoot: string): Promise<MemoryAccessSurfaceReport> {
  const config = await ensureProjectScaffold(projectRoot);
  const [contract, activeProfileIndex] = await Promise.all([
    inspectCanonicalMemoryContract(projectRoot),
    inspectActiveProfileIndex(projectRoot, config)
  ]);

  return {
    projectRoot,
    canonical: {
      root: canonicalRoot(projectRoot),
      schemaPath: canonicalSchemaPath(projectRoot),
      contractPath: canonicalContractPath(projectRoot),
      schemaVersion: contract?.schemaVersion ?? null,
      contractFieldCount: contract?.fields.length ?? null,
      governanceSignals: contract?.governanceSignals ?? []
    },
    activeProfileIndex,
    runtimeRules: {
      profileMode: "single_active_profile",
      vectorOwnership: "profile_specific",
      sharedLayer: "canonical_memory"
    },
    compatibilityLevels: [
      {
        level: "same_agent_same_profile",
        canonicalReuse: true,
        indexReuse: activeProfileIndex.reusable,
        note: "The same agent and profile can reuse canonical memory and the existing active-profile index."
      },
      {
        level: "different_agent_same_profile",
        canonicalReuse: true,
        indexReuse: activeProfileIndex.reusable,
        note: "A different agent may reuse the active-profile index only when the profile contract and chunking expectations match."
      },
      {
        level: "different_agent_different_profile",
        canonicalReuse: true,
        indexReuse: false,
        note: "A different embedding profile should reuse canonical memory but rebuild its own index."
      }
    ],
    recommendedAccess: {
      primary: ["inspect_memory_access_surface", "list_sources", "recall", "context_for_task"],
      externalReadersShouldAvoid: [
        "reading_profile_vectors_as_truth",
        "runtime_multi_profile_queries",
        "guessing_schema_from_directory_names"
      ]
    }
  };
}
