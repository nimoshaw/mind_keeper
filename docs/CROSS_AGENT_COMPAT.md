# Mind Keeper Cross-Agent Compatibility V1

This document captures the minimal, safe way to introduce cross-agent compatibility without weakening Mind Keeper's core wave-recall behavior.

The goal is not to turn Mind Keeper into a multi-agent orchestration platform.

The goal is to make project memory a durable asset that can survive:

- switching from one IDE agent to another
- changing the embedding model for the same project
- handing a project over to a different toolchain later

## Product Position

This work should be treated as a data-layer refinement inside the existing MCP memory plugin.

It is not a product pivot.

It should stay intentionally narrow:

- separate memory truth from index cache
- make index ownership explicit per embedding profile
- define a minimal canonical schema
- keep runtime retrieval bound to one active profile

If we stay inside that boundary, the feature remains aligned with the current product shape.

## Why A Directory Is Not Enough

Other agents may already be able to see `.mindkeeper`, but that does not mean they can safely reuse it.

Without an explicit compatibility boundary, another agent cannot reliably know:

- which files are memory truth versus model-specific cache
- which embedding model produced the current vectors
- whether the index is stale
- how to interpret disabled, superseded, or conflicting memories
- what schema version the metadata follows

So the presence of a project-local directory creates a chance for interoperability, but not a contract.

## Core Principle

Mind Keeper should share memory assets, not vector space.

That means:

- canonical memory can be shared
- vector indexes remain profile-specific
- runtime wave recall uses only one active profile at a time

This avoids two failure modes:

- mixed semantic spaces across embedding models
- runtime slowdowns from querying multiple indexes in one task flow

## The Clean Cut

The clean insertion point is the storage boundary, not the wave engine.

Do not cut into:

- intent planning
- confidence stopping
- per-wave budgeting
- conflict-aware wave gating
- adaptive deep wave opening
- memory mesh expansion

Those systems are the main source of product quality and should continue to operate on a stable candidate set abstraction.

The correct cut is below them:

- a canonical memory layer
- a profile-specific index layer
- a registry that knows which profile is active

## Target Layering

### 1. Canonical Memory Layer

This is the model-agnostic truth for project memory.

It should hold:

- raw memory text or source references
- titles and summaries
- tags
- module and symbol metadata
- branch metadata
- tier and stability metadata
- source health signals
- conflict and superseded state
- schema version and migration state

This is the part that should remain reusable across agents.

### 2. Index Layer

This is model-specific retrieval infrastructure.

Each embedding profile owns its own:

- chunks
- embeddings
- vector indexes
- lexical retrieval artifacts
- relation caches derived for retrieval

This layer is disposable and rebuildable.

### 3. Profile Registry

This small control layer answers:

- which embedding profiles exist for the current project
- which one is active
- which one is stale
- which one needs a rebuild

The registry should make profile identity explicit rather than inferred.

## Minimal Compatibility Levels

Mind Keeper should treat compatibility in three levels.

### Level 1: Same Agent, Same Embedding Profile

- reuse canonical memory
- reuse the existing index

### Level 2: Different Agent, Same Embedding Profile

- reuse canonical memory
- optionally reuse the index only if chunking and schema expectations match

### Level 3: Different Agent, Different Embedding Profile

- reuse canonical memory
- rebuild a new index for the new profile

This is the safest and most realistic compatibility matrix.

## What Must Stay Out Of Scope

To protect product focus and preserve wave quality, V1 should explicitly avoid:

- runtime retrieval across multiple embedding profiles
- multi-agent concurrent write arbitration
- cross-project pooled memory
- agent-to-agent orchestration
- converting vectors across models

These ideas may become relevant later, but they should not be part of the first compatibility step.

## Suggested Data Shape

The long-term directory shape can evolve toward:

```text
<project-root>/.mindkeeper/
  memory/
    knowledge/
    diary/
    decisions/
    imports/
  canonical/
    memory.db
    schema.json
  indexes/
    <profile-id>/
      profile.json
      vectors.db
      manifest_state.json
  manifests/
  cache/
```

This does not need to happen in one large migration.

The important design truth is:

- `canonical/` is durable truth
- `indexes/<profile-id>/` is rebuildable cache

## Minimal Canonical Schema Expectations

The canonical layer should eventually expose stable fields such as:

- `docId`
- `sourceKind`
- `title`
- `relativePath`
- `contentHash`
- `updatedAt`
- `moduleName`
- `symbol`
- `branchName`
- `tags`
- `memoryTier`
- `stabilityScore`
- `distillKind`
- `distillConfidence`
- `disabled`
- `disabledReason`
- `helpfulVotes`
- `noisyVotes`
- `supersededBy`
- `conflictSubjects`
- `schemaVersion`

This is the compatibility surface that other agents should learn to read.

## Why This Does Not Weaken The Wave Engine

The current wave system gets its power from:

- intent-first planning
- good candidate ordering
- gated expansion
- confidence-aware stopping
- controlled mesh expansion

None of those depend on whether the candidate set came from one internal vector store format or from a profile-specific index abstraction.

If the candidate interface remains stable, the wave engine can stay unchanged.

In fact, clearer canonical metadata should help the wave engine by making:

- stale state more reliable
- superseded state more visible
- conflict handling easier to trust
- profile drift easier to detect

## Implementation Phases

The safest rollout is incremental.

### Phase A: Conceptual Split

Introduce clear internal language for:

- canonical memory
- index artifacts
- active embedding profile

No user-facing behavior needs to change yet.

### Phase B: Profile Identity

Make index ownership explicit:

- model name
- provider
- dimension
- schema version
- build timestamp

This gives the system a stable answer to "can I reuse this index?"

Current state:

- active profile identity is scaffolded on disk
- bootstrap/status flows can now report whether the current profile index is reusable or should be rebuilt
- manifest ownership drift is treated as rebuild guidance instead of silent ambiguity

### Phase C: Canonical Contract

Define and document the schema that should survive:

- agent changes
- model changes
- index rebuilds

This is the point where other agents can start reading project memory responsibly.

Current state:

- `.mindkeeper/canonical/contract.json` is scaffolded automatically
- the contract exposes model-agnostic field names, lifecycle boundaries, and governance signals
- bootstrap/status flows now have enough structure to point external readers at the canonical compatibility surface

### Phase D: Access Surface

Only after the layers are clear should Mind Keeper expose stronger compatibility behavior through:

- MCP tools
- documented on-disk schema
- optional index reuse checks

## Operational Rules

To keep the system efficient:

- use one active profile at runtime
- never query multiple profile indexes inside one `context_for_task`
- rebuild indexes only on profile change or schema drift
- keep canonical metadata lightweight and direct to read

This keeps compatibility from becoming a runtime tax.

## Success Criteria

This work is successful when:

- Mind Keeper keeps its current wave quality
- changing embedding models does not destroy project memory
- another agent can understand canonical project memory without guessing
- index rebuild rules are explicit instead of implicit
- the product still feels like one focused MCP memory plugin

## Current Decision

Mind Keeper should proceed with cross-agent compatibility as a storage-boundary refinement.

It should not market or implement this as a broad multi-agent platform feature yet.

That framing keeps the work clean, useful, and aligned with the product's strongest differentiator: high-quality gated project memory for IDE workflows.
