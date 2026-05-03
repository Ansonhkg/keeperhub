import { describe, expect, test } from "vitest";
import type { EvalExecWorkerPort } from "../../core/providers.js";
import {
  applyOperationAction,
  getOperationActions,
  getOperationProjectionState,
  recordWorkflowOperation,
  startWorkflowOperation,
} from "../../core/services/operations.js";
import {
  type RunLoopCheckpointState,
  runEvalExecFromCheckpoint,
  runEvalExecLoop,
} from "../../core/services/run-loop.js";
import { EVAL_EXEC_RUN_WORKFLOW_KEY } from "../../core/workflows/eval-exec.run/contract.js";
import { InMemoryOperationStore } from "../../infrastructure/operations/memory-store.js";
import { InMemoryRunStore } from "../../infrastructure/state/memory-store.js";

const runOutput = { phase: "passed", events: [] };

describe("operation controls", () => {
  test("checkpoint and prompt-rendered node events stay active until terminal success", async () => {
    const store = new InMemoryOperationStore();
    let unblockWorker: () => void = () => {};
    const workerBlocked = new Promise<void>((resolve) => {
      unblockWorker = resolve;
    });
    const started = (await startWorkflowOperation(
      store,
      EVAL_EXEC_RUN_WORKFLOW_KEY,
      { task: "active projection state test" },
      async (onRunEvent) => {
        await onRunEvent?.({
          type: "checkpoint:created",
          checkpointId: "active-checkpoint",
          nodeId: "executor",
          round: 1,
          state: checkpointState("active projection state test"),
        });
        await onRunEvent?.({
          type: "prompt:rendered",
          nodeId: "executor",
          templateKey: "executor",
          phase: "executor",
          round: 1,
          prompt: "Execute active projection state test",
        });
        await workerBlocked;
        await onRunEvent?.({ type: "execute:start", round: 1 });
        await onRunEvent?.({ type: "execute:end", round: 1, output: "done" });
        return runOutput;
      },
      "http"
    )) as { sessionId?: string };
    const sessionId = expectSessionId(started.sessionId);

    await waitForEvent(store, sessionId, "node.checkpointed");
    let projection = (await getOperationProjectionState(store, sessionId)) as {
      nodes?: Record<string, { status?: string }>;
    };
    expect(projection.nodes?.executor?.status).toBe("queued");

    await waitForNodeEvent(
      store,
      sessionId,
      "executor",
      "node.prompt.rendered"
    );
    projection = (await getOperationProjectionState(store, sessionId)) as {
      nodes?: Record<string, { status?: string }>;
    };
    expect(projection.nodes?.executor?.status).toBe("running");

    unblockWorker();
    await waitForNodeEvent(store, sessionId, "executor", "node.succeeded");
    projection = (await getOperationProjectionState(store, sessionId)) as {
      nodes?: Record<string, { status?: string }>;
    };
    expect(projection.nodes?.executor?.status).toBe("success");
  });

  test("worker item events show activity without making recoverable tool failures terminal", async () => {
    const store = new InMemoryOperationStore();
    const started = (await startWorkflowOperation(
      store,
      EVAL_EXEC_RUN_WORKFLOW_KEY,
      { task: "worker item stream projection test" },
      async (onRunEvent) => {
        await onRunEvent?.({ type: "execute:start", round: 1 });
        await onRunEvent?.({
          type: "worker.item.started",
          provider: "opencode",
          nodeId: "executor",
          phase: "executor",
          round: 1,
          itemId: "tool-read",
          itemKind: "tool_call",
          title: "Executor is using read",
          preview: "Executor is using read",
          rawType: "tool_use",
          raw: { tool: "read" },
        });
        await onRunEvent?.({
          type: "worker.item.failed",
          provider: "opencode",
          nodeId: "executor",
          phase: "executor",
          round: 1,
          itemId: "tool-read",
          itemKind: "tool_call",
          title: "Executor read failed",
          preview: "Executor read failed",
          rawType: "tool_use",
          raw: { tool: "read", status: "error" },
          error: "offset must be greater than or equal to 1",
        });
        return new Promise(() => undefined);
      },
      "http"
    )) as { sessionId?: string };
    const sessionId = expectSessionId(started.sessionId);
    await waitForEvent(store, sessionId, "worker.item.failed");

    const events = await store.listEvents(sessionId);
    expect(
      events.find((event) => {
        const target = event.target as { nodeId?: string } | undefined;
        return event.type === "node.started" && target?.nodeId === "executor";
      })?.payload
    ).toMatchObject({ preview: "Executor started round 1" });
    expect(events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "worker.item.failed",
          payload: expect.objectContaining({
            preview: "Executor read failed",
          }),
        }),
      ])
    );
    const projection = (await getOperationProjectionState(
      store,
      sessionId
    )) as {
      nodes?: Record<
        string,
        { status?: string; summary?: { preview?: string } }
      >;
    };
    expect(projection.nodes?.executor?.status).toBe("running");
    expect(projection.nodes?.executor?.summary?.preview).toBe(
      "Executor read failed"
    );
  });

  test("production run loop stores worker item events emitted by the worker", async () => {
    const store = new InMemoryOperationStore();
    const runStore = new InMemoryRunStore();
    const worker: EvalExecWorkerPort = {
      name: "emitting-worker",
      prepare: async () => ({}),
      execute: async (_request, _prompt, round, context) => {
        await context?.emit?.({
          type: "worker.item.started",
          provider: "test",
          nodeId: context.nodeId,
          phase: context.phase,
          round,
          itemId: "tool-read",
          itemKind: "tool_call",
          title: "Executor is using read",
          preview: "Executor is using read",
          rawType: "tool_use",
          raw: { tool: "read" },
        });
        return {
          complete: true,
          evidence: ["worker event persisted"],
          missingRequirements: [],
          output: "done",
        };
      },
      evaluate: async () => ({ passed: true, score: 1 }),
      fix: async (_request, input) => input.prompt,
    };
    const started = (await startWorkflowOperation(
      store,
      EVAL_EXEC_RUN_WORKFLOW_KEY,
      {
        task: "worker event persistence test",
        maxExecutionRounds: 1,
        maxFixRounds: 0,
      },
      (onRunEvent) =>
        runEvalExecLoop(
          {
            task: "worker event persistence test",
            maxExecutionRounds: 1,
            maxFixRounds: 0,
          },
          worker,
          runStore,
          undefined,
          onRunEvent
        ),
      "http"
    )) as { sessionId?: string };
    const sessionId = expectSessionId(started.sessionId);

    await waitForSessionStatus(store, sessionId, "passed");
    const events = await store.listEvents(sessionId);
    expect(events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "worker.item.started",
          target: expect.objectContaining({
            kind: "node",
            nodeId: "executor",
          }),
          payload: expect.objectContaining({
            preview: "Executor is using read",
          }),
        }),
      ])
    );
  });

  test("fatal non-cancelled failures are attributed to the latest active node", async () => {
    const store = new InMemoryOperationStore();
    const started = (await startWorkflowOperation(
      store,
      EVAL_EXEC_RUN_WORKFLOW_KEY,
      { task: "fatal evaluator attribution test" },
      async (onRunEvent) => {
        await onRunEvent?.({ type: "execute:start", round: 1 });
        await onRunEvent?.({
          type: "execute:end",
          round: 1,
          output: "attempt done",
        });
        await onRunEvent?.({ type: "evaluate:start", round: 1 });
        throw new Error("evaluator crashed");
      },
      "http"
    )) as { sessionId?: string };
    const sessionId = expectSessionId(started.sessionId);

    await waitForSessionStatus(store, sessionId, "failed");
    const events = await store.listEvents(sessionId);
    const failedNode = events.find((event) => event.type === "node.failed");
    expect(
      (failedNode?.target as { nodeId?: string } | undefined)?.nodeId
    ).toBe("evaluator");

    const projection = (await getOperationProjectionState(
      store,
      sessionId
    )) as {
      nodes?: Record<string, { status?: string }>;
    };
    expect(projection.nodes?.executor?.status).toBe("success");
    expect(projection.nodes?.evaluator?.status).toBe("error");
  });

  test("terminal failed and cancelled node events map to error and cancelled", async () => {
    const failedStore = new InMemoryOperationStore();
    const failed = (await startWorkflowOperation(
      failedStore,
      EVAL_EXEC_RUN_WORKFLOW_KEY,
      { task: "terminal failed projection state test" },
      async (onRunEvent) => {
        await onRunEvent?.({ type: "execute:start", round: 1 });
        throw new Error("worker failed");
      },
      "http"
    )) as { sessionId?: string };
    const failedSessionId = expectSessionId(failed.sessionId);

    await waitForSessionStatus(failedStore, failedSessionId, "failed");
    const failedProjection = (await getOperationProjectionState(
      failedStore,
      failedSessionId
    )) as { nodes?: Record<string, { status?: string }> };
    expect(failedProjection.nodes?.executor?.status).toBe("error");

    const cancelledStore = new InMemoryOperationStore();
    const cancelled = (await startWorkflowOperation(
      cancelledStore,
      EVAL_EXEC_RUN_WORKFLOW_KEY,
      { task: "terminal cancelled projection state test" },
      async (onRunEvent) => {
        await onRunEvent?.({ type: "execute:start", round: 1 });
        throw new Error("Operation cancelled.");
      },
      "http"
    )) as { sessionId?: string };
    const cancelledSessionId = expectSessionId(cancelled.sessionId);

    await waitForSessionStatus(cancelledStore, cancelledSessionId, "cancelled");
    const cancelledProjection = (await getOperationProjectionState(
      cancelledStore,
      cancelledSessionId
    )) as { nodes?: Record<string, { status?: string }> };
    expect(cancelledProjection.nodes?.executor?.status).toBe("cancelled");
  });

  test("async operation cancellation is attributed to the active node", async () => {
    const store = new InMemoryOperationStore();
    const started = (await startWorkflowOperation(
      store,
      EVAL_EXEC_RUN_WORKFLOW_KEY,
      { task: "active evaluator cancellation test" },
      async (onRunEvent) => {
        await onRunEvent?.({ type: "execute:start", round: 1 });
        await onRunEvent?.({ type: "execute:end", round: 1, output: "done" });
        await onRunEvent?.({ type: "evaluate:start", round: 1 });
        throw new Error("Operation cancelled.");
      },
      "http"
    )) as { sessionId?: string };
    const sessionId = expectSessionId(started.sessionId);

    await waitForSessionStatus(store, sessionId, "cancelled");
    const events = await store.listEvents(sessionId);
    expect(events.map((event) => event.type)).toContain("workflow.cancelled");
    expect(events.map((event) => event.type)).toContain("session.cancelled");
    expect(events.map((event) => event.type)).not.toContain("session.failed");
    const cancelledNode = events.find(
      (event) => event.type === "node.cancelled"
    );
    expect(
      (cancelledNode?.target as { nodeId?: string } | undefined)?.nodeId
    ).toBe("evaluator");

    const projection = (await getOperationProjectionState(
      store,
      sessionId
    )) as {
      nodes?: Record<string, { status?: string }>;
    };
    expect(projection.nodes?.executor?.status).toBe("success");
    expect(projection.nodes?.evaluator?.status).toBe("cancelled");
  });

  test("production run loop cancellation remains cancelled in operation history", async () => {
    const store = new InMemoryOperationStore();
    const runStore = new InMemoryRunStore();
    let finishExecute: () => void = () => {};
    const executeBlocked = new Promise<void>((resolve) => {
      finishExecute = resolve;
    });
    const worker: EvalExecWorkerPort = {
      name: "blocking-worker",
      prepare: async () => ({}),
      execute: async () => {
        await executeBlocked;
        return {
          complete: true,
          evidence: ["executor finished after cancellation request"],
          missingRequirements: [],
          output: "done",
        };
      },
      evaluate: async () => ({ passed: true, score: 1 }),
      fix: async (_request, input) => input.prompt,
    };
    const started = (await startWorkflowOperation(
      store,
      EVAL_EXEC_RUN_WORKFLOW_KEY,
      {
        task: "production cancellation path test",
        maxExecutionRounds: 1,
        maxFixRounds: 0,
      },
      (onRunEvent) =>
        runEvalExecLoop(
          {
            task: "production cancellation path test",
            maxExecutionRounds: 1,
            maxFixRounds: 0,
          },
          worker,
          runStore,
          undefined,
          onRunEvent
        ),
      "http"
    )) as { sessionId?: string };
    const sessionId = expectSessionId(started.sessionId);
    await waitForNodeEvent(store, sessionId, "executor", "node.started");

    let session = await requireStoredSession(store, sessionId);
    await applyOperationAction(store, sessionId, "claim-control", {
      expectedRevision: session.revision,
    });
    session = await requireStoredSession(store, sessionId);
    const leaseId = (session.control as { leaseId?: string } | undefined)
      ?.leaseId;
    expect(typeof leaseId).toBe("string");
    await applyOperationAction(store, sessionId, "cancel", {
      expectedRevision: session.revision,
      leaseId,
    });
    finishExecute();

    await waitForSessionStatus(store, sessionId, "cancelled");
    const events = await store.listEvents(sessionId);
    expect(events.map((event) => event.type)).toContain("workflow.cancelled");
    expect(events.map((event) => event.type)).toContain("session.cancelled");
    expect(events.map((event) => event.type)).not.toContain("session.failed");
    expect(
      events.some((event) => {
        const target = event.target as { nodeId?: string } | undefined;
        return event.type === "node.failed" && target?.nodeId === "result";
      })
    ).toBe(false);
    const projection = (await getOperationProjectionState(
      store,
      sessionId
    )) as {
      nodes?: Record<string, { status?: string }>;
    };
    expect(projection.nodes?.executor?.status).toBe("success");
    expect(projection.nodes?.evaluator?.status).toBe("cancelled");
    expect(projection.nodes?.result?.status).toBe("cancelled");
  });

  test("direct operation recording emits cancelled events for cancellation errors", async () => {
    const store = new InMemoryOperationStore();

    await expect(
      recordWorkflowOperation(
        store,
        EVAL_EXEC_RUN_WORKFLOW_KEY,
        { task: "direct cancellation event test" },
        async () => {
          throw new Error("Operation cancelled.");
        },
        "http"
      )
    ).rejects.toThrow("Operation cancelled.");

    const [session] = await store.listSessions();
    expect(session?.status).toBe("cancelled");
    const events = await store.listEvents(expectSessionId(session?.sessionId));
    expect(events.map((event) => event.type)).toContain("node.cancelled");
    expect(events.map((event) => event.type)).toContain("workflow.cancelled");
    expect(events.map((event) => event.type)).toContain("session.cancelled");
    expect(events.map((event) => event.type)).not.toContain("session.failed");

    const projection = (await getOperationProjectionState(
      store,
      expectSessionId(session?.sessionId)
    )) as { nodes?: Record<string, { status?: string }> };
    expect(projection.nodes?.executor?.status).toBe("cancelled");
  });

  test("manual continue requires a valid lease", async () => {
    const store = new InMemoryOperationStore();
    const started = (await startWorkflowOperation(
      store,
      EVAL_EXEC_RUN_WORKFLOW_KEY,
      { manualStepMode: true, task: "manual continue lease test" },
      async (onRunEvent) => {
        await onRunEvent?.({ type: "execute:start", round: 1 });
        await onRunEvent?.({ type: "execute:end", round: 1, output: "done" });
        return runOutput;
      },
      "http"
    )) as { sessionId?: string };
    const sessionId = expectSessionId(started.sessionId);
    await waitForEvent(store, sessionId, "step.waiting");

    const waiting = await requireStoredSession(store, sessionId);
    const rejected = (await applyOperationAction(
      store,
      sessionId,
      "continue-step",
      {
        expectedRevision: waiting.revision,
      }
    )) as { error?: { code?: string }; status?: string };
    expect(rejected.status).toBe("rejected");
    expect(rejected.error?.code).toBe("LEASE_CONFLICT");

    const projection = (await getOperationProjectionState(
      store,
      sessionId
    )) as {
      availableActions?: string[];
      nodes?: Record<string, { availableActions?: string[]; status?: string }>;
    };
    expect(projection.availableActions).not.toContain("continue-step");
    expect(projection.nodes?.executor?.availableActions).toContain(
      "continue-step"
    );
    const actions = (await getOperationActions(store, sessionId)) as {
      actions?: Array<{
        key?: string;
        target?: { kind?: string; nodeId?: string };
      }>;
    };
    expect(
      actions.actions?.some(
        (action) =>
          action.key === "continue-step" && action.target?.kind === "session"
      )
    ).toBe(false);
    expect(
      actions.actions?.some(
        (action) =>
          action.key === "continue-step" && action.target?.nodeId === "executor"
      )
    ).toBe(true);

    const claim = (await applyOperationAction(
      store,
      sessionId,
      "claim-control",
      {
        expectedRevision: waiting.revision,
      }
    )) as { status?: string };
    expect(claim.status).toBe("accepted");

    const claimed = await requireStoredSession(store, sessionId);
    const leaseId = (claimed.control as { leaseId?: string } | undefined)
      ?.leaseId;
    expect(typeof leaseId).toBe("string");

    const accepted = (await applyOperationAction(
      store,
      sessionId,
      "continue-step",
      {
        expectedRevision: claimed.revision,
        leaseId,
      }
    )) as { status?: string };
    expect(accepted.status).toBe("accepted");
    await waitForSessionStatus(store, sessionId, "passed");
  });

  test("cancel remains non-terminal until a safe boundary observes it", async () => {
    const store = new InMemoryOperationStore();
    let unblockWorker: () => void = () => {};
    const workerBlocked = new Promise<void>((resolve) => {
      unblockWorker = resolve;
    });
    const started = (await startWorkflowOperation(
      store,
      EVAL_EXEC_RUN_WORKFLOW_KEY,
      { task: "cooperative cancel test" },
      async (onRunEvent) => {
        await onRunEvent?.({
          type: "checkpoint:created",
          checkpointId: "cancel-checkpoint",
          nodeId: "executor",
          round: 1,
          state: checkpointState("cooperative cancel test"),
        });
        await workerBlocked;
        await onRunEvent?.({ type: "execute:start", round: 1 });
        return runOutput;
      },
      "http"
    )) as { sessionId?: string };
    const sessionId = expectSessionId(started.sessionId);
    await waitForEvent(store, sessionId, "node.checkpointed");

    let session = await requireStoredSession(store, sessionId);
    await applyOperationAction(store, sessionId, "claim-control", {
      expectedRevision: session.revision,
    });
    session = await requireStoredSession(store, sessionId);
    const leaseId = (session.control as { leaseId?: string } | undefined)
      ?.leaseId;
    expect(typeof leaseId).toBe("string");

    const cancel = (await applyOperationAction(store, sessionId, "cancel", {
      expectedRevision: session.revision,
      leaseId,
    })) as { status?: string };
    expect(cancel.status).toBe("applied");

    session = await requireStoredSession(store, sessionId);
    expect(session.status).toBe("cancelling");
    const actions = (await getOperationActions(store, sessionId)) as {
      actions?: Array<{ key?: string }>;
    };
    expect(
      actions.actions?.some((action) => action.key === "retry-from-checkpoint")
    ).toBe(false);

    unblockWorker();
    await waitForSessionStatus(store, sessionId, "cancelled");
    await waitForEvent(store, sessionId, "session.cancelled");
  });

  test("terminal sessions do not advertise unimplemented retry-session", async () => {
    const store = new InMemoryOperationStore();
    const started = (await startWorkflowOperation(
      store,
      EVAL_EXEC_RUN_WORKFLOW_KEY,
      { task: "terminal action test" },
      async () => runOutput,
      "http"
    )) as { sessionId?: string };
    const sessionId = expectSessionId(started.sessionId);
    await waitForSessionStatus(store, sessionId, "passed");

    const projection = (await getOperationProjectionState(
      store,
      sessionId
    )) as {
      availableActions?: string[];
    };
    const actions = (await getOperationActions(store, sessionId)) as {
      actions?: Array<{ key?: string }>;
    };
    expect(projection.availableActions).not.toContain("retry-session");
    expect(
      actions.actions?.some((action) => action.key === "retry-session")
    ).toBe(false);
    expect(actions.actions?.some((action) => action.key === "retry-node")).toBe(
      false
    );
    expect(actions.actions?.some((action) => action.key === "skip-node")).toBe(
      false
    );
  });

  test("expired control leases cannot steer operations", async () => {
    const store = new InMemoryOperationStore();
    const started = (await startWorkflowOperation(
      store,
      EVAL_EXEC_RUN_WORKFLOW_KEY,
      { manualStepMode: true, task: "expired lease test" },
      async (onRunEvent) => {
        await onRunEvent?.({ type: "execute:start", round: 1 });
        await onRunEvent?.({ type: "execute:end", round: 1, output: "done" });
        return runOutput;
      },
      "http"
    )) as { sessionId?: string };
    const sessionId = expectSessionId(started.sessionId);
    await waitForEvent(store, sessionId, "step.waiting");

    let session = await requireStoredSession(store, sessionId);
    await applyOperationAction(store, sessionId, "claim-control", {
      expectedRevision: session.revision,
    });
    session = await requireStoredSession(store, sessionId);
    const leaseId = (session.control as { leaseId?: string } | undefined)
      ?.leaseId;
    expect(typeof leaseId).toBe("string");
    session.control = {
      ...(session.control as Record<string, unknown>),
      expiresAt: new Date(Date.now() - 1000).toISOString(),
    };
    await store.saveSession(session);

    const rejected = (await applyOperationAction(
      store,
      sessionId,
      "continue-step",
      {
        expectedRevision: session.revision,
        leaseId,
      }
    )) as { error?: { code?: string }; status?: string };
    expect(rejected.status).toBe("rejected");
    expect(rejected.error?.code).toBe("LEASE_EXPIRED");
  });

  test("rerun child sessions preserve adapter origin", async () => {
    const store = new InMemoryOperationStore();
    const started = (await startWorkflowOperation(
      store,
      EVAL_EXEC_RUN_WORKFLOW_KEY,
      { task: "origin rerun test" },
      async (onRunEvent) => {
        await onRunEvent?.({
          type: "checkpoint:created",
          checkpointId: "origin-checkpoint",
          nodeId: "executor",
          round: 1,
          state: checkpointState("origin rerun test"),
        });
        return runOutput;
      },
      "http"
    )) as { sessionId?: string };
    const sessionId = expectSessionId(started.sessionId);
    await waitForSessionStatus(store, sessionId, "passed");
    let session = await requireStoredSession(store, sessionId);
    await applyOperationAction(store, sessionId, "claim-control", {
      expectedRevision: session.revision,
    });
    session = await requireStoredSession(store, sessionId);
    const leaseId = (session.control as { leaseId?: string } | undefined)
      ?.leaseId;

    const rerun = (await applyOperationAction(
      store,
      sessionId,
      "retry-from-checkpoint",
      {
        expectedRevision: session.revision,
        leaseId,
        input: { checkpointId: "origin-checkpoint", nodeId: "executor" },
      },
      undefined,
      {
        origin: "cli",
        executeRerun: async () => runOutput,
      }
    )) as { childSessionId?: string; status?: string };
    expect(rerun.status).toBe("accepted");
    const child = await requireStoredSession(
      store,
      expectSessionId(rerun.childSessionId)
    );
    expect((child.trigger as { kind?: string } | undefined)?.kind).toBe("cli");
  });

  test("rerun child source input preserves full checkpoint request metadata", async () => {
    const store = new InMemoryOperationStore();
    const started = (await startWorkflowOperation(
      store,
      EVAL_EXEC_RUN_WORKFLOW_KEY,
      { task: "source input rerun test" },
      async (onRunEvent) => {
        await onRunEvent?.({
          type: "checkpoint:created",
          checkpointId: "source-input-checkpoint",
          nodeId: "executor",
          round: 1,
          state: checkpointState("source input rerun test"),
        });
        return runOutput;
      },
      "http"
    )) as { sessionId?: string };
    const sessionId = expectSessionId(started.sessionId);
    await waitForSessionStatus(store, sessionId, "passed");
    let session = await requireStoredSession(store, sessionId);
    await applyOperationAction(store, sessionId, "claim-control", {
      expectedRevision: session.revision,
    });
    session = await requireStoredSession(store, sessionId);
    const leaseId = (session.control as { leaseId?: string } | undefined)
      ?.leaseId;

    const rerun = (await applyOperationAction(
      store,
      sessionId,
      "retry-from-checkpoint",
      {
        expectedRevision: session.revision,
        leaseId,
        input: {
          checkpointId: "source-input-checkpoint",
          nodeId: "executor",
          promptOverride: "override source input",
        },
      },
      undefined,
      {
        origin: "http",
        executeRerun: async () => runOutput,
      }
    )) as { childSessionId?: string; status?: string };
    expect(rerun.status).toBe("accepted");
    const child = await requireStoredSession(
      store,
      expectSessionId(rerun.childSessionId)
    );
    const sourceInput = child.sourceInput as
      | { scoreThreshold?: number; successCriteria?: string[]; task?: string }
      | undefined;
    expect(sourceInput?.task).toBe("override source input");
    expect(sourceInput?.scoreThreshold).toBe(0.995);
    expect(sourceInput?.successCriteria).toEqual([
      "Complete the requested task.",
    ]);
  });

  test("later-node rerun child source input uses checkpoint current prompt", async () => {
    const store = new InMemoryOperationStore();
    const started = (await startWorkflowOperation(
      store,
      EVAL_EXEC_RUN_WORKFLOW_KEY,
      { task: "later node source input test" },
      async (onRunEvent) => {
        await onRunEvent?.({
          type: "checkpoint:created",
          checkpointId: "later-source-input-checkpoint",
          nodeId: "evaluator",
          round: 1,
          state: {
            ...checkpointState("later node source input test"),
            currentPrompt: "later node repaired prompt",
            nodeId: "evaluator",
          },
        });
        return runOutput;
      },
      "http"
    )) as { sessionId?: string };
    const sessionId = expectSessionId(started.sessionId);
    await waitForSessionStatus(store, sessionId, "passed");
    let session = await requireStoredSession(store, sessionId);
    await applyOperationAction(store, sessionId, "claim-control", {
      expectedRevision: session.revision,
    });
    session = await requireStoredSession(store, sessionId);
    const leaseId = (session.control as { leaseId?: string } | undefined)
      ?.leaseId;

    const rerun = (await applyOperationAction(
      store,
      sessionId,
      "retry-from-checkpoint",
      {
        expectedRevision: session.revision,
        leaseId,
        input: {
          checkpointId: "later-source-input-checkpoint",
          nodeId: "evaluator",
        },
      },
      undefined,
      {
        origin: "http",
        executeRerun: async () => runOutput,
      }
    )) as { childSessionId?: string; status?: string };
    expect(rerun.status).toBe("accepted");
    const child = await requireStoredSession(
      store,
      expectSessionId(rerun.childSessionId)
    );
    const sourceInput = child.sourceInput as
      | { scoreThreshold?: number; successCriteria?: string[]; task?: string }
      | undefined;
    expect(sourceInput?.task).toBe("later node repaired prompt");
    expect(sourceInput?.scoreThreshold).toBe(0.995);
    expect(sourceInput?.successCriteria).toEqual([
      "Complete the requested task.",
    ]);
  });

  test("checkpoint rerun downstream execution uses later-node current prompt", async () => {
    const runStore = new InMemoryRunStore();
    let fixerInputPrompt = "";
    let executePrompt = "";
    const worker: EvalExecWorkerPort = {
      name: "test",
      async prepare() {
        throw new Error("prepare should not run for checkpoint rerun.");
      },
      async execute(_request, prompt) {
        executePrompt = prompt;
        return {
          complete: true,
          evidence: ["verified"],
          missingRequirements: [],
          output: `executed ${prompt}`,
        };
      },
      async evaluate() {
        return { passed: true, score: 1 };
      },
      async fix(_request, input) {
        fixerInputPrompt = input.prompt;
        return `${input.prompt} | fixed`;
      },
    };
    const checkpoint: RunLoopCheckpointState = {
      nodeId: "fixer",
      request: {
        ...checkpointState("original task").request,
        evaluationMode: "score",
        maxExecutionRounds: 2,
        responseFormat: "human",
      },
      currentPrompt: "later node repaired prompt",
      attempt: {
        complete: false,
        evidence: ["partial"],
        missingRequirements: ["needs fix"],
        output: "partial",
      },
      evaluation: {
        error: "needs fix",
        passed: false,
        score: 0.2,
      },
      executionRound: 1,
      fixRound: 0,
    };

    const result = await runEvalExecFromCheckpoint(
      checkpoint,
      undefined,
      worker,
      runStore
    );

    expect(result.phase).toBe("passed");
    expect(fixerInputPrompt).toBe("later node repaired prompt");
    expect(executePrompt).toBe("later node repaired prompt | fixed");
  });
});

