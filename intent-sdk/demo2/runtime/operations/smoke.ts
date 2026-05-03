import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  applyOperationAction,
  getOperationProjectionState,
  recordWorkflowOperation,
  startWorkflowOperation,
} from "../../core/services/operations.js";
import { EVAL_EXEC_PREPARE_WORKFLOW_KEY } from "../../core/workflows/eval-exec.prepare/contract.js";
import { EVAL_EXEC_RUN_WORKFLOW_KEY } from "../../core/workflows/eval-exec.run/contract.js";
import { FileOperationStore } from "../../infrastructure/operations/file-store.js";
import { InMemoryOperationStore } from "../../infrastructure/operations/memory-store.js";

const runOutput = { phase: "passed", events: [] };

await assertActionResultIncludesSessionId();
await assertActionPreconditionsAreEnforced();
await assertOriginMetadataAndPrepareBypass();
await assertWorkflowTerminalEvents();
await assertEvaluatorFailureMarksEvaluatorNode();
await assertOperationTargetsUseContractKinds();
await assertPromptRenderedEventsUseNodePromptConvention();
await assertManualStepContinueAction();
await assertPauseResumeAndCheckpointRerun();
await assertCancelWhilePaused();
await assertAllCheckpointNodesCanCreateChildReruns();
await assertFileStoreSubscription();

console.log("operation smoke passed");

async function assertActionResultIncludesSessionId() {
  const store = new InMemoryOperationStore();
  await recordWorkflowOperation(
    store,
    EVAL_EXEC_RUN_WORKFLOW_KEY,
    { task: "verify action contract" },
    async () => runOutput,
    "http"
  );
  const [session] = await store.listSessions();
  if (!session) throw new Error("Expected operation session.");

  const result = (await applyOperationAction(
    store,
    session.sessionId,
    "claim-control",
    { expectedRevision: session.revision }
  )) as { sessionId?: string };
  if (result.sessionId !== session.sessionId)
    throw new Error("Action result did not include sessionId.");

  const rejected = (await applyOperationAction(
    store,
    session.sessionId,
    "pause",
    { leaseId: "wrong", expectedRevision: session.revision + 1 }
  )) as { sessionId?: string };
  if (rejected.sessionId !== session.sessionId)
    throw new Error("Rejected action result did not include sessionId.");
}

async function assertOriginMetadataAndPrepareBypass() {
  const store = new InMemoryOperationStore();
  await recordWorkflowOperation(
    store,
    EVAL_EXEC_RUN_WORKFLOW_KEY,
    { task: "verify mcp trigger" },
    async () => runOutput,
    "mcp"
  );
  const [session] = await store.listSessions();
  const trigger = session?.trigger as { kind?: string } | undefined;
  if (trigger?.kind !== "mcp")
    throw new Error(`Expected mcp trigger, got ${String(trigger?.kind)}`);

  const prepareResult = await recordWorkflowOperation(
    store,
    EVAL_EXEC_PREPARE_WORKFLOW_KEY,
    { intent: "draft only" },
    async () => ({ task: "draft only" }),
    "cli"
  );
  if (
    !(
      prepareResult &&
      typeof prepareResult === "object" &&
      "task" in prepareResult
    )
  )
    throw new Error("Expected prepare output.");
  const sessions = await store.listSessions();
  if (sessions.length !== 1)
    throw new Error(
      "Prepare workflow should not create a run operation session."
    );
}

