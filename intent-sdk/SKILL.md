# intent-sdk v4 Integration Skill

Use this skill when wiring `intent-sdk` v4 into an application that turns a
plain-English request into a resolved intent, real product capabilities, a
runnable artifact, and trace events.

## Goal

Keep the SDK generic and put product policy in the app.

The SDK owns:

- domain and primitive types
- generic intent contract normalization
- resolver interface
- harness/session/events/questions/answers
- capability catalog interfaces
- workflow orchestration

The app owns:

- semantic domain instructions
- product capability catalog
- requirement aliases and value normalization
- artifact shape
- artifact readiness checks
- real runner side effects
- UI/CLI question answering

## Public API Shape

`intent-sdk` v4 is one SDK with two API layers, not two unrelated SDKs.

```text
intent-sdk
  Core / low-level
    intent
    harness
    step
    events
    questions
    hooks/resume

  Product Builder / high-level
    createWorkflow
    capability
    artifact creation
    readiness checks
    runner
```

Use the Product Builder layer when the app wants the standard flow:

```text
prompt -> intent -> questions -> capabilities -> artifact -> check -> run
```

Use the Core Harness layer when the app needs to define its own orchestration:

```text
prepare -> execute -> evaluate -> decide -> fix -> retry -> result
```

The high-level Product Builder is implemented on top of the low-level harness.
`createWorkflow(...)` builds an internal `harness(...)` with steps for
`understandRequest`, `matchCapabilities`, `createArtifact`, `checkArtifact`,
and `runArtifact`.

```ts
import { createWorkflow, capability, domain } from "../src/sdk/index.ts";

const workflow = createWorkflow({
  domain,
  capabilities,
  createArtifact,
  checkArtifact,
  runArtifact,
});
```

```ts
import { ask, done, goto, harness, retry, step } from "../src/sdk/index.ts";

const customHarness = harness({
  id: "custom.loop",
  steps: [
    step("prepare", async () => done()),
    step.ai("execute", { run: async () => done() }),
    step("decide", async () => goto("execute", "Try again.")),
  ],
});
```

Do not force app authors into `harness(...)` when `createWorkflow(...)` is the
right abstraction. Do not force custom orchestration into `createWorkflow(...)`
when the product needs explicit steps and loop decisions.

## Reference Layout

Use `demo1/` as the reference workflow-builder implementation. Keep
product/workflow logic in `demo1/core/`, and put operating surfaces in
`demo1/adapters/`.

```text
demo1/core/domain.ts        semantic domain and LLM intent policy
demo1/core/capabilities.ts  product capability mapping
demo1/core/artifact.ts      artifact types, creation, and readiness checks
demo1/core/runner.ts        real execution side effects
demo1/core/policy.ts        ID/value normalization
demo1/core/fixtures.ts      fixed non-interactive question answers
demo1/core/workflow.ts      createWorkflow wiring
demo1/adapters/cli.ts       terminal adapter
demo1/adapters/http.ts      optional future HTTP adapter
demo1/adapters/mcp.ts       optional future MCP adapter
demo.ts                    tiny CLI launcher
```

Use `demo2/` as the eval-exec-loop product demo. Keep prepare/executor/evaluator
policy in `demo2/core`, runtime and operation sessions in `demo2/runtime`,
concrete stores/workers in `demo2/infrastructure`, and CLI/HTTP/MCP in
`demo2/adapters`.

`demo1` should use the high-level Product Builder API. `demo2` should
use the low-level Core Harness API directly for its eval-exec loop. Keep
eval-exec-specific runtime behavior in `demo2`, not `src/sdk`.

For another app, create the same core/adapters split in that app. Do not put
product-specific rules in `src/sdk`, and do not treat CLI as the only way to
operate the workflow.

## Integration Steps

1. Define the semantic domain in an app-owned file.

