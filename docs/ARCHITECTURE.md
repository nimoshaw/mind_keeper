# Mind Keeper Architecture

This document is the clean architecture handoff for the current `Mind Keeper` build.

Read this after [README.md](/D:/projects/mind_keeper/README.md) when you need to understand how the system is shaped internally, what is already stable, and where the current boundaries are.

## Product Position

`Mind Keeper` is a local-first, project-scoped memory MCP for IDE workflows.

It borrows the useful memory ideas behind VCP-style systems:

- active recall first
- passive injection stays gated
- memory quality matters more than raw recall volume
- project partitions stay isolated

It is not designed as:

- a hosted multi-tenant memory platform
- a full code knowledge graph platform
- a plugin that copies the whole repository into a separate vector folder

The project source files stay in place.
`Mind Keeper` stores memory assets, manifests, and vector/index artifacts inside the project-local `.mindkeeper` directory.

## Runtime Shape

The current runtime is a local MCP server over `stdio`.

Important current facts:

- transport: `StdioServerTransport`
- server entrypoint: [src/index.ts](/D:/projects/mind_keeper/src/index.ts)
- service facade: [src/mindkeeper-facade.ts](/D:/projects/mind_keeper/src/mindkeeper-facade.ts)
- packaging target: Windows 11 first
- deployment bias: local sidecar process beside the IDE or agent

This means the current product shape is best described as:

`local-first MCP memory server for one project workspace at a time`

It can be packaged and distributed with an IDE wrapper later, but the heavy work should still stay in a separate process instead of running inside the extension host.

## Storage Layout

Every project gets its own `.mindkeeper` directory.

```text
<project-root>/
  .mindkeeper/
    config.toml
    knowledge/
    diary/
    decisions/
    imports/
    flash/
    canonical/
    indexes/
      <active-embedding-profile>/
    manifests/
    vector/
    cache/
```

Partition roles:

- `knowledge/`: stable user-managed project knowledge
- `diary/`: session notes, work logs, and distilled progress memory
- `decisions/`: durable architecture and policy decisions
- `imports/`: manually imported external references
- `flash/`: lightweight session handoff state for fast resume
- `canonical/`: model-agnostic memory descriptors and cross-agent contracts
- `indexes/<profile>/`: active embedding profile descriptors and profile-scoped assets
- `manifests/`: status snapshots, benchmark history, and index summaries
- `vector/`: SQLite database, chunk metadata, embeddings, and retrieval artifacts
- `cache/`: temporary extraction outputs

## Memory Layers

The system intentionally separates memory by function instead of treating every note as the same thing.

### Durable Layers

- `manual` or knowledge memory
- `decision` memory
- `imported` memory

These are the memories the system should trust more heavily during recall and task-context assembly.

### Process Layers

- `diary` memory
- `flash` handoff memory

These are valuable, but they are not treated as equally durable.
`flash` especially is optimized for quick session resume rather than long-term knowledge retention.

### Project Layer

Project files are indexed in place.

The important boundary is:

- original files stay where they are
- chunks, metadata, vectors, and manifests go under `.mindkeeper`

So `vector/` is not a copy of the repo.
It is the retrieval artifact layer for project content plus persisted memory content.

## Core Services

The codebase has already been split into focused services instead of one giant file.

- entry facade: [src/mindkeeper.ts](/D:/projects/mind_keeper/src/mindkeeper.ts)
- facade implementation: [src/mindkeeper-facade.ts](/D:/projects/mind_keeper/src/mindkeeper-facade.ts)
- memory writes: [src/app/memory-write-service.ts](/D:/projects/mind_keeper/src/app/memory-write-service.ts)
- indexing: [src/app/project-index-service.ts](/D:/projects/mind_keeper/src/app/project-index-service.ts)
- embedding cache: [src/app/embedding-cache.ts](/D:/projects/mind_keeper/src/app/embedding-cache.ts)
- recall orchestration: [src/app/recall-service.ts](/D:/projects/mind_keeper/src/app/recall-service.ts)
- session distillation: [src/app/session-service.ts](/D:/projects/mind_keeper/src/app/session-service.ts)
- flash handoff: [src/app/flash-service.ts](/D:/projects/mind_keeper/src/app/flash-service.ts)
- hygiene and governance: [src/app/hygiene-service.ts](/D:/projects/mind_keeper/src/app/hygiene-service.ts)
- source controls: [src/app/source-service.ts](/D:/projects/mind_keeper/src/app/source-service.ts)
- canonical inspection/export: [src/app/canonical-service.ts](/D:/projects/mind_keeper/src/app/canonical-service.ts)
- profile recovery orchestration: [src/app/profile-ops-service.ts](/D:/projects/mind_keeper/src/app/profile-ops-service.ts)

This split is already good enough for handoff and incremental maintenance.

## Vectorization Pipeline

The embedding execution path is organized as a layered pipeline.

### EmbeddingBatchBroker

[src/app/embedding-batch-broker.ts](/D:/projects/mind_keeper/src/app/embedding-batch-broker.ts)

Receives embedding requests from multiple callers, merges them into token-aware batches, executes bounded concurrent flushes, preserves result ordering, and isolates failures per batch.

After a configurable quiet period (default 120 seconds), the broker clears idle profile queues to free resources. On shutdown, all pending items are flushed and awaited before the process exits.

### EmbeddingCache

[src/app/embedding-cache.ts](/D:/projects/mind_keeper/src/app/embedding-cache.ts)

