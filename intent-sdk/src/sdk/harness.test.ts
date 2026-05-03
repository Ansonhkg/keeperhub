import { describe, expect, test } from "vitest";

import {
  ask,
  createHook,
  done,
  goto,
  harness,
  InMemoryHarnessStore,
  projectHarnessGraph,
  retry,
  step,
  workerItemEvent,
} from "./harness.js";

describe("harness event log", () => {
  test("adds run identity, monotonic indexes, step correlation, and step metadata", async () => {
    const observedStepMetadata: unknown[] = [];
    const app = harness<unknown, string>({
      id: "test.harness",
      steps: [
        step("inspect", (context) => {
          observedStepMetadata.push(context.step);
          context.emit({
            message: "Custom event.",
            type: "custom.event",
          });
          return done({ ok: true });
        }),
      ],
    });

    const session = await app.start("input", { runId: "run_test" });

    expect(session.runId).toBe("run_test");
    expect(session.events.map((event) => event.index)).toEqual(
      session.events.map((_, index) => index)
    );
    expect(session.events.every((event) => event.runId === "run_test")).toBe(
      true
    );
    expect(
      session.events.every((event) => event.correlationId.length > 0)
    ).toBe(true);
    expect(session.events[0]?.type).toBe("run.started");
    expect(session.events.at(-1)?.type).toBe("run.completed");

    const stepStarted = session.events.find(
      (event) => event.type === "step.started"
    );
    const custom = session.events.find(
      (event) => event.type === "custom.event"
    );
    expect(stepStarted).toMatchObject({
      attempt: 1,
      correlationId: "run:run_test:step:inspect:attempt:1",
      stepId: "inspect",
    });
    expect(custom).toMatchObject({
      attempt: 1,
      correlationId: "run:run_test:step:inspect:attempt:1",
    });
    expect(custom && "stepId" in custom).toBe(false);
    expect(observedStepMetadata).toEqual([
      {
        attempt: 1,
        correlationId: "run:run_test:step:inspect:attempt:1",
        id: "inspect",
        idempotencyKey: "run_test:inspect:1",
        runId: "run_test",
      },
    ]);
  });

  test("increments step attempt metadata after retry", async () => {
    const attempts: number[] = [];
    const app = harness({
      id: "retry.harness",
      steps: [
        step("sometimes", (context) => {
          attempts.push(context.step.attempt);
          return context.step.attempt === 1 ? retry("try again") : done("ok");
        }),
      ],
    });

    const session = await app.start("input", { runId: "run_retry" });

    expect(attempts).toEqual([1, 2]);
    expect(
      session.events.find((event) => event.type === "step.retrying")
    ).toMatchObject({
      attempt: 1,
      correlationId: "run:run_retry:step:sometimes:attempt:1",
      stepId: "sometimes",
    });
    const completed = session.events.filter(
      (event) => event.type === "step.completed"
    );
    expect(completed).toHaveLength(1);
    expect(completed[0]).toMatchObject({
      attempt: 2,
      correlationId: "run:run_retry:step:sometimes:attempt:2",
      stepId: "sometimes",
    });
  });

  test("uses step retry budgets instead of a global retry count", async () => {
    const attempts: number[] = [];
    const app = harness<unknown, string>({
      id: "retry.budget.harness",
      steps: [
        step(
          "sometimes",
          (context) => {
            attempts.push(context.step.attempt);
            return context.step.attempt < 4 ? retry("try again") : done("ok");
          },
          { maxRetries: 3 }
        ),
      ],
    });

    const session = await app.start("input", { runId: "run_retry_budget" });

    expect(session.status).toBe("completed");
    expect(attempts).toEqual([1, 2, 3, 4]);
    expect(
      session.events.filter((event) => event.type === "step.retrying")
    ).toHaveLength(3);
    expect(
      session.events.find((event) => event.type === "step.retrying")
    ).toMatchObject({
      detail: {
        maxRetries: 3,
        reason: "try again",
        retries: 1,
      },
    });
  });

  test("fails when a step exceeds its retry budget", async () => {
    const app = harness({
      id: "retry.fail.harness",
      steps: [step("always", () => retry("still bad"), { maxRetries: 0 })],
    });

    const session = await app.start("input", { runId: "run_retry_fail" });

    expect(session.status).toBe("failed");
    expect(
      session.events.find((event) => event.type === "step.failed")
    ).toMatchObject({
      detail: {
        maxRetries: 0,
        reason: "still bad",
      },
      stepId: "always",
    });
  });
});