```ts
import { domain, primitive } from "../src/sdk/index.ts";

export const appDomain = domain({
  id: "my-product",
  intent: {
    baseUrl: "http://localhost:1111",
    kind: "my_product_intent",
    instructions: [
      "Explain the product-specific extraction policy here.",
    ],
    questionConstraintsForRequirement({ requirement }) {
      return {
        fallbackPrompt: `What value should be used for ${requirement.label}?`,
        id: requirement.id,
        requirementId: requirement.id,
        title: requirement.label,
        type: "text",
      };
    },
  },
  primitives: [
    primitive({ id: "trigger", description: "Starts work." }),
    primitive({ id: "read", description: "Reads data." }),
    primitive({ id: "notify", description: "Sends a notification." }),
  ],
});
```

Question wording should normally come from the LLM because it has the prompt
context. App code should declare constraints such as question type, allowed
options, title, and fallback copy through `questionConstraintsForRequirement`.
Use `fallbackPrompt` only for cases where the LLM omitted question text.

2. Define real product capabilities.

Use `capability({ primitive, order, match, mapInput })`. Requirement aliases,
defaults, and normalization belong here or in an app-owned policy helper.

```ts
import { capability } from "../src/sdk/index.ts";

export const appCapabilities = [
  capability({
    id: "product.action",
    primitive: "read",
    title: "Read product data",
    order: 10,
    mapInput: ({ requirementValue }) => ({
      target: requirementValue(["target", "read_target"]),
    }),
  }),
];
```

3. Create and check the artifact.

The SDK does not know whether the product artifact is a graph, JSON document,
workflow definition, API payload, or something else.

```ts
export function createArtifact({ plan }) {
  return {
    nodes: plan.items.map((item) => ({
      id: item.id,
      type: item.capabilityId,
      config: item.input,
    })),
  };
}

export function checkArtifact({ artifact }) {
  const invalid = artifact.nodes.find((node) => !node.type);
  return invalid
    ? { ok: false, reason: `${invalid.id} is not runnable.` }
    : { ok: true };
}
```

4. Implement the runner.

Runners should emit product events through `emit(...)`. If real side effects
fail, return `{ status: "failed", error }` so the workflow does not pretend to
complete.

```ts
export async function runArtifact({ artifact, emit }) {
  emit({
    artifactRunId: "run_1",
    type: "artifact.run.started",
    message: "Artifact run started.",
  });
  // Execute the product artifact.
  emit({
    artifactRunId: "run_1",
    type: "artifact.run.completed",
    message: "Artifact run completed.",
  });
  return { status: "completed", runId: "run_1" };
}
```

The SDK owns core lifecycle events such as `run.started`, `step.started`,
`step.completed`, `step.failed`, `run.completed`, and `run.failed`. Product
runners should use domain-specific event names such as `artifact.run.started`,
`run.node.completed`, or `notification.sent` so UI adapters can distinguish SDK
orchestration from product execution.

5. Wire the workflow.

```ts
import { createWorkflow } from "../src/sdk/index.ts";

export const workflow = createWorkflow({
  domain: appDomain,
  capabilities: appCapabilities,
  createArtifact,
  checkArtifact,
  runArtifact,
});
```

6. Run from UI, CLI, or tests.

```ts
const result = await workflow.run({
  prompt,
  onQuestion(question) {
    return answerFromUIOrFixture(question);
  },
  onEvent(event) {
    renderOrStoreEvent(event);
  },
});
```

## Event Log Contract

Every emitted event is enriched by the SDK before it reaches `onEvent`:

```ts
type EventRecord = {
  index: number;
  runId: string;
  correlationId: string;
  timestamp: string;
  type: string;
  message: string;
  stepId?: string;
  attempt?: number;
  detail?: unknown;
};
```

Use this event log as the source of truth for UI projections, trace panes,
streaming adapters, and future resume hooks. Do not render orchestration state
from ad hoc private SDK state when an event is available.

Important rules:

- `index` is monotonic within a run.
- `runId` identifies the workflow/harness run.
- `correlationId` groups events for a step attempt or runtime action.
- `attempt` increments when a step retries.
- Step code can read `context.step.id`, `context.step.attempt`,
  `context.step.runId`, `context.step.correlationId`, and
  `context.step.idempotencyKey` for idempotent side effects.