Reuses vectors for identical normalized text under the same active profile. Backed by a SQLite table (`embedding_cache`) keyed by `(profile_key, content_hash)`. This reduces redundant provider calls during rebuilds, repeated indexing, and repeated recall queries.

### VectorizationScheduler

[src/app/vectorization-scheduler.ts](/D:/projects/mind_keeper/src/app/vectorization-scheduler.ts)

Provides debounce-based aggregation windows on top of the broker. Short bursts of embedding requests are collected within a configurable time window, with immediate flush when token budget or item count thresholds are reached. Callers receive promises that resolve when the aggregated batch completes.

The scheduler is available as an opt-in layer. Callers can always fall back to direct `embedBatch` if the scheduler is not needed.

## Write Path

There are two major write paths.

### Manual or Structured Memory Writes

This path is driven by tools such as:

- `remember`
- `remember_decision`
- `summarize_session`

The write pipeline does roughly this:

1. normalize input
2. enrich metadata
3. persist source asset in the right partition
4. chunk content
5. reuse cached remote embeddings when the same normalized content is already known under the active profile
6. generate remaining embeddings through the active profile
7. write chunk records and vector artifacts
8. update manifests and index state

### Project Indexing

This path is driven by:

- `index_project`
- `rebuild_active_profile_index`
- parts of `recover_profile_index`

The project indexer scans eligible files, applies manifest-based incremental checks, extracts symbols when possible, then chunks and persists retrievable project content.
When the active embedding profile is remote, repeated chunk text can now reuse a project-local SQLite embedding cache before issuing provider calls.

## Retrieval Shape

Retrieval is intentionally hybrid and gated.

At a high level:

1. build candidates from vector and lexical signals
2. apply source and metadata-aware scoring
3. optionally apply lightweight graph-aware boosts
4. stop or expand according to wave planning and confidence
5. enforce budget limits before returning context

This is the key product philosophy:

- not every retrieved item should be injected
- task-context assembly is a planning problem, not just a nearest-neighbor lookup

## `context_for_task`

`context_for_task` is the main IDE-facing orchestration path.

It combines:

- task text
- current file
- current symbol
- selected text
- diagnostics
- branch name
- related files
- fresh flash state

Then it applies gated wave planning and returns:

- selected memories
- explain summaries
- IDE-facing explain panel metadata
- stop reasons
- budget and gate usage data

This is where the VCP-inspired design matters most.
The goal is not to dump memory into the prompt.
The goal is to inject the right amount of memory at the right time.

## Flash Handoff Layer

`flash` is the lightweight resume layer between active work sessions.

It lives under:

- `.mindkeeper/flash/active.json`
- `.mindkeeper/flash/history/*.json`
- lightweight draft state when automatic observation is active

Its job is to preserve:

- what the session was trying to do
- where work stopped
- why the current direction matters
- what should happen next
- blockers and touched files

Important design constraints:

- high read value
- low write frequency
- no heavy realtime embedding loop
- best-effort auto updates only

Auto flash updates are deliberately lightweight and throttled.
They should never block `context_for_task`.

## Canonical and Profile Layers

Cross-agent compatibility is being prepared through two storage layers.

### Canonical Layer

The canonical layer is model-agnostic and meant to survive profile changes.

Important surfaces:

- canonical contract descriptor
- read-only canonical inspection
- canonical export without vector internals

### Active Profile Layer

The active profile layer is tied to the current embedding profile.

Important surfaces:

- profile validation
- profile rebuild
- profile repair
- one-call recovery orchestration

This is the current rule:

- only one embedding profile is active for runtime recall at a time

That keeps runtime behavior stable and complexity under control.

## Packaging and Release Shape

The current product is Windows 11 first.

Supported release forms today:

- developer track via `npm`
- portable user track via `mind-keeper.exe` plus sibling `app/`
- installer build pipeline via `Setup.exe` packaging scaffold

Relevant docs:

- [docs/WIN11_RELEASE.md](/D:/projects/mind_keeper/docs/WIN11_RELEASE.md)
- [docs/CLIENT_RELEASE_PLAN.md](/D:/projects/mind_keeper/docs/CLIENT_RELEASE_PLAN.md)
- [docs/HANDOFF.md](/D:/projects/mind_keeper/docs/HANDOFF.md)

## Current Boundaries

These boundaries are intentional and important during handoff.

### Stable Enough Today

- local-first `stdio` MCP server
- project-local memory partitions
- incremental indexing
- gated task-context recall
- flash resume layer
- hygiene and conflict-governance baseline
- Win11 packaging pipeline

### Not Yet Finished

- HTTP transport for remote MCP access
- full VS Code wrapper in this repo
- full AntiGravity wrapper in this repo
- remote project-file indexing against NAS or shared server paths
- heavy online rerank orchestration as a default path

## Why Separate Service and Plugin

Even when a future IDE plugin ships with the server bundled, the better runtime shape is still:

- distribute together if needed
- run separately at runtime

That keeps:

- IDE responsiveness safer
- indexing and SQLite work isolated
- packaging flexible
- future remote/offloaded compute options open

## Recommended Next Steps

For the next maintainer or release owner, the most practical next work is:

1. keep the core MCP contract stable
2. finish client-side wrapper work for AntiGravity first
3. keep Win11 onboarding smooth and testable
4. use real user feedback to tune recall and flash behavior
5. only then decide whether HTTP transport or remote worker modes are worth adding
