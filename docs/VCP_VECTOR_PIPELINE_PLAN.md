# Mind Keeper VCP-Inspired Vector Pipeline Plan

This document captures how `Mind Keeper` should study and borrow the most valuable parts of VCP's newer vectorization pipeline without turning the product into a heavier system than it needs to be.

The goal is to import the engineering advantages, not to blindly clone VCP's full memory stack.

## Why This Plan Exists

Recent VCP evolution shows a meaningful strength in its vectorization backend:

- lighter request scheduling
- token-aware batching
- better memory reuse
- lower repeated embedding cost
- bounded concurrency
- failure isolation
- cache-minded operation

That is directly relevant to `Mind Keeper`, because our current recall and memory strategy is already strong, but our embedding execution path is still comparatively direct.

Relevant study targets:

- [EmbeddingUtils.js](/D:/vcp/VCPToolBox/EmbeddingUtils.js)
- [KnowledgeBaseManager.js](/D:/vcp/VCPToolBox/KnowledgeBaseManager.js)
- [TagMemo_Wave_Algorithm_Deep_Dive.md](/D:/vcp/VCPToolBox/TagMemo_Wave_Algorithm_Deep_Dive.md)

Current `Mind Keeper` comparison points:

- [embedding.ts](/D:/projects/mind_keeper/src/embedding.ts)
- [project-index-service.ts](/D:/projects/mind_keeper/src/app/project-index-service.ts)
- [memory-write-service.ts](/D:/projects/mind_keeper/src/app/memory-write-service.ts)

## Strategic Judgment

What `Mind Keeper` should borrow first:

- token-aware batch embedding
- a central embedding broker or queue
- bounded concurrency
- ordered batch result backfill
- content-hash vector reuse
- debounce-based aggregation
- idle release and lightweight prewarm

What `Mind Keeper` should not borrow in this phase:

- the full VCP TagMemo topology
- heavy tag graph propagation as a default path
- LIF spike propagation
- intrinsic residual precomputation
- any retrieval architecture that would noticeably increase IDE latency or operational complexity

This phase is about upgrading vectorization infrastructure, not replacing the current recall philosophy.

## Design Constraints

The following constraints are mandatory.

1. `Mind Keeper` stays project-scoped and local-first.
2. The current recall, wave, flash, and hygiene layers must not be destabilized.
3. The new vectorization path must be able to fall back to the current direct embedding flow.
4. `flash` remains lightweight and should not be pulled into a heavy realtime embedding loop.
5. The product should still feel fast on Win11 local MCP usage.

## Study Findings To Carry Forward

### 1. Token-Aware Batching

VCP's embedding utility groups texts by both:

- total token budget
- maximum items per batch

This matters more than raw parallelism because it avoids:

- request fragmentation
- oversize payload failures
- wasteful single-item remote calls

`Mind Keeper` should adopt the same principle for all non-trivial embedding work.

### 2. Queue Windowing

VCP uses a short batching window and file queue before flush.

That is useful for `Mind Keeper` in:

- `index_project`
- repeated memory writes
- rebuild and recovery flows

This is especially valuable when many chunks are created close together.

### 3. Ordered Result Backfill

VCP preserves original order even when requests execute concurrently.

This is important because `Mind Keeper` also needs deterministic chunk-to-vector alignment when persisting chunk records.

### 4. Failure Isolation

One failed batch should not destroy the whole indexing or rebuild pass.

This is especially important for:

- remote embedding providers
- mixed-size chunk sets
- recovery flows

### 5. Memory Reuse

VCP caches vectorizable text assets and reuses them instead of recomputing everything repeatedly.

For `Mind Keeper`, the best early reuse key is:

`activeEmbeddingProfile + normalizedContentHash`

### 6. Idle Release

VCP explicitly unloads heavy in-memory state when it goes idle.

`Mind Keeper` does not need the same complexity level, but it should still:

- avoid keeping unnecessary broker state forever
- free warm caches after a quiet period
- keep only the highest-value reusable state in memory

## Planned Architecture

The new vectorization infrastructure should be introduced as a separate layer under `src/app/`.

### New Components

#### `EmbeddingBatchBroker`

Purpose:

- receive embedding requests from multiple callers
- merge them into token-aware batches
- execute bounded concurrent flushes
- preserve result ordering
- isolate failures per batch

Suggested file:

- `src/app/embedding-batch-broker.ts`

#### `EmbeddingCache`

Purpose:

- reuse vectors for identical normalized text under the same active profile
- reduce redundant provider calls
- reduce rebuild cost
- reduce repeated indexing cost

Suggested file:

- `src/app/embedding-cache.ts`

#### `VectorizationScheduler`

Purpose:

- provide debounce-based aggregation windows
- separate immediate writes from short-delay flushes
- support different callers without each one inventing queue logic

Suggested file:

- `src/app/vectorization-scheduler.ts`

## Phased Execution Plan

### Phase 0: Measurement Baseline

Before changing behavior, record the current baseline.