async function assertActionPreconditionsAreEnforced() {
  const store = new InMemoryOperationStore();
  await recordWorkflowOperation(
    store,
    EVAL_EXEC_RUN_WORKFLOW_KEY,
    { task: "verify action preconditions" },
    async () => runOutput,
    "http"
  );
  const [session] = await store.listSessions();
  if (!session) throw new Error("Expected operation session.");

  const missingRevision = (await applyOperationAction(
    store,
    session.sessionId,
    "claim-control",
    {}
  )) as { status?: string; error?: { code?: string } };
  if (
    missingRevision.status !== "rejected" ||
    missingRevision.error?.code !== "REVISION_REQUIRED"
  ) {
    throw new Error("Expected missing expectedRevision to be rejected.");
  }

  const unknownAction = (await applyOperationAction(
    store,
    session.sessionId,
    "not-a-real-action",
    { expectedRevision: session.revision }
  )) as { status?: string; error?: { code?: string } };
  if (
    unknownAction.status !== "rejected" ||
    unknownAction.error?.code !== "UNKNOWN_ACTION"
  ) {
    throw new Error("Expected unknown action to be rejected.");
  }

  const unavailableAction = (await applyOperationAction(
    store,
    session.sessionId,
    "edit-next-input",
    { expectedRevision: session.revision }
  )) as { status?: string; error?: { code?: string } };
  if (
    unavailableAction.status !== "rejected" ||
    unavailableAction.error?.code !== "ACTION_UNAVAILABLE"
  ) {
    throw new Error("Expected deferred action to be rejected as unavailable.");
  }
}

async function assertWorkflowTerminalEvents() {
  const successStore = new InMemoryOperationStore();
  await recordWorkflowOperation(
    successStore,
    EVAL_EXEC_RUN_WORKFLOW_KEY,
    { task: "verify workflow success" },
    async () => runOutput,
    "http"
  );
  const [successSession] = await successStore.listSessions();
  if (!successSession) throw new Error("Expected success operation session.");
  const successEvents = await successStore.listEvents(successSession.sessionId);
  if (!successEvents.some((event) => event.type === "workflow.succeeded")) {
    throw new Error("Expected workflow.succeeded event.");
  }

  const failureStore = new InMemoryOperationStore();
  await recordWorkflowOperation(
    failureStore,
    EVAL_EXEC_RUN_WORKFLOW_KEY,
    { task: "verify workflow failure" },
    async () => {
      throw new Error("planned failure");
    },
    "http"
  ).catch(() => null);
  const [failureSession] = await failureStore.listSessions();
  if (!failureSession) throw new Error("Expected failure operation session.");
  const failureEvents = await failureStore.listEvents(failureSession.sessionId);
  if (!failureEvents.some((event) => event.type === "workflow.failed")) {
    throw new Error("Expected workflow.failed event.");
  }
}

async function assertEvaluatorFailureMarksEvaluatorNode() {
  const store = new InMemoryOperationStore();
  await recordWorkflowOperation(
    store,
    EVAL_EXEC_RUN_WORKFLOW_KEY,
    { task: "verify evaluator failure target" },
    async () => ({
      phase: "failed",
      events: [
        { type: "run:start", runId: "run-1" },
        { type: "execute:start", round: 1 },
        { type: "execute:end", round: 1, output: "attempt" },
        { type: "evaluate:start", round: 1 },
        { type: "run:end", runId: "run-1", phase: "failed" },
      ],
    }),
    "http"
  );
  const [session] = await store.listSessions();
  if (!session) throw new Error("Expected operation session.");

  const events = await store.listEvents(session.sessionId);
  const failedNode = events.find((event) => {
    const target = event.target as { nodeId?: string } | undefined;
    return event.type === "node.failed" && target?.nodeId === "evaluator";
  });
  if (!failedNode)
    throw new Error(
      "Expected evaluator node to be marked failed after evaluator failure."
    );
}

async function assertFileStoreSubscription() {
  const dataDir = await mkdtemp(
    path.join(tmpdir(), "eval-exec-v3-operations-")
  );
  const store = new FileOperationStore({ dataDir });
  await recordWorkflowOperation(
    store,
    EVAL_EXEC_RUN_WORKFLOW_KEY,
    { task: "verify file sse" },
    async () => runOutput,
    "cli"
  );
  const [session] = await store.listSessions();
  if (!session) throw new Error("Expected file operation session.");

  const observed = new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(
      () =>
        reject(
          new Error("Timed out waiting for file store subscription event.")
        ),
      1000
    );
    const unsubscribe = store.subscribe(session.sessionId, (event) => {
      if (event.type === "action.accepted") {
        clearTimeout(timeout);
        unsubscribe();
        resolve();
      }
    });
  });

  await applyOperationAction(store, session.sessionId, "claim-control", {
    expectedRevision: session.revision,
  });
  await observed;
}