- Questions should later become durable wait/resume hook events; for now,
  `question.requested` and `question.answered` are still compatibility events.

## Hooks

Use hooks for durable wait/resume points that are not necessarily plain user
questions: approvals, external callbacks, manual gates, model overrides,
context injection, or product-specific steering.

Use questions when the wait point is specifically user-facing structured input
for intent resolution. Questions are bridged into hooks internally so adapters
can still render one generic wait/resume model.

Define a hook:

```ts
import { createHook, step, done } from "../src/sdk/index.ts";

const approvalRequired = createHook<{ prompt: string }, "approved" | "rejected">({
  id: "approval.required",
});

export const approveStep = step("approve", async (context) => {
  const answer = await context.waitFor(approvalRequired, {
    prompt: "Approve this action?",
  });

  return done({ answer });
});
```

Resume from a UI, CLI, HTTP route, MCP tool, or test:

```ts
await session.resumeHook({
  token: hookTokenFromEvent,
  value: "approved",
});
```

Adapters should watch for:

```text
hook.created
hook.waiting
hook.resumed
```

The `hook.waiting` event contains a `detail.hook` object:

```ts
type HookRequest = {
  id: string;
  token: string;
  stepId: string;
  correlationId: string;
  input: unknown;
  kind?: string;
};
```

Important rules:

- Resume by `token`, not by display label.
- Treat hook tokens as single-use.
- Render `kind: "question"` hooks with question UI if present.
- Keep hook input product-owned and explicit; do not hide product decisions in
  generic SDK code.
- Prefer creating hooks before side effects so rerunning a step after resume
  does not duplicate work.

## Core Harness Runtime

The current Core Harness API supports:

- `harness`
- `step`
- `step.intent`
- `step.ai`
- `ask`
- `done`
- `retry`
- `goto`
- `fail`
- event logs
- questions
- hooks
- resume
- checkpoint records
- pause/cancel/rerun controls
- graph projection metadata
- worker item streams
- configurable retry budgets and loop control
- durable stores behind generic interfaces

Demo2 now uses this low-level harness directly for its product-specific
eval-exec loop:

```text
prepare -> execute -> evaluate -> decide -> fix -> execute -> ... -> result
```

The SDK owns generic lifecycle mechanics: step execution, events,
checkpoints, hook resume, retry budgets, `goto(...)` transitions, worker item
event shape, graph projection metadata, and store ports. Demo2 owns the
product policy: prepare/executor/evaluator/fixer names, score thresholds,
OpenCode prompts, graph ids, MCP tool names, sidecar routes, and operation
labels.

When adding new runtime behavior, extract it into `src/sdk` only when it can be
named without eval-exec policy. Otherwise keep it in `demo2`.

Current extraction state:

1. Generic checkpoint/session records live in `harness`.
2. Generic controls include pause, resume, cancel, and rerun from checkpoint.
3. Generic worker item event types live in `harness`.
4. Generic retry/loop policy is expressed with step `maxRetries`, `retry(...)`,
   and `goto(...)`.
5. Demo2 depends on those generic contracts while keeping eval-exec policy in
   `demo2/core`.

## Rules For Agents

- Keep `src/sdk` generic.
- Put product/domain words in app-owned files such as `demo1/core/domain.ts` and
  `demo1/core/capabilities.ts`.
- Put UI, CLI, HTTP, MCP, or test harness entrypoints under adapter files such
  as `demo1/adapters/cli.ts` or `demo2/adapters/cli/main.ts`.
- Do not hardcode demo concepts like ETH, webhook, Slack, KeeperHub nodes, or
  product aliases inside `src/sdk`.
- Add readiness checks for required artifact fields before running.
- Add regression tests for SDK behavior in `src/sdk/*.test.ts`.
- Add product/demo tests near the product integration when testing product
  aliases or product artifact shape.

## Verification

After changes, run:

```bash
pnpm intent:check
pnpm intent:test
pnpm intent:demo "For every 15 seconds, check ETH price and notify me. Do that 3 times."
pnpm intent:demo2 "make this good"
pnpm intent:check:graph
pnpm intent:check:graph:operation
```