Measure:

- total embedding calls
- chunks per operation
- elapsed time for `index_project`
- elapsed time for `remember`
- elapsed time for `rebuild_active_profile_index`
- repeated content ratio
- remote profile versus local profile behavior

Deliverables:

- one benchmark note
- one machine-readable metric output if practical

Success condition:

- we can prove whether the later pipeline actually improves anything

### Phase 1: Study And Distillation

Translate VCP implementation ideas into `Mind Keeper` language.

Output:

- a compact design note that separates:
  - batching
  - concurrency
  - queueing
  - caching
  - idle release

Success condition:

- we understand which parts are reusable infrastructure and which parts belong to VCP's larger cognitive stack

### Phase 2: Batch Embedding API

Extend [embedding.ts](/D:/projects/mind_keeper/src/embedding.ts) with a batch-capable API.

Add:

- `embedBatch(profile, texts)`
- token-aware splitting
- max-items-per-batch limit
- retry policy
- stable result ordering
- `null` or explicit failure markers for failed items

Success condition:

- `project-index-service` can stop calling remote embedding once per chunk

### Phase 3: Broker Integration

Introduce `EmbeddingBatchBroker`.

First callers:

- [project-index-service.ts](/D:/projects/mind_keeper/src/app/project-index-service.ts)
- [memory-write-service.ts](/D:/projects/mind_keeper/src/app/memory-write-service.ts)

Rules:

- keep current behavior available as fallback
- do not change persisted schema yet unless needed

Success condition:

- indexing and remembered-document persistence go through one central broker path

### Phase 4: Cache Layer

Add `EmbeddingCache`.

Cache key:

- active embedding profile name
- normalized content hash

Preferred initial backing store:

- SQLite table inside the project-local database

Why SQLite first:

- easier consistency
- easier cleanup
- easier profile scoping
- easier future stats and debugging

Success condition:

- repeated indexing or rebuild can skip known vectors safely

### Phase 5: Debounce Aggregation

Add `VectorizationScheduler` on top of the broker.

Use it for:

- bursty indexing
- repeated memory writes
- rebuild and repair flows

Do not use it for:

- `flash`
- every tiny task-context event

Success condition:

- short bursts aggregate into fewer, better-sized remote calls

### Phase 6: Idle Release And Lightweight Prewarm

Add:

- broker idle timeout
- cache TTL policy for in-memory hot entries
- optional warm-up for highly reused stable assets

Keep this modest.

Success condition:

- long-running IDE sessions do not accumulate unnecessary broker memory

### Phase 7: Testing And Benchmarking

Add focused regression tests.

Needed coverage:

- batch ordering
- partial failure handling
- cache hits and misses
- cross-profile cache isolation
- scheduler flush behavior
- fallback when remote embedding fails
- shutdown safety

Suggested tests:

- `tests/embedding_broker.test.ts`
- `tests/embedding_cache.test.ts`
- `tests/vectorization_scheduler.test.ts`

Success condition:

- the new infrastructure is safer than the old direct-call path, not just faster

### Phase 8: Documentation And Handoff

Update:

- [README.md](/D:/projects/mind_keeper/README.md)
- [docs/ARCHITECTURE.md](/D:/projects/mind_keeper/docs/ARCHITECTURE.md)
- [docs/HANDOFF.md](/D:/projects/mind_keeper/docs/HANDOFF.md)
- [docs/STATUS.md](/D:/projects/mind_keeper/docs/STATUS.md)

Add:

- clear explanation of fallback mode
- cache scope and invalidation rules
- how to benchmark before and after

## Target Outcomes

Reasonable target outcomes for this work:

- remote embedding request count reduced significantly during indexing
- repeated vectorization reduced sharply for unchanged memory content
- rebuild flows become more predictable and less bursty
- failures degrade gracefully instead of killing full operations
- IDE users do not feel added drag from the new system

## Risks To Avoid

The main risks are:

- introducing queue complexity that is hard to reason about
- accidentally delaying small operations that should stay fast
- letting cache reuse cross embedding-profile boundaries
- pulling `flash` into expensive vectorization loops
- turning a local-first MCP into an overly stateful background system

## Immediate Next Step

The next implementation step after this document should be:

1. record the current embedding baseline
2. add a batch-capable embedding API
3. integrate it into `project-index-service`

That is the highest-return, lowest-risk starting point.

## Progress Snapshot

Current completed work:

- embedding baseline metrics have been added
- a first batch-capable embedding path now exists
- `project-index-service` now uses batch embedding for chunk-heavy indexing work

Still not done:

- central embedding broker
- debounce scheduler
- remote-provider failure isolation per batch item
- idle release and prewarm policy

Newly completed since the initial draft:

- a project-local SQLite embedding cache now reuses remote vectors by profile identity and normalized content hash
- repeated recall or re-index work can now short-circuit provider calls when the text is already known under the same profile
- regression coverage now includes persistent cache reuse and cross-profile cache isolation