async function assertOperationTargetsUseContractKinds() {
  const allowedTargetKinds = new Set([
    "session",
    "workflow",
    "node",
    "edge",
    "action",
    "checkpoint",
  ]);
  const store = new InMemoryOperationStore();
  await recordWorkflowOperation(
    store,
    EVAL_EXEC_RUN_WORKFLOW_KEY,
    { task: "verify target contract" },
    async () => runOutput,
    "http"
  );
  const [session] = await store.listSessions();
  if (!session) throw new Error("Expected operation session.");

  for (const event of await store.listEvents(session.sessionId)) {
    const target = event.target as { kind?: string } | undefined;
    if (!(target?.kind && allowedTargetKinds.has(target.kind))) {
      throw new Error(
        `Operation event used non-contract target kind: ${String(target?.kind)}`
      );
    }
  }
}

async function assertPromptRenderedEventsUseNodePromptConvention() {
  const store = new InMemoryOperationStore();
  await recordWorkflowOperation(
    store,
    EVAL_EXEC_RUN_WORKFLOW_KEY,
    { task: "verify prompt artifact" },
    async () => ({
      phase: "passed",
      events: [
        {
          type: "prompt:rendered",
          nodeId: "executor",
          templateKey: "executor",
          phase: "executor",
          round: 1,
          prompt: "You are the executor for round 1.",
        },
        { type: "run:end", runId: "run-1", phase: "passed" },
      ],
    }),
    "http"
  );
  const [session] = await store.listSessions();
  if (!session) throw new Error("Expected operation session.");
  const events = await store.listEvents(session.sessionId);
  const preparePromptEvent = events.find((event) => {
    const target = event.target as { nodeId?: string } | undefined;
    return (
      event.type === "node.prompt.rendered" &&
      target?.nodeId === "prepare-request"
    );
  });
  if (!preparePromptEvent)
    throw new Error("Expected prepare-request prompt event.");
  const preparePayload = preparePromptEvent.payload as
    | { raw?: string }
    | undefined;
  if (
    !preparePayload?.raw?.includes(
      "You are preparing an eval-exec v3 workflow request."
    )
  ) {
    throw new Error("Expected prepare prompt payload.");
  }
  const promptEvent = events.find((event) => {
    const target = event.target as { nodeId?: string } | undefined;
    return (
      event.type === "node.prompt.rendered" && target?.nodeId === "executor"
    );
  });
  const target = promptEvent?.target as { nodeId?: string } | undefined;
  const attributes = promptEvent?.attributes as
    | { templateKey?: string; phase?: string; round?: number }
    | undefined;
  const payload = promptEvent?.payload as
    | { raw?: string; preview?: string }
    | undefined;
  if (target?.nodeId !== "executor")
    throw new Error("Expected prompt event to target executor.");
  if (
    attributes?.templateKey !== "executor" ||
    attributes.phase !== "executor" ||
    attributes.round !== 1
  ) {
    throw new Error("Expected prompt event metadata.");
  }
  if (
    payload?.raw !== "You are the executor for round 1." ||
    !payload.preview
  ) {
    throw new Error("Expected prompt event payload.");
  }
}

