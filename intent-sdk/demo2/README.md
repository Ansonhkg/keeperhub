# Demo 2: Eval-Exec Loop

`demo2` is the eval-exec product demo for v4. It models a loop that prepares a
request, executes work, evaluates the result, decides whether it is good enough,
and optionally fixes/retries until the configured condition is met.

## Layout

```text
core/             eval-exec domain, schemas, prompts, policy, and pure services
runtime/          workflow, graph, operation, and session wiring
infrastructure/  concrete stores and worker adapters
adapters/         CLI, HTTP, and MCP operating surfaces
graph/            graph-sdk conformance entrypoints
manifests/        app and plugin manifests
```

The generic v4 SDK stays in `../src/sdk`. Demo2 may use SDK patterns over time,
but eval-exec policy belongs here unless it becomes clearly reusable across
multiple demos.

## Commands

```bash
pnpm intent:demo2 "make this good"
pnpm intent:mcp
pnpm intent:sidecar
pnpm intent:smoke
```
