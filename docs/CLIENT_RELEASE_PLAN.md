# Mind Keeper Client Release Plan

## Core Answer

Mind Keeper itself does not require a central cloud server in the early release phase.

The current product can run as a local MCP server process on the user's machine.

Typical early-release topology:

1. IDE or agent client launches `mind_keeper`
2. `mind_keeper` runs locally over stdio
3. project memory stays inside `<project>/.mindkeeper`
4. optional remote model endpoints are used only when the active embedding or reranker profile is remote

So the base product is:

- local-first
- project-local storage
- no mandatory platform backend

## First Release Target

The first release target should be Windows 11.

Reason:

- it matches the current development environment
- it keeps packaging and support scope under control
- it is the fastest path to getting real user feedback
- Linux and macOS support can follow after the core install and wrapper flows stabilize

## When A Server Is Still Needed

A separate server is only needed in optional cases:

- you choose remote embedding or reranker profiles
- you want centralized telemetry, licensing, sync, or team policy control
- you want hosted plugin configuration or hosted model routing later

Those are product expansions, not release blockers for V1.

## Release Targets

There are three different release surfaces and they should not be confused.

There are also two different Windows distribution forms for the core server:

1. developer distribution: `npm`
2. end-user distribution: packaged `exe`
3. installer distribution: `Setup.exe`

Both point to the same local-first MCP engine.

### 1. Core MCP Server

Current state:

- implemented
- verified
- release checks exist
- Win11 portable `exe` packaging now exists for local distribution
- Win11 installer packaging script now exists for maintainer-side `Setup.exe` generation

This is the part in the current repository.

### 2. VS Code Extension

Current state:

- not implemented in this repository yet

What it needs:

- extension manifest
- MCP server launch wiring
- project-root detection
- settings UI for profile selection
- tool/action surfaces for bootstrap, recall, context, recovery
- install and onboarding docs

### 3. AntiGravity Plugin / Integration

Current state:

- not implemented in this repository yet

What it needs:

- concrete AntiGravity integration entrypoint
- local MCP process launch or connector wiring
- config handoff for project root and model profile
- recovery and explain output rendering

## Current Release Judgment

Today the repo is close to "core MCP server releasable".

It is not yet "VS Code plugin releasable" or "AntiGravity plugin releasable", because those client wrappers do not exist in the codebase yet.

The correct first ship target is:

- core MCP server for Windows 11

So the clean release sequence is:

1. publish the core MCP server first
2. build the VS Code wrapper against the stable MCP tool surface
3. build the AntiGravity wrapper against the same tool surface

## Practical Recommendation

If you want the fastest path to shipping:

1. treat this repo as the core engine release
2. freeze the MCP tool contract
3. add one lightweight VS Code client project
4. add one lightweight AntiGravity client project
5. publish those wrappers after smoke-testing local launch and recovery flows

## Current Blocking Gap

The main remaining gap is not memory quality anymore.

The main gap is product packaging:

- client wrapper code
- final installer QA on top of the portable `exe`
- onboarding UX
- release artifacts for the two target clients
