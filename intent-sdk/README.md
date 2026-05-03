# intent-sdk v4

`v4` is the DX prototype for turning plain-English workflow requests into
structured intent, real product capabilities, runnable artifacts, and traceable
execution.

The generic SDK owns intent resolution, harness orchestration, events,
questions, answers, resume, and streaming lifecycle. Product code still owns
the real capability catalog, artifact shape, readiness checks, and runner.

## One SDK, Two Layers

`v4` exposes one SDK with two levels:

```text
Core / low-level:
  intent, harness, step, events, questions, hooks, resume

Product Builder / high-level:
  createWorkflow, capability matching, artifact creation, checks, runner
```

`createWorkflow(...)` is the high-level API for the standard
`intent -> capabilities -> artifact -> run` flow. Internally, it is built on
the lower-level `harness(...)` and `step(...)` APIs.

Custom runtime products can use the harness layer directly:

```ts
import { done, goto, harness, step } from "./src/sdk/index.js";

const loop = harness({
  id: "custom.loop",
  steps: [
    step("prepare", async () => done()),
    step.ai("execute", { run: async () => done() }),
    step("decide", async () => goto("execute", "Try again.")),
  ],
});
```

## Demo 1: Workflow Builder

Run the consolidation demo from this package:

```bash
pnpm intent:demo "For every 15 seconds, check ETH price and notify me. Do that 3 times."
```

By default, the demo uses fixed fixture answers from `demo1/core/fixtures.ts` for
missing questions. To answer unresolved questions in the terminal:

```bash
pnpm intent:demo --interactive "For every few seconds, check the price and notify. Do that a few times."
```

Live event logging is enabled by default. Use `--quiet` when you only want the
final summary:

```bash
pnpm intent:demo --quiet "For every 15 seconds, check ETH price and notify me. Do that 3 times."
```

The demo uses the OpenAI-compatible endpoint at:

```text
http://localhost:1111
```

It then:

1. Resolves intent into `trigger`, `read`, `loop`, and `notify` primitives.
2. Asks structured questions for missing notification details.
3. Answers those questions through the `onQuestion` hook.
4. Matches the resolved intent to real demo capabilities.
5. Creates a workflow-like graph artifact.
6. Checks that the artifact can run.
7. Fetches live ETH/USD spot prices.
8. Posts webhook notifications.
9. Emits trace events through one event sink.

The demo app is split by responsibility:

```text
demo.ts                    tiny launcher
demo1/core/domain.ts        semantic domain and LLM intent policy
demo1/core/capabilities.ts  real product capability mapping
demo1/core/artifact.ts      graph artifact creation and readiness checks
demo1/core/runner.ts        real execution side effects
demo1/core/policy.ts        demo ID/value normalization
demo1/core/fixtures.ts      fixed non-interactive question answers
demo1/core/workflow.ts      createWorkflow wiring
demo1/adapters/cli.ts       terminal adapter
```

Set a webhook target with:

```bash
V4_WEBHOOK_URL="https://example.com/webhook" pnpm intent:demo
```

By default, interval waits are compressed so the demo is quick. To wait for the
real interval between iterations:

```bash
V4_REAL_WAIT=1 pnpm intent:demo
```

## Demo 2: Eval-Exec Loop

`demo2/` contains the eval-exec product demo: prepare, execute, evaluate,
decide, fix, and retry until the configured result condition is met. It follows
the same app-owned convention as `demo1`: domain logic lives under
`demo2/core/`, runtime and operation wiring under `demo2/runtime/`, concrete
workers and stores under `demo2/infrastructure/`, and operating surfaces under
`demo2/adapters/`.

Demo2 is intentionally heavier than demo1. It is the reference app for the
low-level harness runtime: checkpoints, operation sessions, rerun,
pause/cancel, graph projection, worker item streams, retry budgets, and
`goto(...)` loop decisions. The generic mechanics live in `src/sdk`; eval-exec
prompts, thresholds, graph ids, operation labels, and worker policy stay in
`demo2`.

```bash
pnpm intent:demo2 "make this good"
pnpm intent:mcp
pnpm intent:sidecar
```

## Checks

```bash
pnpm intent:check
pnpm intent:test
pnpm intent:check:graph
pnpm intent:check:graph:operation
```

## SDK Entry

The package entrypoint exports the v4 SDK:

```ts
export * from "./src/sdk/index.js";
```

Running `tsx intent-sdk/index.ts` prints a pointer to `pnpm intent:demo`; it
does not execute the legacy v3 CLI path.

## Layout

The generic SDK is intentionally small:

```text
src/sdk/
demo1/
demo2/
```
