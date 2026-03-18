# Mind Keeper Handoff Guide

This document is for the next maintainer, release owner, or integration owner who needs to pick up `Mind Keeper` quickly.

Use it together with:

- [README.md](/D:/projects/mind_keeper/README.md)
- [docs/ARCHITECTURE.md](/D:/projects/mind_keeper/docs/ARCHITECTURE.md)
- [docs/STATUS.md](/D:/projects/mind_keeper/docs/STATUS.md)
- [docs/VCP_VECTOR_PIPELINE_PLAN.md](/D:/projects/mind_keeper/docs/VCP_VECTOR_PIPELINE_PLAN.md)

## Current Product Judgment

The core product is already in a usable pre-wrapper state.

What is genuinely ready now:

- local-first MCP server
- project-scoped `.mindkeeper` storage
- manual, decision, diary, import, project, and flash memory layers
- incremental indexing
- gated recall and `context_for_task`
- flash resume handoff
- profile validation, repair, rebuild, and recovery orchestration
- hygiene and conflict-governance baseline
- Win11 developer and portable packaging flows

What is not shipped as a finished client yet:

- dedicated AntiGravity plugin
- dedicated VS Code extension
- HTTP or hosted server mode

## Fast Re-entry Checklist

If you are returning to this repo after some time, do these first:

1. read [README.md](/D:/projects/mind_keeper/README.md)
2. read [docs/STATUS.md](/D:/projects/mind_keeper/docs/STATUS.md)
3. read [docs/ARCHITECTURE.md](/D:/projects/mind_keeper/docs/ARCHITECTURE.md)
4. run `npm run status`
5. run `npm run verify`

That gives you the current build state, module map, and a working confidence check.

## Commands To Trust

These are the main handoff-safe commands.

Current observed state on this machine:

- `npm run status`: passed
- `npm run verify`: passed
- `npm run release:check`: currently blocked by `bench:suite:check` baseline drift on the local `mind-keeper` project benchmark, not by a functional or test failure

### Daily Confidence Checks

```bash
npm run check
npm test
npm run verify
```

### Release Checks

```bash
npm run release:check
npm run status
npm run status:save
```

If `release:check` fails only because `bench:suite:check` reports a project-benchmark regression, inspect whether the repo itself simply grew or changed shape in an intentional way.
That benchmark uses the current repository as one of its workload samples, so large documentation or source-surface growth can move the baseline.

### Win11 Packaging

```powershell
npm run package:win11
npm run package:win11:installer
```

### Win11 Runtime

```powershell
npm run setup:win11
npm run start:win11
```

## Current Release Surface

There are three release surfaces to keep conceptually separate.

### 1. Core MCP Server

This is the code in the current repository.

It is the most mature part of the product.

### 2. Portable Win11 User Build

This is the current non-Node end-user path:

- `artifacts/win11/MindKeeper-win11-x64/mind-keeper.exe`
- `artifacts/win11/MindKeeper-win11-x64/app/`

This is already usable for local MCP launch.

### 3. Client Wrappers

These are still next-phase work:

- AntiGravity integration shell
- VS Code extension shell

Treat them as thin wrappers around the stable MCP contract, not as a place to reimplement memory logic.

## Recommended Integration Shape

For future client work, keep this rule:

- wrapper handles launch, config, and rendering
- server handles indexing, retrieval, flash, governance, and profile recovery

Do not move the memory engine into the plugin process unless there is a very strong reason.

## AntiGravity Guidance

Current recommendation:

- start with direct MCP configuration against the local server
- do not block usage on a dedicated `.vsix` or custom wrapper
- build a plugin shell later only if it adds real UX value

Important current technical boundary:

- the server is `stdio` based today
- it is not yet an HTTP MCP service

That means the most reliable near-term path is still local launch on the user machine.

## NAS, Docker, and Remote Deployment Guidance

This repo can be containerized, but remote deployment is not the primary operating mode yet.

Why:

- current transport is local `stdio`
- project indexing expects direct filesystem access
- remote path mapping is a real complexity cost

So the recommended deployment priority is:

1. local Windows machine
2. bundled local sidecar with future plugin
3. remote or NAS-assisted modes later, after transport and file-access boundaries are designed more explicitly

## Known Boundaries And Honest Gaps

These are not emergencies, but they should be visible during handoff.

- no finished AntiGravity wrapper in this repo yet
- no finished VS Code wrapper in this repo yet
- no HTTP transport yet
- remote workspace indexing story is still incomplete
- deeper recall tuning should now be feedback-driven instead of architecture-driven
- the VCP-inspired vectorization broker is still planned, but the persistent profile-scoped embedding cache is already implemented

## Files To Read First

If you need the shortest useful reading path, start here:

- [README.md](/D:/projects/mind_keeper/README.md)
- [docs/STATUS.md](/D:/projects/mind_keeper/docs/STATUS.md)
- [docs/ARCHITECTURE.md](/D:/projects/mind_keeper/docs/ARCHITECTURE.md)
- [docs/WIN11_RELEASE.md](/D:/projects/mind_keeper/docs/WIN11_RELEASE.md)
- [docs/MCP_TOOLS_ADDENDUM.md](/D:/projects/mind_keeper/docs/MCP_TOOLS_ADDENDUM.md)
- [docs/CROSS_AGENT_COMPAT.md](/D:/projects/mind_keeper/docs/CROSS_AGENT_COMPAT.md)

## Files That Matter Most In Code

- [src/index.ts](/D:/projects/mind_keeper/src/index.ts)
- [src/mindkeeper-facade.ts](/D:/projects/mind_keeper/src/mindkeeper-facade.ts)
- [src/app/recall-service.ts](/D:/projects/mind_keeper/src/app/recall-service.ts)
- [src/app/flash-service.ts](/D:/projects/mind_keeper/src/app/flash-service.ts)
- [src/app/project-index-service.ts](/D:/projects/mind_keeper/src/app/project-index-service.ts)
- [src/app/embedding-cache.ts](/D:/projects/mind_keeper/src/app/embedding-cache.ts)
- [src/app/profile-ops-service.ts](/D:/projects/mind_keeper/src/app/profile-ops-service.ts)

## Handoff Recommendation

If someone else takes over from here, the cleanest next sequence is:

1. freeze the current MCP tool contract for the near term
2. keep Win11 release flow healthy
3. build and test AntiGravity integration first
4. avoid large algorithm rewrites until real user feedback exposes a repeatable recall or flash issue

That sequence preserves product momentum and avoids reopening the stable core too early.