describe("harness worker item events", () => {
  test("emits normalized worker item activity with step correlation", async () => {
    const app = harness<unknown, string>({
      id: "worker.harness",
      steps: [
        step.ai("execute", {
          run({ emit }) {
            emit(
              workerItemEvent({
                itemId: "item_1",
                itemKind: "model_step",
                preview: "Worker started",
                provider: "test-worker",
                providerRefs: { sessionId: "provider_session" },
                title: "Worker started",
                type: "worker.item.started",
              })
            );
            emit(
              workerItemEvent({
                itemId: "item_1",
                itemKind: "model_step",
                output: { complete: true },
                preview: "Worker completed",
                provider: "test-worker",
                title: "Worker completed",
                type: "worker.item.completed",
              })
            );
            return done({ complete: true });
          },
        }),
      ],
    });

    const session = await app.start("input", { runId: "run_worker" });
    const workerEvents = session.events.filter((event) =>
      event.type.startsWith("worker.item.")
    );

    expect(workerEvents).toHaveLength(2);
    expect(workerEvents[0]).toMatchObject({
      attempt: 1,
      correlationId: "run:run_worker:step:execute:attempt:1",
      itemId: "item_1",
      itemKind: "model_step",
      provider: "test-worker",
      providerRefs: { sessionId: "provider_session" },
      type: "worker.item.started",
    });
    expect("stepId" in workerEvents[0]!).toBe(false);
    expect(workerEvents[1]).toMatchObject({
      output: { complete: true },
      type: "worker.item.completed",
    });
  });
});

describe("harness checkpoints", () => {
  test("records generic checkpoints before each step run", async () => {
    const app = harness<unknown, { task: string }>({
      id: "checkpoint.harness",
      steps: [
        step("prepare", () => done({ prepared: true })),
        step("execute", () => done({ executed: true })),
      ],
    });

    const session = await app.start(
      { task: "ship it" },
      { runId: "run_checkpoint" }
    );

    expect(session.checkpoints).toHaveLength(2);
    expect(session.checkpoints[0]).toMatchObject({
      attempt: 1,
      eventIndex: 3,
      input: { task: "ship it" },
      runId: "run_checkpoint",
      state: {},
      stepId: "prepare",
    });
    expect(session.checkpoints[1]).toMatchObject({
      attempt: 1,
      input: { task: "ship it" },
      runId: "run_checkpoint",
      state: {
        prepare: { prepared: true },
        prepared: true,
      },
      stepId: "execute",
    });

    const checkpointEvents = session.events.filter(
      (event) => event.type === "checkpoint.created"
    );
    expect(checkpointEvents).toHaveLength(2);
    expect(checkpointEvents[0]).toMatchObject({
      attempt: 1,
      index: session.checkpoints[0]!.eventIndex,
      stepId: "prepare",
    });
    expect(checkpointEvents[0]!.detail).toEqual({
      checkpoint: session.checkpoints[0],
    });
  });

  test("records retry attempts as separate checkpoints", async () => {
    const app = harness({
      id: "checkpoint.retry.harness",
      steps: [
        step("sometimes", (context) =>
          context.step.attempt === 1
            ? retry("not yet", { firstAttemptSeen: true })
            : done({ ok: true })
        ),
      ],
    });

    const session = await app.start("input", { runId: "run_checkpoint_retry" });

    expect(
      session.checkpoints.map((checkpoint) => ({
        attempt: checkpoint.attempt,
        state: checkpoint.state,
        stepId: checkpoint.stepId,
      }))
    ).toEqual([
      { attempt: 1, state: {}, stepId: "sometimes" },
      { attempt: 2, state: { firstAttemptSeen: true }, stepId: "sometimes" },
    ]);
  });
});