async function assertManualStepContinueAction() {
  const store = new InMemoryOperationStore();
  const started = (await startWorkflowOperation(
    store,
    EVAL_EXEC_RUN_WORKFLOW_KEY,
    { task: "verify manual stepping", manualStepMode: true },
    async (onRunEvent) => {
      await onRunEvent?.({ type: "execute:start", round: 1 });
      await onRunEvent?.({ type: "execute:end", round: 1, output: "done" });
      return runOutput;
    },
    "http"
  )) as { sessionId?: string };
  const sessionId = started.sessionId;
  if (!sessionId) throw new Error("Expected manual operation session.");

  const waitingEvent = await waitForEvent(store, sessionId, "step.waiting");
  const target = waitingEvent.target as { nodeId?: string } | undefined;
  if (target?.nodeId !== "executor")
    throw new Error("Expected executor to wait for manual continue.");

  const waitingSession = await store.getSession(sessionId);
  if (waitingSession?.status !== "waiting")
    throw new Error("Expected manual session to wait.");
  const projection = (await getOperationProjectionState(store, sessionId)) as {
    nodes?: Record<string, { status?: string; availableActions?: string[] }>;
  };
  if (projection.nodes?.executor?.status !== "waiting")
    throw new Error("Expected executor projection to be waiting.");
  if (!projection.nodes.executor.availableActions?.includes("continue-step")) {
    throw new Error("Expected executor to expose continue-step.");
  }

  const rejected = (await applyOperationAction(
    store,
    sessionId,
    "continue-step",
    {
      expectedRevision: waitingSession.revision,
    }
  )) as { error?: { code?: string }; status?: string };
  if (
    rejected.status !== "rejected" ||
    rejected.error?.code !== "LEASE_CONFLICT"
  ) {
    throw new Error("Expected continue-step without a lease to be rejected.");
  }

  const claim = (await applyOperationAction(store, sessionId, "claim-control", {
    expectedRevision: waitingSession.revision,
  })) as { status?: string };
  if (claim.status !== "accepted")
    throw new Error("Expected claim-control to be accepted.");
  const claimedSession = await store.getSession(sessionId);
  const leaseId = (claimedSession?.control as { leaseId?: string } | undefined)
    ?.leaseId;
  if (!(claimedSession && leaseId))
    throw new Error("Expected operation lease.");

  const result = (await applyOperationAction(
    store,
    sessionId,
    "continue-step",
    {
      expectedRevision: claimedSession.revision,
      leaseId,
    }
  )) as { status?: string };
  if (result.status !== "accepted")
    throw new Error("Expected continue-step to be accepted.");
  await waitForSessionStatus(store, sessionId, "passed");
}

