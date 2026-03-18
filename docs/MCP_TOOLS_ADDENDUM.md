# MCP Tools Addendum

This addendum captures the tools added after the earlier MCP tool guide was written.

## New Recall Modes

- `recall_fast`
  Use this for low-latency IDE work. It stays biased toward stable memory plus project-local context.
- `recall_deep`
  Use this when you explicitly want broader history, including diary and imported notes.

## New Flash Resume Tools

- `flash_checkpoint`
  Stores one lightweight end-of-session handoff checkpoint under `.mindkeeper/flash`.
  Use it for the last work state, next steps, blockers, touched files, and temporary reasoning that should survive a context reset.
- `flash_resume`
  Loads the active flash checkpoint and returns a `resumePrompt` that clients can inject directly before the next task starts.
- `flash_clear`
  Clears the active flash checkpoint once that work state has been resumed or replaced.

`context_for_task` now also refreshes auto flash state in the background on meaningful task-context calls.
That auto path is intentionally lightweight:

- no continuous recording
- no per-keystroke updates
- no default embedding work
- no heavy vector rebuild

## New Compatibility Tool

- `inspect_memory_access_surface`
  Returns the model-agnostic canonical contract paths, the active embedding profile reuse/rebuild state, and the safe cross-agent access rules for the current project.
- `inspect_canonical_memory`
  Returns a read-only canonical summary across source kinds, memory tiers, branch views, and recent memory assets without touching vector internals.
- `inspect_canonical_governance`
  Returns a read-only governance view over canonical memory, combining health hotspots, stale decision review, and current conflict clusters.
- `export_canonical_memory`
  Exports a canonical memory snapshot for backup or cross-agent reuse. It can include manual/decision/diary/imported content, while project file content stays opt-in.
- `validate_profile_index`
  Validates whether the active embedding profile index is reusable, needs rebuilding, or needs profile-registry repair before cross-agent reuse.
- `recover_profile_index`
  Runs one safe orchestration pass that can validate, repair missing profile metadata, rebuild the active profile index, and run `index_project` for empty scaffolds when needed.
  It also supports `dry_run: true`, which only plans the recovery path and returns `manualActions` for the next operator step.
  It supports `strategy: "safe" | "standard" | "aggressive"` so IDE clients can choose between conservative repair-only behavior and full recovery with forced indexing.
  On failure it now returns a stable `failure.code` and operator-facing `manualActions`, so clients can distinguish config problems from missing API keys or provider-side failures.
- `rebuild_active_profile_index`
  Rebuilds the active profile index from canonical memory files and the current project tree after profile drift or deliberate model switches.
- `repair_profile_registry`
  Recreates missing Mind Keeper config, canonical descriptors, and active-profile descriptor files so later validation or rebuild steps have a clean base.

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
4. If you want an explicit handoff, use `flash_checkpoint` before ending a work session.
5. Even without a manual checkpoint, `context_for_task` now maintains a low-cost auto flash checkpoint in the background.
6. At the next restart, use `flash_resume` first, then call `context_for_task`.
7. Run `review_memory_health` to see whether stale, noisy, or conflicting memories need cleanup first.
8. Use `suggest_memory_cleanup` when you want one prioritized checklist instead of stitching several hygiene calls together.
9. Use `apply_memory_cleanup_plan` when you want the safe cleanup actions to run automatically.
10. Use `list_stale_decisions` when you specifically want to review aging decisions before they keep shaping recall.
11. Periodically run `archive_stale_memories` to cool old diary/imported notes.
12. Use `list_conflicts` to inspect raw opposing pairs.
13. Use `list_conflict_clusters` to review the higher-level drift theme behind those pairs.
14. Use `suggest_conflict_resolutions` when a conflict cluster should collapse into one canonical decision.
15. Use `plan_conflict_resolutions` when you want a ready-to-run template for the actual resolution step.
16. Use `validate_conflict_resolution_plan` before execution when you want a quick safety check.
17. Use `execute_conflict_resolution_plan` after review when you are ready to publish the canonical decision and optionally disable the old ones.
18. Use `mark_superseded` when you want to explicitly cool and disable older decisions under that canonical policy.
19. Use `verify_conflict_resolution_execution` right after execution to confirm the canonical entry and superseded states are correct.
20. Use `suggest_conflict_resolution_followup` to decide whether the old conflicting entries should be disabled, archived, or left as-is.
21. Use `execute_conflict_resolution_followup` to carry out that cleanup action without manually stitching together extra hygiene calls.
22. Use `suggest_consolidations` to find merge candidates before touching stored memories.
23. Use `consolidate_memories` once you agree with one of the suggestions.
24. During model switches or cross-agent handoff, call `recover_profile_index` instead of manually chaining repair/rebuild/index steps.
25. Use `recover_profile_index` with `dry_run: true` when you want the IDE to preview the recovery path before touching project files.

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
- `explainPanel`
- `explainReasons`
- `explainCards`
- `relationBoost`
- `relationHits`
- `flash`
- `usedFlashGate`

These fields make it easier for IDE clients to show how recall was assembled and why one result outranked another without rebuilding the explanation layer on the client side.