function checkpointState(task: string) {
  return {
    nodeId: "executor",
    request: {
      task,
      workdir: "/tmp",
      responseFormat: "human",
      successCriteria: ["Complete the requested task."],
      evaluationMode: "score",
      scoreThreshold: 0.995,
      rubric: ["The implementation must satisfy the task."],
      maxExecutionRounds: 1,
      maxFixRounds: 0,
      maxDepth: 1,
      manualStepMode: false,
    },
    currentPrompt: task,
    executionRound: 1,
    fixRound: 0,
  };
}

function expectSessionId(sessionId: string | undefined): string {
  expect(typeof sessionId).toBe("string");
  return sessionId as string;
}

async function requireStoredSession(
  store: InMemoryOperationStore,
  sessionId: string
) {
  const session = await store.getSession(sessionId);
  expect(session).toBeDefined();
  return session!;
}

async function waitForEvent(
  store: InMemoryOperationStore,
  sessionId: string,
  type: string
) {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const event = (await store.listEvents(sessionId)).find(
      (entry) => entry.type === type
    );
    if (event) return event;
    await sleep(50);
  }
  throw new Error(`Timed out waiting for ${type}.`);
}

async function waitForNodeEvent(
  store: InMemoryOperationStore,
  sessionId: string,
  nodeId: string,
  type: string
) {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const event = (await store.listEvents(sessionId)).find((entry) => {
      const target = entry.target as { nodeId?: string } | undefined;
      return entry.type === type && target?.nodeId === nodeId;
    });
    if (event) return event;
    await sleep(50);
  }
  throw new Error(`Timed out waiting for ${nodeId} ${type}.`);
}

async function waitForSessionStatus(
  store: InMemoryOperationStore,
  sessionId: string,
  status: string
) {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const session = await store.getSession(sessionId);
    if (session?.status === status) return session;
    await sleep(50);
  }
  throw new Error(`Timed out waiting for session status ${status}.`);
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
