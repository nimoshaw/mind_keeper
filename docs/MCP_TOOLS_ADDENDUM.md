# MCP Tools Addendum

This addendum captures the tools added after the earlier MCP tool guide was written.

## New Recall Modes

- `recall_fast`
  Use this for low-latency IDE work. It stays biased toward stable memory plus project-local context.
- `recall_deep`
  Use this when you explicitly want broader history, including diary and imported notes.

## New Governance Tools

- `archive_stale_memories`
  Moves old diary or imported memories into the `cold` tier instead of leaving them in hot working recall.
- `list_conflicts`
  Surfaces likely conflicting decision memories so teams can reconcile them before they pollute retrieval.
- `list_conflict_clusters`
  Groups related conflict pairs into one subject-level view so teams can review policy drift without scanning every pair manually.
- `suggest_conflict_resolutions`
  Turns a conflict cluster into a ready-to-review canonical decision candidate, including a suggested title, tags, and the exact `docIds` to feed into consolidation.
- `suggest_consolidations`
  Scans related memories and proposes which ones look similar enough to merge before you run a real consolidation.
- `consolidate_memories`
  Merges several related memories into one stable `knowledge` or `decision` memory. It can also disable the inputs afterwards.

## Practical Workflow

1. Use `context_for_task` during active coding.
2. Use `recall_fast` when you want direct lookup without broad historical expansion.
3. Use `recall_deep` when the question is explicitly historical.
4. Periodically run `archive_stale_memories` to cool old diary/imported notes.
5. Use `list_conflicts` to inspect raw opposing pairs.
6. Use `list_conflict_clusters` to review the higher-level drift theme behind those pairs.
7. Use `suggest_conflict_resolutions` when a conflict cluster should collapse into one canonical decision.
8. Use `suggest_consolidations` to find merge candidates before touching stored memories.
9. Use `consolidate_memories` once you agree with one of the suggestions.

## Explain Fields You Now See

Recent responses can include:

- `wavePlanType`
- `wavePlan`
- `usedRecentWave`
- `usedFallbackWave`
- `stopReason`
- `relationBoost`
- `relationHits`

These fields make it easier for IDE clients to show how recall was assembled and why one result outranked another.