describe("harness session controls", () => {
  test("pauses and resumes a waiting session with generic events", async () => {
    const app = harness({
      id: "pause.harness",
      steps: [
        step("ask", (context) =>
          context.answers.destination
            ? done({ answered: true })
            : ask({
                id: "destination",
                prompt: "Where should this go?",
                title: "Destination",
                type: "text",
              })
        ),
      ],
    });
    const session = await app.start("input", { runId: "run_pause" });

    await session.pause({ reason: "operator review" });

    expect(session.status).toBe("paused");
    expect(session.events.at(-1)).toMatchObject({
      detail: { reason: "operator review" },
      type: "run.paused",
    });

    await session.resume();

    expect(session.status).toBe("waiting");
    expect(
      session.events.find((event) => event.type === "run.resumed")
    ).toMatchObject({
      type: "run.resumed",
      runId: "run_pause",
    });
  });

  test("cancels a waiting session and prevents later resume", async () => {
    const app = harness({
      id: "cancel.harness",
      steps: [
        step("ask", (context) =>
          context.answers.destination
            ? done({ answered: true })
            : ask({
                id: "destination",
                prompt: "Where should this go?",
                title: "Destination",
                type: "text",
              })
        ),
      ],
    });
    const session = await app.start("input", { runId: "run_cancel" });

    await session.cancel({ reason: "user stopped" });
    await session.resume();

    expect(session.status).toBe("cancelled");
    expect(session.pendingHooks).toEqual([]);
    expect(session.pendingQuestions).toEqual([]);
    expect(session.events.at(-1)).toMatchObject({
      detail: { reason: "user stopped" },
      type: "run.cancelled",
    });
  });

  test("reruns from a checkpoint as a child session", async () => {
    const seen: Array<{ input: unknown; state: unknown; step: string }> = [];
    const app = harness({
      id: "rerun.harness",
      steps: [
        step("prepare", () => done({ prepared: true })),
        step("execute", (context) => {
          seen.push({
            input: context.input,
            state: { ...context.state },
            step: context.step.id,
          });
          return done({ executed: true });
        }),
      ],
    });
    const session = await app.start(
      { task: "ship it" },
      { runId: "run_parent" }
    );
    const executeCheckpoint = session.checkpoints.find(
      (checkpoint) => checkpoint.stepId === "execute"
    );

    const child = await session.rerunFromCheckpoint({
      checkpointId: executeCheckpoint!.checkpointId,
      runId: "run_child",
    });

    expect(child.runId).toBe("run_child");
    expect(child.parentRunId).toBe("run_parent");
    expect(child.parentCheckpointId).toBe(executeCheckpoint!.checkpointId);
    expect(child.status).toBe("completed");
    expect(child.events[0]).toMatchObject({
      type: "run.started",
      runId: "run_child",
    });
    expect(
      child.events.some(
        (event) => event.type === "step.started" && event.stepId === "prepare"
      )
    ).toBe(false);
    expect(
      child.events.some(
        (event) => event.type === "step.started" && event.stepId === "execute"
      )
    ).toBe(true);
    expect(seen.at(-1)).toEqual({
      input: { task: "ship it" },
      state: {
        prepare: { prepared: true },
        prepared: true,
      },
      step: "execute",
    });
    expect(session.events.at(-1)).toMatchObject({
      detail: {
        childRunId: "run_child",
        checkpoint: executeCheckpoint,
      },
      type: "run.rerun.created",
    });
  });
});

describe("harness stores", () => {
  test("persists sessions, events, and checkpoints through a generic store", async () => {
    const store = new InMemoryHarnessStore<string>();
    const app = harness<unknown, string>({
      id: "store.harness",
      steps: [step("prepare", () => done({ prepared: true }))],
    });

    const session = await app.start("input", {
      runId: "run_store",
      store,
    });

    expect(await store.getSession("run_store")).toMatchObject({
      input: "input",
      parentCheckpointId: undefined,
      parentRunId: undefined,
      runId: "run_store",
      status: "completed",
    });
    expect(await store.listEvents("run_store")).toEqual(session.events);
    expect(await store.listCheckpoints("run_store")).toEqual(
      session.checkpoints
    );
  });

  test("persists generic rerun actions and child session metadata", async () => {
    const store = new InMemoryHarnessStore<{ task: string }>();
    const app = harness<unknown, { task: string }>({
      id: "store.rerun.harness",
      steps: [
        step("prepare", () => done({ prepared: true })),
        step("execute", () => done({ executed: true })),
      ],
    });
    const session = await app.start(
      { task: "ship it" },
      {
        runId: "run_store_parent",
        store,
      }
    );
    const checkpoint = session.checkpoints.find(
      (item) => item.stepId === "execute"
    )!;

    const child = await session.rerunFromCheckpoint({
      checkpointId: checkpoint.checkpointId,
      runId: "run_store_child",
    });

    expect(await store.listActions("run_store_parent")).toEqual([
      expect.objectContaining({
        input: {
          checkpointId: checkpoint.checkpointId,
          childRunId: "run_store_child",
        },
        name: "rerunFromCheckpoint",
        runId: "run_store_parent",
      }),
    ]);
    expect(await store.getSession("run_store_child")).toMatchObject({
      input: { task: "ship it" },
      parentCheckpointId: checkpoint.checkpointId,
      parentRunId: "run_store_parent",
      runId: "run_store_child",
      status: "completed",
    });
    expect(await store.listEvents("run_store_child")).toEqual(child.events);
  });

  test("restores a waiting session and resumes it from a later action", async () => {
    const store = new InMemoryHarnessStore<string>();
    const app = harness<unknown, string>({
      id: "store.restore.harness",
      steps: [
        step("ask", (context) =>
          context.answers.destination
            ? done({ answered: true })
            : ask({
                id: "destination",
                prompt: "Where should this go?",
                title: "Destination",
                type: "text",
              })
        ),
        step("finish", (context) =>
          done({ destination: context.answers.destination })
        ),
      ],
    });
    const started = await app.start("input", {
      runId: "run_restore",
      store,
    });
    expect(started.status).toBe("waiting");

    const restored = await app.answer(
      "run_restore",
      {
        questionId: "destination",
        value: "https://example.com",
      },
      { store }
    );
    expect(restored.status).toBe("waiting");

    const resumed = await app.resume("run_restore", { store });

    expect(resumed.status).toBe("completed");
    expect(resumed.state.destination).toBe("https://example.com");
    expect(resumed.events.map((event) => event.index)).toEqual(
      resumed.events.map((_, index) => index)
    );
    expect(await store.getSession("run_restore")).toMatchObject({
      answers: { destination: "https://example.com" },
      runId: "run_restore",
      state: {
        destination: "https://example.com",
      },
      status: "completed",
    });
  });
});

