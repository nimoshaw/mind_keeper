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
- `consolidate_memories`
  Merges several related memories into one stable `knowledge` or `decision` memory. It can also disable the inputs afterwards.

## Practical Workflow

1. Use `context_for_task` during active coding.
2. Use `recall_fast` when you want direct lookup without broad historical expansion.
3. Use `recall_deep` when the question is explicitly historical.
4. Periodically run `archive_stale_memories` to cool old diary/imported notes.
5. Use `list_conflicts` and `consolidate_memories` during cleanup passes.

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
