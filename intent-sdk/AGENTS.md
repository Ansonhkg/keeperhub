# Overview

This directory is a standalone Bun project for the v4 generic intent SDK plus
two app-owned demos.

# Architecture

- Keep generic SDK logic under `src/sdk`.
- Keep the workflow-builder product demo under `demo1/core` and `demo1/adapters`.
- Keep the eval-exec-loop product demo under `demo2/core`, `demo2/runtime`, `demo2/infrastructure`, and `demo2/adapters`.
- Keep HTTP, CLI, and MCP adapters under each demo's `adapters` directory.
- Keep graph-sdk conformance artifacts for demo2 under `demo2/graph`.
- Keep demo2 prompt content in `demo2/core/templates/skills/<name>/SKILL.md` with colocated `spec.json`.
- Keep demo2 request defaults and mode policy in `demo2/core/request/policy.json`.

# Runtime

- Use Bun commands by default.
- Keep this package self-contained in `v4/package.json`.
- Default worker backend is `demo`; set `EVAL_EXEC_V3_BACKEND=opencode` to use the OpenCode CLI worker.
- Default state backend is `memory`; set `EVAL_EXEC_V3_STATE_BACKEND=file` to persist runs under `data/runs`.

# Verification

- Run `bun run check` after TypeScript changes.
- Run `bun run lint:templates` after template changes.
- Run `bun run check:graph` after graph, adapter, runtime, or source-boundary changes.
- Run `bun run check:graph:operation` after operation metadata, endpoint, node-boundary, or action changes.
- Run `bun run smoke` and `bun run smoke:file-state` before marking runtime behavior complete.