describe("harness transitions", () => {
  test("lets a step continue at another generic step", async () => {
    const visits: string[] = [];
    const app = harness({
      id: "transition.harness",
      steps: [
        step("prepare", () => done({ count: 0 })),
        step("decide", (context) => {
          visits.push(`decide:${context.step.attempt}`);
          const count = Number(context.state.count ?? 0);
          return count < 1
            ? goto("fix", "score below threshold")
            : goto("result", "score passed");
        }),
        step("fix", (context) => {
          visits.push(`fix:${context.step.attempt}`);
          return goto("decide", "recheck after fix", {
            count: Number(context.state.count ?? 0) + 1,
          });
        }),
        step("result", (context) => {
          visits.push(`result:${context.step.attempt}`);
          return done({ count: context.state.count });
        }),
      ],
    });

    const session = await app.start("input", { runId: "run_goto" });

    expect(session.status).toBe("completed");
    expect(visits).toEqual(["decide:1", "fix:1", "decide:2", "result:1"]);
    expect(session.state.result).toEqual({ count: 1 });
    expect(
      session.events.filter((event) => event.type === "step.goto")
    ).toEqual([
      expect.objectContaining({
        attempt: 1,
        detail: {
          fromStepId: "decide",
          reason: "score below threshold",
          targetStepId: "fix",
        },
        stepId: "decide",
      }),
      expect.objectContaining({
        attempt: 1,
        detail: {
          fromStepId: "fix",
          reason: "recheck after fix",
          targetStepId: "decide",
        },
        stepId: "fix",
      }),
      expect.objectContaining({
        attempt: 2,
        detail: {
          fromStepId: "decide",
          reason: "score passed",
          targetStepId: "result",
        },
        stepId: "decide",
      }),
    ]);
  });

  test("fails clearly when a transition targets an unknown step", async () => {
    const app = harness({
      id: "transition.invalid.harness",
      steps: [step("decide", () => goto("missing"))],
    });

    const session = await app.start("input", { runId: "run_bad_goto" });

    expect(session.status).toBe("failed");
    expect(
      session.events.find((event) => event.type === "step.failed")
    ).toMatchObject({
      detail: {
        fromStepId: "decide",
        targetStepId: "missing",
      },
      message: "Unknown step target: missing",
      stepId: "decide",
    });
  });
});

