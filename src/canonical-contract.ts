import type { CanonicalMemoryContractDescriptor, CanonicalMemoryFieldDescriptor } from "./types.js";
import { MINDKEEPER_LAYOUT_VERSION } from "./storage-layout.js";

const CANONICAL_FIELDS: CanonicalMemoryFieldDescriptor[] = [
  {
    name: "docId",
    type: "string",
    required: true,
    description: "Stable document identifier for one memory asset."
  },
  {
    name: "sourceKind",
    type: "manual | decision | diary | project | imported",
    required: true,
    description: "Semantic source partition for the memory asset."
  },
  {
    name: "title",
    type: "string | null",
    required: false,
    description: "Optional display title for the memory."
  },
  {
    name: "relativePath",
    type: "string | null",
    required: false,
    description: "Project-relative path for the underlying source file when available."
  },
  {
    name: "contentHash",
    type: "string",
    required: true,
    description: "Hash of the persisted content or indexed source payload."
  },
  {
    name: "updatedAt",
    type: "number",
    required: true,
    description: "Last known update timestamp in Unix milliseconds."
  },
  {
    name: "moduleName",
    type: "string | null",
    required: false,
    description: "Top-level project module or subsystem hint."
  },
  {
    name: "symbol",
    type: "string | null",
    required: false,
    description: "Primary symbol associated with the memory or indexed source."
  },
  {
    name: "branchName",
    type: "string | null",
    required: false,
    description: "Git branch context for the memory when available."
  },
  {
    name: "tags",
    type: "string[]",
    required: true,
    description: "User or system tags used for filtering and governance."
  },
  {
    name: "memoryTier",
    type: "working | stable | project | cold | null",
    required: false,
    description: "Lifecycle tier used by retrieval and hygiene systems."
  },
  {
    name: "stabilityScore",
    type: "number | null",
    required: false,
    description: "Normalized stability signal used to prefer durable memory."
  },
  {
    name: "distillKind",
    type: "discard | diary | decision | knowledge | null",
    required: false,
    description: "Write-time distillation result when the memory came from session summarization."
  },
  {
    name: "distillConfidence",
    type: "number | null",
    required: false,
    description: "Confidence score for the distillation output."
  },
  {
    name: "disabled",
    type: "boolean",
    required: true,
    description: "Whether the source is currently disabled from recall."
  },
  {
    name: "disabledReason",
    type: "string | null",
    required: false,
    description: "Human-readable reason for a disabled source."
  },
  {
    name: "helpfulVotes",
    type: "number",
    required: true,
    description: "Positive feedback count attached to the memory source."
  },
  {
    name: "noisyVotes",
    type: "number",
    required: true,
    description: "Negative feedback count attached to the memory source."
  },
  {
    name: "supersededBy",
    type: "string | null",
    required: false,
    description: "Canonical replacement document id when this memory has been superseded."
  },
  {
    name: "conflictSubjects",
    type: "string[]",
    required: false,
    description: "Detected conflict subjects used by conflict-aware governance."
  }
];

export function buildCanonicalMemoryContractDescriptor(): CanonicalMemoryContractDescriptor {
  return {
    kind: "mindkeeper_canonical_contract",
    schemaVersion: 1,
    layoutVersion: MINDKEEPER_LAYOUT_VERSION,
    partitions: ["knowledge", "diary", "decisions", "imports", "project"],
    canonicalFiles: {
      schemaPath: ".mindkeeper/canonical/schema.json",
      contractPath: ".mindkeeper/canonical/contract.json"
    },
    lifecycle: {
      truthLayer: "canonical_memory",
      indexLayer: "profile_specific_indexes",
      runtimeProfileMode: "single_active_profile"
    },
    governanceSignals: [
      "disabled",
      "feedback",
      "superseded",
      "conflict_subjects",
      "memory_tier",
      "stability_score"
    ],
    fields: CANONICAL_FIELDS
  };
}