async function assertPauseResumeAndCheckpointRerun() {
  const store = new InMemoryOperationStore();
  const started = (await startWorkflowOperation(
    store,
    EVAL_EXEC_RUN_WORKFLOW_KEY,
    { task: "verify pause and rerun", workdir: "/tmp" },
    async (onRunEvent) => {
      await onRunEvent?.({
        type: "checkpoint:created",
        checkpointId: "checkpoint-executor",
        nodeId: "executor",
        round: 1,
        state: {
          nodeId: "executor",
          request: {
            task: "verify pause and rerun",
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
          currentPrompt: "verify pause and rerun",
          executionRound: 1,
          fixRound: 0,
        },
      });
      await new Promise((resolve) => setTimeout(resolve, 100));
      await onRunEvent?.({ type: "execute:start", round: 1 });
      await onRunEvent?.({ type: "execute:end", round: 1, output: "done" });
      return runOutput;
    },
    "http"
  )) as { sessionId?: string };
  const sessionId = started.sessionId;
  if (!sessionId) throw new Error("Expected operation session.");
  await waitForEvent(store, sessionId, "node.checkpointed");

  let session = await store.getSession(sessionId);
  if (!session) throw new Error("Expected saved session.");
  const claim = (await applyOperationAction(store, sessionId, "claim-control", {
    expectedRevision: session.revision,
  })) as { status?: string };
  if (claim.status !== "accepted")
    throw new Error("Expected claim-control to be accepted.");
  session = await store.getSession(sessionId);
  const control = session?.control as { leaseId?: string } | undefined;
  const leaseId = control?.leaseId;
  if (!(session && leaseId)) throw new Error("Expected operation lease.");

  const pause = (await applyOperationAction(store, sessionId, "pause", {
    expectedRevision: session.revision,
    leaseId,
  })) as { status?: string };
  if (pause.status !== "accepted")
    throw new Error("Expected pause to be accepted.");
  await waitForEvent(store, sessionId, "step.paused");
  session = await store.getSession(sessionId);
  if (session?.status !== "paused")
    throw new Error("Expected session to pause at boundary.");

  const resume = (await applyOperationAction(store, sessionId, "resume", {
    expectedRevision: session.revision,
    leaseId,
  })) as { status?: string };
  if (resume.status !== "accepted")
    throw new Error("Expected resume to be accepted.");
  await waitForSessionStatus(store, sessionId, "passed");

  session = await store.getSession(sessionId);
  if (!session) throw new Error("Expected terminal session.");
  const rerun = (await applyOperationAction(
    store,
    sessionId,
    "retry-from-checkpoint",
    {
      expectedRevision: session.revision,
      leaseId,
      input: {
        nodeId: "executor",
        checkpointId: "checkpoint-executor",
        promptOverride: "verify rerun override",
      },
    },
    undefined,
    {
      executeRerun: async (checkpoint, promptOverride, onRunEvent) => {
        if (checkpoint.nodeId !== "executor")
          throw new Error("Expected executor checkpoint.");
        if (promptOverride !== "verify rerun override")
          throw new Error("Expected prompt override.");
        await onRunEvent?.({
          type: "checkpoint:created",
          checkpointId: "child-result",
          nodeId: "result",
          round: 1,
          state: checkpoint,
        });
        return runOutput;
      },
    }
  )) as { childSessionId?: string; status?: string };
  if (rerun.status !== "accepted" || !rerun.childSessionId) {
    throw new Error(
      "Expected retry-from-checkpoint to create a child session."
    );
  }
  const child = await store.getSession(rerun.childSessionId);
  if (
    child?.parentSessionId !== sessionId ||
    child.parentCheckpointId !== "checkpoint-executor"
  ) {
    throw new Error("Expected rerun child session lineage.");
  }
}

async function assertCancelWhilePaused() {
  const store = new InMemoryOperationStore();
  const started = (await startWorkflowOperation(
    store,
    EVAL_EXEC_RUN_WORKFLOW_KEY,
    { task: "verify cancel while paused", workdir: "/tmp" },
    async (onRunEvent) => {
      await onRunEvent?.({
        type: "checkpoint:created",
        checkpointId: "checkpoint-cancel-executor",
        nodeId: "executor",
        round: 1,
        state: checkpointState("executor", "verify cancel while paused"),
      });
      await new Promise((resolve) => setTimeout(resolve, 100));
      await onRunEvent?.({ type: "execute:start", round: 1 });
      return runOutput;
    },
    "http"
  )) as { sessionId?: string };
  const sessionId = started.sessionId;
  if (!sessionId) throw new Error("Expected operation session.");
  await waitForEvent(store, sessionId, "node.checkpointed");

  let session = await store.getSession(sessionId);
  if (!session) throw new Error("Expected saved session.");
  await applyOperationAction(store, sessionId, "claim-control", {
    expectedRevision: session.revision,
  });
  session = await store.getSession(sessionId);
  const leaseId = (session?.control as { leaseId?: string } | undefined)
    ?.leaseId;
  if (!(session && leaseId)) throw new Error("Expected operation lease.");

  await applyOperationAction(store, sessionId, "pause", {
    expectedRevision: session.revision,
    leaseId,
  });
  await waitForEvent(store, sessionId, "step.paused");
  session = await store.getSession(sessionId);
  if (session?.status !== "paused")
    throw new Error("Expected paused session before cancel.");

  const cancel = (await applyOperationAction(store, sessionId, "cancel", {
    expectedRevision: session.revision,
    leaseId,
  })) as { status?: string };
  if (cancel.status !== "applied") throw new Error("Expected cancel to apply.");
  await waitForSessionStatus(store, sessionId, "cancelled");
  await waitForEvent(store, sessionId, "session.cancelled");
}

async function assertAllCheckpointNodesCanCreateChildReruns() {
  const nodeIds = [
    "prepare-request",
    "executor",
    "evaluator",
    "decision",
    "fixer",
    "result",
  ] as const;
  const store = new InMemoryOperationStore();
  const started = (await startWorkflowOperation(
    store,
    EVAL_EXEC_RUN_WORKFLOW_KEY,
    { task: "verify all checkpoint reruns", workdir: "/tmp" },
    async (onRunEvent) => {
      for (const nodeId of nodeIds) {
        await onRunEvent?.({
          type: "checkpoint:created",
          checkpointId: `checkpoint-${nodeId}`,
          nodeId,
          round: 1,
          state: checkpointState(nodeId, "verify all checkpoint reruns"),
        });
      }
      return runOutput;
    },
    "http"
  )) as { sessionId?: string };
  const sessionId = started.sessionId;
  if (!sessionId) throw new Error("Expected operation session.");
  await waitForSessionStatus(store, sessionId, "passed");

  let session = await store.getSession(sessionId);
  if (!session) throw new Error("Expected terminal session.");
  await applyOperationAction(store, sessionId, "claim-control", {
    expectedRevision: session.revision,
  });
  session = await store.getSession(sessionId);
  const leaseId = (session?.control as { leaseId?: string } | undefined)
    ?.leaseId;
  if (!(session && leaseId)) throw new Error("Expected operation lease.");

  for (const nodeId of nodeIds) {
    session = await store.getSession(sessionId);
    if (!session) throw new Error("Expected parent session.");
    const rerun = (await applyOperationAction(
      store,
      sessionId,
      "retry-from-checkpoint",
      {
        expectedRevision: session.revision,
        leaseId,
        input: {
          nodeId,
          checkpointId: `checkpoint-${nodeId}`,
          promptOverride: `override ${nodeId}`,
        },
      },
      undefined,
      {
        executeRerun: async (checkpoint, promptOverride, onRunEvent) => {
          if (checkpoint.nodeId !== nodeId)
            throw new Error(`Expected ${nodeId} checkpoint.`);
          if (promptOverride !== `override ${nodeId}`)
            throw new Error(`Expected ${nodeId} prompt override.`);
          await onRunEvent?.({
            type: "checkpoint:created",
            checkpointId: `child-${nodeId}`,
            nodeId: "result",
            round: 1,
            state: checkpoint,
          });
          return runOutput;
        },
      }
    )) as { childSessionId?: string; status?: string };
    if (rerun.status !== "accepted" || !rerun.childSessionId) {
      throw new Error(`Expected ${nodeId} rerun to create a child session.`);
    }
    const child = await store.getSession(rerun.childSessionId);
    const childRerun = child?.rerun as { nodeId?: string } | undefined;
    if (
      child?.parentSessionId !== sessionId ||
      child.parentCheckpointId !== `checkpoint-${nodeId}` ||
      childRerun?.nodeId !== nodeId
    ) {
      throw new Error(`Expected ${nodeId} child lineage.`);
    }
  }
}

function checkpointState(nodeId: string, task: string) {
  const attempt = {
    output: "attempt",
    evidence: ["evidence"],
    changedFiles: [],
    commands: [],
    summary: "attempt summary",
  };
  const evaluation = {
    passed: false,
    score: 0,
    reasons: ["needs work"],
    error: "needs work",
  };
  return {
    nodeId,
    request: {
      task,
      workdir: "/tmp",
      responseFormat: "human",
      successCriteria: ["Complete the requested task."],
      evaluationMode: "score",
      scoreThreshold: 0.995,
      rubric: ["The implementation must satisfy the task."],
      maxExecutionRounds: 2,
      maxFixRounds: 1,
      maxDepth: 1,
      manualStepMode: false,
    },
    currentPrompt: task,
    attempt,
    evaluation,
    executionRound: 1,
    fixRound: nodeId === "fixer" ? 0 : 1,
  };
}

async function waitForEvent(
  store: InMemoryOperationStore,
  sessionId: string,
  type: string
) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const event = (await store.listEvents(sessionId)).find(
      (entry) => entry.type === type
    );
    if (event) return event;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`Timed out waiting for ${type}.`);
}

async function waitForSessionStatus(
  store: InMemoryOperationStore,
  sessionId: string,
  status: string
) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const session = await store.getSession(sessionId);
    if (session?.status === status) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`Timed out waiting for session status ${status}.`);
}
