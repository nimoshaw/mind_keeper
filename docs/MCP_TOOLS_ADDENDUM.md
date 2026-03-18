# MCP Tools Addendum

This addendum captures the tools added after the earlier MCP tool guide was written.

## New Recall Modes

- `recall_fast`
  Use this for low-latency IDE work. It stays biased toward stable memory plus project-local context.
- `recall_deep`
  Use this when you explicitly want broader history, including diary and imported notes.

## New Governance Tools

- `review_memory_health`
  Scans the current project memory store and summarizes the biggest cleanup hotspots, including stale diary/imported notes, noisy active memories, and active decision conflicts.
- `list_stale_decisions`
  Lists older decision memories that now look stale, superseded, low-confidence, disabled, or still conflict-prone.
- `suggest_memory_cleanup`
  Combines health review and stale decision review into one prioritized cleanup checklist.
- `apply_memory_cleanup_plan`
  Executes the safe parts of that cleanup checklist automatically, such as stale archive and noisy-source disabling, while leaving policy-sensitive work for manual review.
- `mark_superseded`
  Marks older decisions as superseded by a canonical decision, optionally disabling them and cooling them into the cold tier immediately.
- `archive_stale_memories`
  Moves old diary or imported memories into the `cold` tier instead of leaving them in hot working recall.
- `list_conflicts`
  Surfaces likely conflicting decision memories so teams can reconcile them before they pollute retrieval.
- `list_conflict_clusters`
  Groups related conflict pairs into one subject-level view so teams can review policy drift without scanning every pair manually.
- `suggest_conflict_resolutions`
  Turns a conflict cluster into a ready-to-review canonical decision candidate, including a suggested title, tags, and the exact `docIds` to feed into consolidation.
- `plan_conflict_resolutions`
  Returns executable templates for the next step, including a `consolidate_memories` payload and a `remember_decision` draft.
- `validate_conflict_resolution_plan`
  Runs a preflight check over the reviewed plan so you can confirm the source decisions exist, are valid, and are safe to resolve.
- `execute_conflict_resolution_plan`
  Executes the reviewed plan by writing one canonical decision and optionally disabling the superseded conflicting entries.
- `verify_conflict_resolution_execution`
  Confirms that the canonical decision exists afterward and that the superseded decisions were disabled as expected.
- `suggest_conflict_resolution_followup`
  Recommends the next governance action after execution, such as `disable`, `archive`, `keep_both`, or `review`.
- `execute_conflict_resolution_followup`
  Executes that next governance action so superseded conflict notes can be disabled, archived into the cold tier, or explicitly left alone.
- `suggest_consolidations`
  Scans related memories and proposes which ones look similar enough to merge before you run a real consolidation.
- `consolidate_memories`
  Merges several related memories into one stable `knowledge` or `decision` memory. It can also disable the inputs afterwards.

## Practical Workflow

1. Use `context_for_task` during active coding.
2. Use `recall_fast` when you want direct lookup without broad historical expansion.
3. Use `recall_deep` when the question is explicitly historical.
4. Run `review_memory_health` to see whether stale, noisy, or conflicting memories need cleanup first.
5. Use `suggest_memory_cleanup` when you want one prioritized checklist instead of stitching several hygiene calls together.
6. Use `apply_memory_cleanup_plan` when you want the safe cleanup actions to run automatically.
7. Use `list_stale_decisions` when you specifically want to review aging decisions before they keep shaping recall.
8. Periodically run `archive_stale_memories` to cool old diary/imported notes.
9. Use `list_conflicts` to inspect raw opposing pairs.
10. Use `list_conflict_clusters` to review the higher-level drift theme behind those pairs.
11. Use `suggest_conflict_resolutions` when a conflict cluster should collapse into one canonical decision.
12. Use `plan_conflict_resolutions` when you want a ready-to-run template for the actual resolution step.
13. Use `validate_conflict_resolution_plan` before execution when you want a quick safety check.
14. Use `execute_conflict_resolution_plan` after review when you are ready to publish the canonical decision and optionally disable the old ones.
15. Use `mark_superseded` when you want to explicitly cool and disable older decisions under that canonical policy.
16. Use `verify_conflict_resolution_execution` right after execution to confirm the canonical entry and superseded states are correct.
17. Use `suggest_conflict_resolution_followup` to decide whether the old conflicting entries should be disabled, archived, or left as-is.
18. Use `execute_conflict_resolution_followup` to carry out that cleanup action without manually stitching together extra hygiene calls.
19. Use `suggest_consolidations` to find merge candidates before touching stored memories.
20. Use `consolidate_memories` once you agree with one of the suggestions.

## Explain Fields You Now See

Recent responses can include:

- `wavePlanType`
- `wavePlan`
- `intentSubtype`
- `usedRecentWave`
- `usedFallbackWave`
- `stopReason`
- `usedConflictGate`
- `conflictSummary`
- `usedAdaptiveDeepWaveGate`
- `deepWaveTriggers`
- `explainSummary`
- `explainReasons`
- `relationBoost`
- `relationHits`

These fields make it easier for IDE clients to show how recall was assembled and why one result outranked another.