describe("harness graph projection", () => {
  test("projects generic step metadata without product graph ids", () => {
    const app = harness({
      description: "Runs a generic sequence.",
      id: "custom.loop",
      label: "Custom Loop",
      steps: [
        step("prepare", () => done(), {
          description: "Prepare input.",
          kind: "setup",
          label: "Prepare",
        }),
        step.ai("execute", {
          kind: "worker",
          label: "Execute",
          maxRetries: 3,
          run: () => done(),
        }),
        step("result", () => done()),
      ],
    });

    expect(app.graph()).toEqual({
      description: "Runs a generic sequence.",
      edges: [
        {
          from: "prepare",
          id: "prepare->execute",
          kind: "sequence",
          to: "execute",
        },
        {
          from: "execute",
          id: "execute->result",
          kind: "sequence",
          to: "result",
        },
      ],
      id: "custom.loop",
      label: "Custom Loop",
      nodes: [
        {
          description: "Prepare input.",
          id: "prepare",
          kind: "setup",
          label: "Prepare",
          maxRetries: 1,
        },
        {
          description: undefined,
          id: "execute",
          kind: "worker",
          label: "Execute",
          maxRetries: 3,
        },
        {
          description: undefined,
          id: "result",
          kind: "step",
          label: "Result",
          maxRetries: 1,
        },
      ],
    });
  });

  test("projects a harness config without constructing a runner", () => {
    expect(
      projectHarnessGraph({
        id: "tiny.flow",
        steps: [step("first", () => done()), step("second", () => done())],
      })
    ).toMatchObject({
      edges: [
        { from: "first", id: "first->second", kind: "sequence", to: "second" },
      ],
      id: "tiny.flow",
      label: "Tiny Flow",
      nodes: [
        { id: "first", kind: "step", label: "First" },
        { id: "second", kind: "step", label: "Second" },
      ],
    });
  });
});

describe("harness hooks", () => {
  test("creates a token-addressable hook and resumes the step with its value", async () => {
    const approvalHook = createHook<{ prompt: string }, string>({
      id: "approval.required",
    });
    const app = harness({
      id: "hook.harness",
      steps: [
        step("approve", async (context) => {
          const value = await context.waitFor(approvalHook, {
            prompt: "Approve this action?",
          });
          return done({ value });
        }),
      ],
    });

    const session = await app.start("input", { runId: "run_hook" });

    expect(session.status).toBe("waiting");
    expect(session.pendingHooks).toHaveLength(1);
    expect(session.pendingHooks[0]).toMatchObject({
      correlationId: "run:run_hook:step:approve:attempt:1",
      id: "approval.required",
      input: { prompt: "Approve this action?" },
      stepId: "approve",
      token: "hook:run_hook:approve:1:0:approval_required",
    });
    expect(
      session.events.find((event) => event.type === "hook.waiting")
    ).toMatchObject({
      attempt: 1,
      correlationId: "run:run_hook:step:approve:attempt:1",
      stepId: "approve",
    });

    await session.resumeHook({
      token: session.pendingHooks[0]!.token,
      value: "approved",
    });

    expect(session.status).toBe("completed");
    expect(session.state.value).toBe("approved");
    expect(
      session.events.find((event) => event.type === "hook.resumed")
    ).toMatchObject({
      type: "hook.resumed",
      runId: "run_hook",
    });
  });

  test("rejects unknown and consumed hook tokens clearly", async () => {
    const approvalHook = createHook<{ prompt: string }, string>({
      id: "approval.required",
    });
    const app = harness({
      id: "hook.harness",
      steps: [
        step("approve", async (context) => {
          const value = await context.waitFor(approvalHook, {
            prompt: "Approve this action?",
          });
          return done({ value });
        }),
      ],
    });
    const session = await app.start("input", { runId: "run_hook_reuse" });
    const token = session.pendingHooks[0]!.token;

    await expect(
      session.resumeHook({
        token: "missing",
        value: "approved",
      })
    ).rejects.toThrow("Unknown hook token: missing");

    await session.resumeHook({ token, value: "approved" });

    await expect(
      session.resumeHook({
        token,
        value: "approved again",
      })
    ).rejects.toThrow(`Hook token has already been consumed: ${token}`);
  });

  test("bridges questions into hook wait and resume events", async () => {
    const app = harness({
      id: "question.harness",
      steps: [
        step("ask", () =>
          ask({
            id: "destination",
            prompt: "Where should this go?",
            title: "Destination",
            type: "text",
          })
        ),
      ],
    });
    const session = await app.start("input", { runId: "run_question_hook" });

    expect(session.pendingQuestions).toHaveLength(1);
    expect(session.pendingHooks).toHaveLength(1);
    expect(session.pendingHooks[0]).toMatchObject({
      id: "destination",
      kind: "question",
      token: "question:run_question_hook:destination",
    });

    await session.answer({
      questionId: "destination",
      value: "https://example.com",
    });

    expect(
      session.events.find((event) => event.type === "hook.resumed")
    ).toMatchObject({
      detail: {
        hook: expect.objectContaining({
          id: "destination",
          kind: "question",
        }),
        value: "https://example.com",
      },
    });
  });
});
