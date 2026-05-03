import {
  createOperationActionResult,
  createOperationActionsResponse,
  createOperationCapabilitiesResponse,
  createOperationEvent,
  createOperationEventsResponse,
  createOperationProjectionStateResponse,
  createOperationPromptRenderedEvent,
  createOperationSessionResponse,
  GRAPH_OPERATION_STANDARD_ACTION_INPUT_SCHEMA_IDS,
} from "@graph-sdk/sdk";
import type {
  OperationEventRecord,
  OperationSessionRecord,
  OperationStorePort,
} from "../providers.js";
import type { PrepareRequest, RunResponse } from "../schemas.js";
import { buildPreparePrompt } from "./prompt-builder.js";
import { normalizeText, resolveDefaultWorkdir } from "./request-policy.js";
import type {
  RunLoopCheckpointState,
  RunLoopEvent,
  RunLoopObserver,
} from "./run-loop.js";

const APP_KEY = "eval-exec-loop-v3";
const WORKFLOW_KEY = "eval-exec.run";
const GRAPH_KEY = "graph.eval-exec-v3.run";
const LEASE_TTL_MS = 30_000;
const DEFERRED_ACTION_KEYS = [
  "edit-next-input",
  "change-model",
  "change-threshold",
  "inject-context",
  "override-verdict",
] as const;
const OPERATION_NODE_IDS = [
  "prepare-request",
  "executor",
  "evaluator",
  "decision",
  "fixer",
  "result",
] as const;
type OperationOrigin = "http" | "mcp" | "cli" | "sdk";
type OperationNodeId = (typeof OPERATION_NODE_IDS)[number];
type OperationActionRuntime = {
  origin?: OperationOrigin;
  executeRerun?: (
    checkpoint: RunLoopCheckpointState,
    promptOverride: string | undefined,
    onRunEvent?: RunLoopObserver
  ) => Promise<unknown>;
};

export function operationCapabilities() {
  return createOperationCapabilitiesResponse({
    auth: {
      scheme: "bearer-or-x-api-key",
      requiredForReads: Boolean(process.env.EVAL_EXEC_V3_API_KEY?.trim()),
      requiredForMutations: true,
    },
  });
}

export async function listOperationSessions(store: OperationStorePort) {
  const sessions = await store.listSessions();
  return { sessions: sessions.map(createOperationSessionResponse) };
}

export async function getOperationSession(
  store: OperationStorePort,
  sessionId: string
) {
  const session = await requireSession(store, sessionId);
  return createOperationSessionResponse(session);
}

export async function getOperationEvents(
  store: OperationStorePort,
  sessionId: string
) {
  await requireSession(store, sessionId);
  return createOperationEventsResponse(
    sessionId,
    await store.listEvents(sessionId)
  );
}

export async function getOperationProjectionState(
  store: OperationStorePort,
  sessionId: string
) {
  const session = await requireSession(store, sessionId);
  const events = await store.listEvents(sessionId);
  const latestByNode = new Map<string, OperationEventRecord>();
  const latestCheckpointByNode = new Map<string, OperationEventRecord>();
  for (const event of events) {
    const target = event.target as
      | { kind?: string; nodeId?: string }
      | undefined;
    if (target?.kind === "node" && target.nodeId)
      latestByNode.set(target.nodeId, event);
    if (
      event.type === "node.checkpointed" &&
      target?.kind === "node" &&
      target.nodeId
    ) {
      latestCheckpointByNode.set(target.nodeId, event);
    }
  }

  return createOperationProjectionStateResponse({
    sessionId,
    workflowKey: WORKFLOW_KEY,
    graphKey: GRAPH_KEY,
    status: session.status,
    revision: session.revision,
    nodes: Object.fromEntries(
      OPERATION_NODE_IDS.map((nodeId) => {
        const latest = latestByNode.get(nodeId);
        const checkpoint = latestCheckpointByNode.get(nodeId);
        const checkpointPayload = checkpoint?.payload as
          | { raw?: { checkpointId?: string } }
          | undefined;
        return [
          nodeId,
          {
            status: latest
              ? nodeStatusFromEvent(latest, session.status)
              : "idle",
            latestEventId: latest?.eventId ?? null,
            latestCheckpointId:
              checkpointPayload?.raw?.checkpointId ??
              checkpoint?.eventId ??
              null,
            attempts: countNodeAttempts(events, nodeId),
            summary: latest?.payload ?? null,
            availableActions: availableNodeActions(
              session,
              nodeId,
              latest,
              checkpoint
            ),
          },
        ];
      })
    ),
    edges: {},
    availableActions: availableSessionActions(session),
  });
}

export async function getOperationActions(
  store: OperationStorePort,
  sessionId: string
) {
  const session = await requireSession(store, sessionId);
  const events = await store.listEvents(sessionId);
  const latestByNode = latestNodeEvents(events);
  const checkpointsByNode = latestCheckpointEvents(events);
  return createOperationActionsResponse(sessionId, [
    ...controlActions(sessionId),
    ...availableSessionActions(session).map((key) =>
      actionDescriptor(sessionId, key, "session")
    ),
    ...OPERATION_NODE_IDS.flatMap((nodeId) =>
      availableNodeActions(
        session,
        nodeId,
        latestByNode.get(nodeId),
        checkpointsByNode.get(nodeId)
      ).map((key) => actionDescriptor(sessionId, key, "node", nodeId))
    ),
    ...DEFERRED_ACTION_KEYS.map((key) => ({
      ...actionDescriptor(sessionId, key, "session"),
      enabled: false,
      unavailableReason:
        "Deferred for v0 because the run reference runtime has no safe waiting point for this mutation.",
    })),
  ]);
}

export async function applyOperationAction(
  store: OperationStorePort,
  sessionId: string,
  actionKey: string,
  request: {
    leaseId?: string;
    expectedRevision?: number;
    input?: Record<string, unknown>;
  },
  actor = { kind: "user", id: "keeperhub", label: "KeeperHub operator" },
  runtime: OperationActionRuntime = {}
) {
  const session = await requireSession(store, sessionId);
  const actionId = crypto.randomUUID();
  await appendEvent(store, session, {
    type: "action.requested",
    origin: "operator",
    target: {
      kind: "action",
      actionKey,
      workflowKey: WORKFLOW_KEY,
      graphKey: GRAPH_KEY,
    },
    actor,
    payload: { preview: `${actionKey} requested`, raw: request.input ?? {} },
  });
  const conflict = validateActionPreconditions(session, actionKey, request);
  if (conflict) {
    const rejected = conflict as { revision?: number; error?: unknown };
    await appendEvent(store, session, {
      type: "action.rejected",
      origin: "operator",
      target: {
        kind: "action",
        actionKey,
        workflowKey: WORKFLOW_KEY,
        graphKey: GRAPH_KEY,
      },
      actor,
      revision: rejected.revision,
      payload: { preview: `${actionKey} rejected`, raw: request.input ?? {} },
      error: rejected.error,
    });
    return conflict;
  }
  let rerunCheckpoint: Extract<
    RunLoopEvent,
    { type: "checkpoint:created" }
  > | null = null;
  try {
    rerunCheckpoint =
      actionKey === "retry-from-checkpoint"
        ? await resolveRerunCheckpoint(store, session, request.input)
        : null;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await appendEvent(store, session, {
      type: "action.rejected",
      origin: "operator",
      target: {
        kind: "action",
        actionKey,
        workflowKey: WORKFLOW_KEY,
        graphKey: GRAPH_KEY,
      },
      actor,
      revision: session.revision,
      payload: { preview: `${actionKey} rejected`, raw: request.input ?? {} },
      error: { code: "CHECKPOINT_UNAVAILABLE", message },
    });
    return createOperationActionResult({
      sessionId: session.sessionId,
      actionKey,
      status: "rejected",
      revision: session.revision,
      error: { code: "CHECKPOINT_UNAVAILABLE", message },
    });
  }

  const revision = session.revision + 1;
  const now = new Date().toISOString();
  const resultStatus = actionKey === "cancel" ? "applied" : "accepted";
  let childSession: OperationSessionRecord | null = null;

  if (actionKey === "claim-control" || actionKey === "renew-control") {
    session.control = {
      mode: "exclusive-lease",
      owner: actor,
      leaseId: request.leaseId ?? crypto.randomUUID(),
      acquiredAt:
        actionKey === "claim-control" ? now : readControl(session).acquiredAt,
      expiresAt: new Date(Date.now() + LEASE_TTL_MS).toISOString(),
      heartbeatAt: now,
    };
  } else if (actionKey === "release-control") {
    session.control = emptyControl();
  } else if (actionKey === "cancel") {
    session.status = "cancelling";
  } else if (actionKey === "pause") {
    session.status = "pausing";
  } else if (actionKey === "resume") {
    session.status = "running";
  } else if (actionKey === "continue-step") {
    session.status = "running";
  } else if (actionKey === "retry-from-checkpoint") {
    if (!runtime.executeRerun) {
      return createOperationActionResult({
        sessionId: session.sessionId,
        actionKey,
        status: "rejected",
        revision: session.revision,
        error: {
          code: "ACTION_UNAVAILABLE",
          message: "Rerun execution is unavailable in this adapter.",
        },
      });
    }
    if (!rerunCheckpoint) {
      throw new Error("Checkpoint resolution failed.");
    }
    childSession = await startChildWorkflowOperation(
      store,
      session,
      actionId,
      rerunCheckpoint,
      request.input,
      runtime.executeRerun,
      runtime.origin ?? "http"
    );
  }
  session.revision = revision;
  await store.saveSession(session);

  const event = await appendEvent(store, session, {
    type: "action.accepted",
    origin: "operator",
    target: {
      kind: "action",
      actionKey,
      workflowKey: WORKFLOW_KEY,
      graphKey: GRAPH_KEY,
    },
    actor,
    revision,
    payload: {
      preview: `${actionKey} ${resultStatus}`,
      raw: request.input ?? {},
    },
  });
  if (resultStatus === "applied") {
    await appendEvent(store, session, {
      type: "action.applied",
      origin: "operator",
      target: {
        kind: "action",
        actionKey,
        workflowKey: WORKFLOW_KEY,
        graphKey: GRAPH_KEY,
      },
      actor,
      revision,
      payload: { preview: `${actionKey} applied`, raw: request.input ?? {} },
    });
  }
  await store.appendAction({
    actionId,
    sessionId,
    actionKey,
    status: resultStatus,
    requestedAt: now,
    actor,
    input: request.input ?? {},
    resultEventId: event.eventId,
  });

  return createOperationActionResult({
    sessionId,
    actionKey,
    status: resultStatus,
    eventId: event.eventId,
    revision,
    ...(childSession ? { childSessionId: childSession.sessionId } : {}),
  });
}

export async function recordWorkflowOperation(
  store: OperationStorePort,
  workflowKey: string,
  input: unknown,
  execute: (onRunEvent?: RunLoopObserver) => Promise<unknown>,
  origin: OperationOrigin = "http"
) {
  if (workflowKey !== WORKFLOW_KEY) {
    return execute();
  }

  const session = createSession(workflowKey, input, origin);
  await store.saveSession(session);
  await appendEvent(store, session, {
    type: "session.created",
    origin,
    target: { kind: "session" },
    payload: preview(input),
  });
  await appendEvent(store, session, {
    type: "trigger.received",
    origin,
    target: workflowTarget(),
    payload: { ...preview(input), trigger: session.trigger },
  });
  await appendEvent(store, session, {
    type: "trigger.validated",
    origin,
    target: workflowTarget(),
    payload: {
      preview: `${origin} trigger validated`,
      trigger: session.trigger,
    },
  });
  session.status = "running";
  session.startedAt = new Date().toISOString();
  session.revision += 1;
  await store.saveSession(session);
  await appendEvent(store, session, {
    type: "workflow.started",
    origin,
    target: workflowTarget(),
    revision: session.revision,
  });
  await appendPreparePromptRenderedEvent(store, session, input, origin);

  try {
    const output = await execute();
    await appendRunEvents(store, session, output as RunResponse, origin);
    session.status = outputStatus(output);
    session.endedAt = new Date().toISOString();
    session.revision += 1;
    await store.saveSession(session);
    await appendEvent(store, session, {
      type: workflowTerminalEventType(session.status),
      origin,
      target: workflowTarget(),
      revision: session.revision,
      payload: preview(output),
    });
    await appendEvent(store, session, {
      type: `session.${session.status}`,
      origin: "system",
      target: { kind: "session" },
      revision: session.revision,
      payload: preview(output),
    });
    return output;
  } catch (error) {
    const cancelled =
      error instanceof Error && error.message === "Operation cancelled.";
    session.status = cancelled ? "cancelled" : "failed";
    session.endedAt = new Date().toISOString();
    session.revision += 1;
    await store.saveSession(session);
    if (cancelled) {
      await appendEvent(store, session, {
        type: "node.cancelled",
        origin,
        target: nodeTarget("executor"),
        revision: session.revision,
        error: { message: error.message },
      });
    }
    await appendEvent(store, session, {
      type: cancelled ? "workflow.cancelled" : "workflow.failed",
      origin,
      target: workflowTarget(),
      revision: session.revision,
      error: {
        message: error instanceof Error ? error.message : String(error),
      },
    });
    await appendEvent(store, session, {
      type: cancelled ? "session.cancelled" : "session.failed",
      origin: "system",
      target: { kind: "session" },
      revision: session.revision,
      error: {
        message: error instanceof Error ? error.message : String(error),
      },
    });
    throw error;
  }
}

export async function startWorkflowOperation(
  store: OperationStorePort,
  workflowKey: string,
  input: unknown,
  execute: (onRunEvent?: RunLoopObserver) => Promise<unknown>,
  origin: OperationOrigin = "http"
) {
  if (workflowKey !== WORKFLOW_KEY) {
    throw new Error(
      `Workflow ${workflowKey} does not support operation sessions.`
    );
  }

  const session = createSession(workflowKey, input, origin);
  await store.saveSession(session);
  await appendEvent(store, session, {
    type: "session.created",
    origin,
    target: { kind: "session" },
    payload: preview(input),
  });
  await appendEvent(store, session, {
    type: "trigger.received",
    origin,
    target: workflowTarget(),
    payload: { ...preview(input), trigger: session.trigger },
  });
  await appendEvent(store, session, {
    type: "trigger.validated",
    origin,
    target: workflowTarget(),
    payload: {
      preview: `${origin} trigger validated`,
      trigger: session.trigger,
    },
  });
  session.status = "running";
  session.startedAt = new Date().toISOString();
  session.revision += 1;
  await store.saveSession(session);
  await appendEvent(store, session, {
    type: "workflow.started",
    origin,
    target: workflowTarget(),
    revision: session.revision,
  });
  await appendPreparePromptRenderedEvent(store, session, input, origin);
  await appendEvent(store, session, {
    type: "node.started",
    origin,
    target: nodeTarget("prepare-request"),
    revision: session.revision,
    payload: {
      preview: "Preparing eval-exec request",
      raw: { phase: "prepare:start" },
    },
  });
  await appendEvent(store, session, {
    type: "node.succeeded",
    origin,
    target: nodeTarget("prepare-request"),
    revision: session.revision,
    payload: {
      preview: "Prepared eval-exec request",
      raw: { phase: "prepare:end" },
    },
  });

  void runStartedOperation(
    store,
    session,
    execute,
    origin,
    isManualStepMode(input)
  );

  return createOperationSessionResponse(session);
}

async function runStartedOperation(
  store: OperationStorePort,
  session: OperationSessionRecord,
  execute: (onRunEvent?: RunLoopObserver) => Promise<unknown>,
  origin: OperationOrigin,
  manualStepMode = false
) {
  try {
    const output = await execute(async (event) => {
      await appendRunEvent(store, session, event, origin);
      await waitForOperationControl(store, session, event);
      if (manualStepMode) {
        await waitForManualStepContinue(store, session, event);
      }
    });
    session.status = outputStatus(output);
    session.endedAt = new Date().toISOString();
    session.revision += 1;
    await store.saveSession(session);
    if (!["passed", "cancelled"].includes(session.status)) {
      await appendFailedNodeFromOutput(store, session, output, origin);
    }
    await appendEvent(store, session, {
      type: workflowTerminalEventType(session.status),
      origin,
      target: workflowTarget(),
      revision: session.revision,
      payload: preview(output),
    });
    await appendEvent(store, session, {
      type: `session.${session.status}`,
      origin: "system",
      target: { kind: "session" },
      revision: session.revision,
      payload: preview(output),
    });
  } catch (error) {
    const cancelled =
      error instanceof Error && error.message === "Operation cancelled.";
    session.status = cancelled ? "cancelled" : "failed";
    session.endedAt = new Date().toISOString();
    session.revision += 1;
    await store.saveSession(session);
    const terminalNodeId = await latestActiveNodeId(store, session);
    await appendEvent(store, session, {
      type: cancelled ? "node.cancelled" : "node.failed",
      origin,
      target: nodeTarget(terminalNodeId),
      revision: session.revision,
      error: {
        message: error instanceof Error ? error.message : String(error),
      },
    });
    await appendEvent(store, session, {
      type: cancelled ? "workflow.cancelled" : "workflow.failed",
      origin,
      target: workflowTarget(),
      revision: session.revision,
      error: {
        message: error instanceof Error ? error.message : String(error),
      },
    });
    await appendEvent(store, session, {
      type: cancelled ? "session.cancelled" : "session.failed",
      origin: "system",
      target: { kind: "session" },
      revision: session.revision,
      error: {
        message: error instanceof Error ? error.message : String(error),
      },
    });
  }
}

async function appendRunEvent(
  store: OperationStorePort,
  session: OperationSessionRecord,
  event: RunLoopEvent,
  origin: OperationEventRecord["origin"]
) {
  if (event.type === "checkpoint:created") {
    await appendCheckpointEvent(store, session, event, origin);
  } else if (event.type === "prompt:rendered") {
    await appendPromptRenderedEvent(store, session, event, origin);
  } else if (isWorkerItemEvent(event)) {
    await appendWorkerItemEvent(store, session, event, origin);
  } else if (event.type === "execute:start") {
    await appendEvent(store, session, {
      type: "node.started",
      origin,
      target: nodeTarget("executor"),
      payload: nodeLifecyclePreview("Executor started", event),
    });
  } else if (event.type === "execute:end") {
    await appendEvent(store, session, {
      type: "node.succeeded",
      origin,
      target: nodeTarget("executor"),
      payload: nodeLifecyclePreview("Executor completed", event),
    });
  } else if (event.type === "evaluate:start") {
    await appendEvent(store, session, {
      type: "node.started",
      origin,
      target: nodeTarget("evaluator"),
      payload: nodeLifecyclePreview("Evaluator started", event),
    });
  } else if (event.type === "evaluate:end") {
    await appendEvent(store, session, {
      type: "node.succeeded",
      origin,
      target: nodeTarget("evaluator"),
      payload: nodeLifecyclePreview("Evaluator completed", event),
    });
    await appendEvent(store, session, {
      type: "decision.recorded",
      origin,
      target: nodeTarget("decision"),
      payload: preview(event),
    });
  } else if (event.type === "fix:start") {
    await appendEvent(store, session, {
      type: "node.started",
      origin,
      target: nodeTarget("fixer"),
      payload: nodeLifecyclePreview("Fixer started", event),
    });
  } else if (event.type === "fix:end") {
    await appendEvent(store, session, {
      type: "node.succeeded",
      origin,
      target: nodeTarget("fixer"),
      payload: nodeLifecyclePreview("Fixer completed", event),
    });
  } else if (event.type === "run:end") {
    if (event.phase === "cancelled") {
      await appendCancelledRunningNode(store, session, origin);
    } else if (event.phase !== "passed") {
      await appendFailedRunningNode(store, session, origin);
    }
    await appendEvent(store, session, {
      type: resultEventTypeForPhase(event.phase),
      origin,
      target: nodeTarget("result"),
      payload: preview(event),
    });
  }
}

async function appendRunEvents(
  store: OperationStorePort,
  session: OperationSessionRecord,
  output: RunResponse,
  origin: OperationEventRecord["origin"]
) {
  const events = Array.isArray(output?.events) ? output.events : [];
  for (const event of events) {
    if (event.type === "checkpoint:created") {
      await appendCheckpointEvent(store, session, event, origin);
    } else if (event.type === "prompt:rendered") {
      await appendPromptRenderedEvent(store, session, event, origin);
    } else if (isWorkerItemEvent(event as RunLoopEvent)) {
      await appendWorkerItemEvent(
        store,
        session,
        event as Extract<
          RunLoopEvent,
          {
            type:
              | "worker.item.started"
              | "worker.item.delta"
              | "worker.item.completed"
              | "worker.item.failed";
          }
        >,
        origin
      );
    } else if (event.type === "execute:start") {
      await appendEvent(store, session, {
        type: "node.started",
        origin,
        target: nodeTarget("executor"),
        payload: nodeLifecyclePreview("Executor started", event),
      });
    } else if (event.type === "execute:end") {
      await appendEvent(store, session, {
        type: "node.succeeded",
        origin,
        target: nodeTarget("executor"),
        payload: nodeLifecyclePreview("Executor completed", event),
      });
    } else if (event.type === "evaluate:start") {
      await appendEvent(store, session, {
        type: "node.started",
        origin,
        target: nodeTarget("evaluator"),
        payload: nodeLifecyclePreview("Evaluator started", event),
      });
    } else if (event.type === "evaluate:end") {
      await appendEvent(store, session, {
        type: "node.succeeded",
        origin,
        target: nodeTarget("evaluator"),
        payload: nodeLifecyclePreview("Evaluator completed", event),
      });
      await appendEvent(store, session, {
        type: "decision.recorded",
        origin,
        target: nodeTarget("decision"),
        payload: preview(event),
      });
    } else if (event.type === "fix:start") {
      await appendEvent(store, session, {
        type: "node.started",
        origin,
        target: nodeTarget("fixer"),
        payload: nodeLifecyclePreview("Fixer started", event),
      });
    } else if (event.type === "fix:end") {
      await appendEvent(store, session, {
        type: "node.succeeded",
        origin,
        target: nodeTarget("fixer"),
        payload: nodeLifecyclePreview("Fixer completed", event),
      });
    }
  }
  const phase = typeof output?.phase === "string" ? output.phase : "passed";
  if (phase === "cancelled") {
    await appendCancelledRunningNode(store, session, origin);
  } else if (phase !== "passed") {
    await appendFailedRunningNode(store, session, origin);
  }
  if (!["passed", "cancelled"].includes(phase)) {
    await appendFailedNodeFromOutput(store, session, output, origin);
  }
  await appendEvent(store, session, {
    type: resultEventTypeForPhase(phase),
    origin,
    target: nodeTarget("result"),
    payload: preview(output),
  });
}

async function appendWorkerItemEvent(
  store: OperationStorePort,
  session: OperationSessionRecord,
  event: Extract<
    RunLoopEvent,
    {
      type:
        | "worker.item.started"
        | "worker.item.delta"
        | "worker.item.completed"
        | "worker.item.failed";
    }
  >,
  origin: OperationEventRecord["origin"]
) {
  await appendEvent(store, session, {
    type: event.type,
    origin,
    target: nodeTarget(event.nodeId),
    payload: {
      preview: event.preview,
      raw: {
        provider: event.provider,
        phase: event.phase,
        round: event.round,
        itemId: event.itemId,
        parentItemId: event.parentItemId,
        providerRefs: event.providerRefs,
        itemKind: event.itemKind,
        title: event.title,
        text: event.text,
        input: event.input,
        output: event.output,
        rawType: event.rawType,
        raw: event.raw,
      },
    },
    attributes: {
      provider: event.provider,
      phase: event.phase,
      round: event.round,
      itemId: event.itemId,
      parentItemId: event.parentItemId,
      providerRefs: event.providerRefs,
      itemKind: event.itemKind,
      rawType: event.rawType,
    },
    ...(event.error ? { error: { message: event.error } } : {}),
  });
}

async function appendEvent(
  store: OperationStorePort,
  session: OperationSessionRecord,
  event: Partial<OperationEventRecord>
) {
  const sequence = (await store.listEvents(session.sessionId)).length + 1;
  const record = createOperationEvent({
    eventId: crypto.randomUUID(),
    sessionId: session.sessionId,
    sequence,
    type: event.type ?? "session.event",
    at: new Date().toISOString(),
    appKey: APP_KEY,
    origin: event.origin ?? "system",
    target: event.target ?? { kind: "session" },
    revision: event.revision ?? session.revision,
    ...(event.actor ? { actor: event.actor } : {}),
    ...(event.payload ? { payload: event.payload } : {}),
    ...(event.error ? { error: event.error } : {}),
  }) as OperationEventRecord;
  await store.appendEvent(record);
  return record;
}

async function appendPromptRenderedEvent(
  store: OperationStorePort,
  session: OperationSessionRecord,
  event: Extract<RunLoopEvent, { type: "prompt:rendered" }>,
  origin: OperationEventRecord["origin"]
) {
  const sequence = (await store.listEvents(session.sessionId)).length + 1;
  const record = createOperationPromptRenderedEvent({
    event: {
      eventId: crypto.randomUUID(),
      sessionId: session.sessionId,
      sequence,
      at: new Date().toISOString(),
      appKey: APP_KEY,
      origin,
      target: nodeTarget(event.nodeId),
      revision: session.revision,
    },
    prompt: event.prompt,
    attributes: {
      templateKey: event.templateKey,
      phase: event.phase,
      round: event.round,
      contentType: "text/markdown",
      redaction: "raw-payload-policy",
    },
  }) as OperationEventRecord;
  await store.appendEvent(record);
  return record;
}

async function appendCheckpointEvent(
  store: OperationStorePort,
  session: OperationSessionRecord,
  event: Extract<RunLoopEvent, { type: "checkpoint:created" }>,
  origin: OperationEventRecord["origin"]
) {
  const sequence = (await store.listEvents(session.sessionId)).length + 1;
  const record = createOperationEvent({
    eventId: crypto.randomUUID(),
    sessionId: session.sessionId,
    sequence,
    type: "node.checkpointed",
    at: new Date().toISOString(),
    appKey: APP_KEY,
    origin,
    target: {
      ...nodeTarget(event.nodeId),
      checkpointId: event.checkpointId,
    },
    revision: session.revision,
    payload: {
      preview: `${event.nodeId} checkpointed`,
      raw: {
        checkpointId: event.checkpointId,
        nodeId: event.nodeId,
        round: event.round,
        state: event.state,
      },
    },
    attributes: {
      checkpointId: event.checkpointId,
      nodeId: event.nodeId,
      round: event.round,
    },
  }) as OperationEventRecord;
  await store.appendEvent(record);
  return record;
}

async function appendPreparePromptRenderedEvent(
  store: OperationStorePort,
  session: OperationSessionRecord,
  input: unknown,
  origin: OperationEventRecord["origin"]
) {
  const prepareInput = preparePromptInputFromOperationInput(input);
  const resolvedWorkdir = resolveDefaultWorkdir(
    prepareInput.workdir ?? prepareInput.request?.workdir
  );
  const sequence = (await store.listEvents(session.sessionId)).length + 1;
  const record = createOperationPromptRenderedEvent({
    event: {
      eventId: crypto.randomUUID(),
      sessionId: session.sessionId,
      sequence,
      at: new Date().toISOString(),
      appKey: APP_KEY,
      origin,
      target: nodeTarget("prepare-request"),
      revision: session.revision,
    },
    prompt: buildPreparePrompt(prepareInput, resolvedWorkdir),
    attributes: {
      templateKey: "prepare",
      phase: "prepare",
      round: 1,
      contentType: "text/markdown",
      redaction: "raw-payload-policy",
    },
  }) as OperationEventRecord;
  await store.appendEvent(record);
  return record;
}

function preparePromptInputFromOperationInput(input: unknown): PrepareRequest {
  if (typeof input === "string") {
    return { intent: input };
  }
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return {};
  }
  const request = input as PrepareRequest["request"] & { task?: unknown };
  return {
    intent: normalizeText(request.task),
    request,
    workdir: normalizeText(request.workdir),
  };
}

function createSession(
  workflowKey: string,
  input: unknown,
  origin: OperationOrigin
): OperationSessionRecord {
  const sessionId = crypto.randomUUID();
  return createOperationSessionResponse({
    sessionId,
    appKey: APP_KEY,
    status: "queued",
    trigger: { kind: origin, key: workflowKey, label: triggerLabel(origin) },
    startedAt: null,
    endedAt: null,
    currentWorkflowKey: workflowKey,
    currentGraphKey: GRAPH_KEY,
    revision: 1,
    availableActionsHref: `/api/operations/sessions/${sessionId}/actions`,
    control: emptyControl(),
    payloadPreview: preview(input),
    sourceInput: input,
  }) as OperationSessionRecord;
}

async function startChildWorkflowOperation(
  store: OperationStorePort,
  parent: OperationSessionRecord,
  parentActionId: string,
  checkpoint: Extract<RunLoopEvent, { type: "checkpoint:created" }>,
  actionInput: Record<string, unknown> | undefined,
  executeRerun: OperationActionRuntime["executeRerun"],
  origin: OperationOrigin
) {
  if (!executeRerun) throw new Error("Rerun executor is missing.");
  const state = checkpoint.state as RunLoopCheckpointState;
  const promptOverride =
    typeof actionInput?.promptOverride === "string" &&
    actionInput.promptOverride.trim()
      ? actionInput.promptOverride.trim()
      : undefined;
  const sourceInput = {
    ...state.request,
    task: promptOverride ?? state.currentPrompt ?? state.request.task,
  };
  const session = createSession(WORKFLOW_KEY, sourceInput, origin);
  session.parentSessionId = parent.sessionId;
  session.parentCheckpointId = checkpoint.checkpointId;
  session.parentActionId = parentActionId;
  session.rerun = {
    nodeId: checkpoint.nodeId,
    checkpointId: checkpoint.checkpointId,
    promptOverride: promptOverride ?? null,
  };
  await store.saveSession(session);
  await appendEvent(store, session, {
    type: "session.created",
    origin,
    target: { kind: "session" },
    payload: preview(session.sourceInput),
  });
  await appendEvent(store, session, {
    type: "rerun.started",
    origin: "operator",
    target: {
      kind: "checkpoint",
      checkpointId: checkpoint.checkpointId,
      workflowKey: WORKFLOW_KEY,
      graphKey: GRAPH_KEY,
    },
    payload: {
      preview: `Rerun from ${checkpoint.nodeId}`,
      raw: {
        parentSessionId: parent.sessionId,
        parentCheckpointId: checkpoint.checkpointId,
        parentActionId,
        actionInput: actionInput ?? {},
      },
    },
  });
  session.status = "running";
  session.startedAt = new Date().toISOString();
  session.revision += 1;
  await store.saveSession(session);
  await appendEvent(store, session, {
    type: "workflow.started",
    origin,
    target: workflowTarget(),
    revision: session.revision,
  });

  void runStartedOperation(
    store,
    session,
    (onRunEvent) => executeRerun(state, promptOverride, onRunEvent),
    origin,
    false
  );

  return session;
}

function controlActions(sessionId: string) {
  return ["claim-control", "renew-control", "release-control"].map((key) =>
    actionDescriptor(sessionId, key, "session")
  );
}

async function resolveRerunCheckpoint(
  store: OperationStorePort,
  session: OperationSessionRecord,
  input: Record<string, unknown> | undefined
): Promise<Extract<RunLoopEvent, { type: "checkpoint:created" }>> {
  const nodeId = normalizeRerunNodeId(input?.nodeId);
  const checkpointId =
    typeof input?.checkpointId === "string" ? input.checkpointId.trim() : "";
  const events = await store.listEvents(session.sessionId);
  const checkpoints = events
    .filter((event) => event.type === "node.checkpointed")
    .map(readCheckpointEvent)
    .filter(
      (event): event is Extract<RunLoopEvent, { type: "checkpoint:created" }> =>
        Boolean(event)
    );
  const checkpoint = [...checkpoints].reverse().find((event) => {
    if (checkpointId) return event.checkpointId === checkpointId;
    return event.nodeId === nodeId;
  });
  if (!checkpoint) {
    throw new Error(`No checkpoint is available for ${nodeId}.`);
  }
  return checkpoint;
}

function normalizeRerunNodeId(value: unknown): OperationNodeId {
  const nodeId = typeof value === "string" ? value.trim() : "";
  if ((OPERATION_NODE_IDS as readonly string[]).includes(nodeId)) {
    return nodeId as OperationNodeId;
  }
  return "executor";
}

function readCheckpointEvent(
  event: OperationEventRecord
): Extract<RunLoopEvent, { type: "checkpoint:created" }> | null {
  const payload = event.payload as { raw?: unknown } | undefined;
  const raw = payload?.raw as
    | {
        checkpointId?: unknown;
        nodeId?: unknown;
        round?: unknown;
        state?: unknown;
      }
    | undefined;
  if (
    !(
      raw &&
      typeof raw.checkpointId === "string" &&
      typeof raw.nodeId === "string" &&
      typeof raw.round === "number"
    )
  ) {
    return null;
  }
  if (!(OPERATION_NODE_IDS as readonly string[]).includes(raw.nodeId)) {
    return null;
  }
  const state =
    raw.state && typeof raw.state === "object" && !Array.isArray(raw.state)
      ? (raw.state as Record<string, unknown>)
      : {};
  return {
    type: "checkpoint:created",
    checkpointId: raw.checkpointId,
    nodeId: raw.nodeId as OperationNodeId,
    round: raw.round,
    state,
  };
}

function latestNodeEvents(events: OperationEventRecord[]) {
  const latestByNode = new Map<string, OperationEventRecord>();
  for (const event of events) {
    const target = event.target as
      | { kind?: string; nodeId?: string }
      | undefined;
    if (target?.kind === "node" && target.nodeId)
      latestByNode.set(target.nodeId, event);
  }
  return latestByNode;
}

function latestCheckpointEvents(events: OperationEventRecord[]) {
  const latestByNode = new Map<string, OperationEventRecord>();
  for (const event of events) {
    const target = event.target as
      | { kind?: string; nodeId?: string }
      | undefined;
    if (
      event.type === "node.checkpointed" &&
      target?.kind === "node" &&
      target.nodeId
    ) {
      latestByNode.set(target.nodeId, event);
    }
  }
  return latestByNode;
}

function availableSessionActions(session: OperationSessionRecord): string[] {
  if (["passed", "failed", "cancelled", "cancelling"].includes(session.status))
    return [];
  if (session.status === "pausing") return ["resume", "cancel"];
  if (session.status === "waiting") return ["cancel"];
  if (session.status === "paused") return ["resume", "cancel"];
  return ["cancel", "pause"];
}

function availableNodeActions(
  session: OperationSessionRecord,
  _nodeId: string,
  latest?: OperationEventRecord,
  checkpoint?: OperationEventRecord
): string[] {
  if (session.status === "waiting" && latest?.type === "step.waiting") {
    return ["continue-step"];
  }
  const canRerun =
    Boolean(checkpoint) &&
    ["paused", "passed", "failed", "cancelled"].includes(session.status);
  return canRerun ? ["retry-from-checkpoint"] : [];
}

function actionDescriptor(
  sessionId: string,
  key: string,
  scope: "session" | "node",
  nodeId?: string
) {
  return {
    key,
    title: key
      .split("-")
      .map((part) => part[0].toUpperCase() + part.slice(1))
      .join(" "),
    scope,
    method: "POST",
    href: `/api/operations/sessions/${sessionId}/actions/${key}`,
    authRequired: true,
    inputSchemaId:
      GRAPH_OPERATION_STANDARD_ACTION_INPUT_SCHEMA_IDS[key] ??
      `schema.eval-exec-v3.operation.${key}.input`,
    preconditions: ["valid lease", "fresh revision"],
    effect: `operation.${key}`,
    target: nodeId ? nodeTarget(nodeId) : { kind: "session" },
  };
}

function validateActionPreconditions(
  session: OperationSessionRecord,
  actionKey: string,
  request: { leaseId?: string; expectedRevision?: number }
) {
  const actionAvailability = getActionAvailability(session, actionKey);
  if (actionAvailability.status === "unknown") {
    return createOperationActionResult({
      sessionId: session.sessionId,
      actionKey,
      status: "rejected",
      revision: session.revision,
      error: {
        code: "UNKNOWN_ACTION",
        message: `Unknown operation action: ${actionKey}`,
      },
    });
  }
  if (actionAvailability.status === "unavailable") {
    return createOperationActionResult({
      sessionId: session.sessionId,
      actionKey,
      status: "rejected",
      revision: session.revision,
      error: { code: "ACTION_UNAVAILABLE", message: actionAvailability.reason },
    });
  }
  if (!Number.isInteger(request.expectedRevision)) {
    return createOperationActionResult({
      sessionId: session.sessionId,
      actionKey,
      status: "rejected",
      revision: session.revision,
      error: {
        code: "REVISION_REQUIRED",
        message: "A fresh expectedRevision is required.",
      },
    });
  }
  if (request.expectedRevision !== session.revision) {
    return createOperationActionResult({
      sessionId: session.sessionId,
      actionKey,
      status: "rejected",
      revision: session.revision,
      error: {
        code: "REVISION_CONFLICT",
        message: "Expected revision is stale.",
      },
    });
  }
  const control = readControl(session);
  const needsLease = actionKey !== "claim-control";
  if (needsLease && (!request.leaseId || request.leaseId !== control.leaseId)) {
    return createOperationActionResult({
      sessionId: session.sessionId,
      actionKey,
      status: "rejected",
      revision: session.revision,
      error: {
        code: "LEASE_CONFLICT",
        message: "A valid control lease is required.",
      },
    });
  }
  if (needsLease && !isLeaseCurrent(control)) {
    return createOperationActionResult({
      sessionId: session.sessionId,
      actionKey,
      status: "rejected",
      revision: session.revision,
      error: {
        code: "LEASE_EXPIRED",
        message:
          "The control lease has expired. Claim control again before steering.",
      },
    });
  }
  if (
    actionKey === "claim-control" &&
    control.leaseId &&
    new Date(String(control.expiresAt)).getTime() > Date.now()
  ) {
    return createOperationActionResult({
      sessionId: session.sessionId,
      actionKey,
      status: "rejected",
      revision: session.revision,
      error: {
        code: "LEASE_CONFLICT",
        message: "Operation is already controlled by another operator.",
      },
    });
  }
  return null;
}

function getActionAvailability(
  session: OperationSessionRecord,
  actionKey: string
):
  | { status: "available" }
  | { status: "unavailable"; reason: string }
  | { status: "unknown" } {
  if (["claim-control", "renew-control", "release-control"].includes(actionKey))
    return { status: "available" };
  if (availableSessionActions(session).includes(actionKey))
    return { status: "available" };
  if (actionKey === "continue-step") {
    return session.status === "waiting"
      ? { status: "available" }
      : {
          status: "unavailable",
          reason: `continue-step is not available while the session status is ${session.status}.`,
        };
  }
  if (actionKey === "retry-from-checkpoint") {
    return ["paused", "passed", "failed", "cancelled"].includes(session.status)
      ? { status: "available" }
      : {
          status: "unavailable",
          reason:
            "Rerun is available only when the session is paused or terminal.",
        };
  }
  if ((DEFERRED_ACTION_KEYS as readonly string[]).includes(actionKey)) {
    return {
      status: "unavailable",
      reason:
        "Deferred for v0 because the run reference runtime has no safe waiting point for this mutation.",
    };
  }
  if (["cancel", "pause", "resume", "retry-session"].includes(actionKey)) {
    return {
      status: "unavailable",
      reason: `${actionKey} is not available while the session status is ${session.status}.`,
    };
  }
  return { status: "unknown" };
}

async function requireSession(
  store: OperationStorePort,
  sessionId: string
): Promise<OperationSessionRecord> {
  const session = await store.getSession(sessionId);
  if (!session) throw new Error(`Operation session not found: ${sessionId}`);
  return session;
}

function readControl(session: OperationSessionRecord): Record<string, unknown> {
  return session.control && typeof session.control === "object"
    ? (session.control as Record<string, unknown>)
    : emptyControl();
}

function isLeaseCurrent(control: Record<string, unknown>): boolean {
  const expiresAt =
    typeof control.expiresAt === "string"
      ? Date.parse(control.expiresAt)
      : Number.NaN;
  return Number.isFinite(expiresAt) && expiresAt > Date.now();
}

function emptyControl() {
  return {
    mode: "exclusive-lease",
    owner: null,
    leaseId: null,
    acquiredAt: null,
    expiresAt: null,
    heartbeatAt: null,
  };
}

function workflowTarget() {
  return { kind: "workflow", workflowKey: WORKFLOW_KEY, graphKey: GRAPH_KEY };
}

function isManualStepMode(input: unknown): boolean {
  return (
    Boolean(input) &&
    typeof input === "object" &&
    !Array.isArray(input) &&
    (input as { manualStepMode?: unknown }).manualStepMode === true
  );
}

async function waitForOperationControl(
  store: OperationStorePort,
  session: OperationSessionRecord,
  event: RunLoopEvent
) {
  const nodeId = nodeIdForControlBoundaryEvent(event);
  if (!nodeId) return;

  for (;;) {
    const current = await requireSession(store, session.sessionId);
    Object.assign(session, current);
    if (current.status === "cancelled" || current.status === "cancelling") {
      throw new Error("Operation cancelled.");
    }
    if (current.status !== "pausing" && current.status !== "paused") {
      return;
    }
    if (current.status === "pausing") {
      current.status = "paused";
      current.revision += 1;
      await store.saveSession(current);
      Object.assign(session, current);
      await appendEvent(store, session, {
        type: "step.paused",
        origin: "system",
        target: nodeTarget(nodeId),
        revision: current.revision,
        payload: {
          preview: `${nodeId} paused at phase boundary`,
          raw: {
            actionKey: "resume",
            sourceEventType: event.type,
            round: "round" in event ? event.round : undefined,
          },
        },
      });
    }
    await sleep(250);
  }
}

async function waitForManualStepContinue(
  store: OperationStorePort,
  session: OperationSessionRecord,
  event: RunLoopEvent
) {
  const nodeId = nodeIdForManualBoundaryEvent(event);
  if (!nodeId) return;

  const current = await requireSession(store, session.sessionId);
  if (["passed", "failed", "cancelled"].includes(current.status)) return;
  if (current.status === "cancelling") {
    throw new Error("Operation cancelled.");
  }
  current.status = "waiting";
  current.revision += 1;
  await store.saveSession(current);
  Object.assign(session, current);
  await appendEvent(store, session, {
    type: "step.waiting",
    origin: "system",
    target: nodeTarget(nodeId),
    revision: current.revision,
    payload: {
      preview: `${nodeId} is waiting for manual continue`,
      raw: {
        actionKey: "continue-step",
        round: "round" in event ? event.round : undefined,
        sourceEventType: event.type,
      },
    },
  });

  for (;;) {
    await sleep(250);
    const latest = await requireSession(store, session.sessionId);
    Object.assign(session, latest);
    if (latest.status === "running") return;
    if (latest.status === "cancelled" || latest.status === "cancelling") {
      throw new Error("Operation cancelled while waiting for manual continue.");
    }
    if (["passed", "failed"].includes(latest.status)) return;
  }
}

function nodeIdForManualBoundaryEvent(event: RunLoopEvent): string | null {
  if (event.type === "execute:start") return "executor";
  if (event.type === "evaluate:start") return "evaluator";
  if (event.type === "fix:start") return "fixer";
  return null;
}

function nodeIdForControlBoundaryEvent(event: RunLoopEvent): string | null {
  if (event.type === "checkpoint:created") return event.nodeId;
  if (event.type === "execute:start") return "executor";
  if (event.type === "evaluate:start") return "evaluator";
  if (event.type === "evaluate:end") return "decision";
  if (event.type === "fix:start") return "fixer";
  return null;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function nodeTarget(nodeId: string) {
  return {
    kind: "node",
    workflowKey: WORKFLOW_KEY,
    graphKey: GRAPH_KEY,
    nodeId,
    definitionKey: `node.eval-exec-v3.${nodeId}`,
  };
}

function preview(value: unknown) {
  const text = typeof value === "string" ? value : JSON.stringify(value);
  return {
    preview: text.length > 240 ? `${text.slice(0, 237)}...` : text,
    raw: value,
  };
}

function nodeLifecyclePreview(label: string, event: { round?: number }) {
  const suffix = typeof event.round === "number" ? ` round ${event.round}` : "";
  return { preview: `${label}${suffix}`, raw: event };
}

function outputStatus(output: unknown): string {
  return output && typeof output === "object" && "phase" in output
    ? String(output.phase)
    : "passed";
}

function workflowTerminalEventType(
  status: string
): "workflow.succeeded" | "workflow.failed" | "workflow.cancelled" {
  if (status === "passed") return "workflow.succeeded";
  if (status === "cancelled") return "workflow.cancelled";
  return "workflow.failed";
}

function nodeStatusFromEvent(
  eventOrType: OperationEventRecord | string,
  sessionStatus?: string
): string {
  const type = typeof eventOrType === "string" ? eventOrType : eventOrType.type;
  const phase =
    typeof eventOrType === "string"
      ? undefined
      : phaseFromPayload(eventOrType.payload);
  if (type === "step.waiting") return "waiting";
  if (type === "step.paused") return "waiting";
  if (type.startsWith("worker.item."))
    return ["failed", "cancelled"].includes(sessionStatus ?? "")
      ? "error"
      : "running";
  if (type === "node.checkpointed") return "queued";
  if (type === "node.prompt.rendered") return "running";
  if (type === "node.cancelled") return "cancelled";
  if (phase && phase === "cancelled") return "cancelled";
  if (phase && phase !== "passed") return "error";
  if (type.endsWith("failed")) return "error";
  if (type === "node.succeeded" || type === "decision.recorded")
    return "success";
  if (type.endsWith("started"))
    return ["failed", "cancelled"].includes(sessionStatus ?? "")
      ? "error"
      : "running";
  return "running";
}

function phaseFromPayload(payload: unknown): string | undefined {
  if (!payload || typeof payload !== "object") return undefined;
  const raw = (payload as { raw?: unknown }).raw;
  if (!raw || typeof raw !== "object") return undefined;
  if ((raw as { type?: unknown }).type !== "run:end") return undefined;
  const phase = (raw as { phase?: unknown }).phase;
  return typeof phase === "string" ? phase : undefined;
}

function resultEventTypeForPhase(
  phase: string
): "node.succeeded" | "node.failed" | "node.cancelled" {
  if (phase === "passed") return "node.succeeded";
  if (phase === "cancelled") return "node.cancelled";
  return "node.failed";
}

async function appendFailedRunningNode(
  store: OperationStorePort,
  session: OperationSessionRecord,
  origin: OperationEventRecord["origin"]
) {
  const events = await store.listEvents(session.sessionId);
  const latestByNode = new Map<string, OperationEventRecord>();
  for (const event of events) {
    const target = event.target as { nodeId?: string } | undefined;
    if (target?.nodeId) latestByNode.set(target.nodeId, event);
  }
  const latestRunning = [...latestByNode.values()]
    .reverse()
    .find((event) => nodeStatusFromEvent(event.type) === "running");
  const target = latestRunning?.target as { nodeId?: string } | undefined;
  if (target?.nodeId) {
    await appendEvent(store, session, {
      type: "node.failed",
      origin,
      target: nodeTarget(target.nodeId),
      payload: latestRunning?.payload ?? undefined,
    });
  }
}

async function appendCancelledRunningNode(
  store: OperationStorePort,
  session: OperationSessionRecord,
  origin: OperationEventRecord["origin"]
) {
  const nodeId = await latestActiveNodeId(store, session);
  await appendEvent(store, session, {
    type: "node.cancelled",
    origin,
    target: nodeTarget(nodeId),
  });
}

async function latestActiveNodeId(
  store: OperationStorePort,
  session: OperationSessionRecord
): Promise<string> {
  const events = await store.listEvents(session.sessionId);
  for (const event of [...events].reverse()) {
    const target = event.target as
      | { kind?: string; nodeId?: string }
      | undefined;
    if (!(target?.kind === "node" && target.nodeId)) {
      continue;
    }
    if (
      [
        "node.succeeded",
        "node.failed",
        "node.cancelled",
        "decision.recorded",
      ].includes(event.type)
    ) {
      continue;
    }
    const status = nodeStatusFromEvent(event.type);
    if (["queued", "running", "waiting"].includes(status)) {
      return target.nodeId;
    }
  }
  return "executor";
}

async function appendFailedNodeFromOutput(
  store: OperationStorePort,
  session: OperationSessionRecord,
  output: unknown,
  origin: OperationEventRecord["origin"]
) {
  const runOutput =
    output && typeof output === "object"
      ? (output as { events?: Array<{ type?: string }>; error?: unknown })
      : null;
  if (!runOutput?.error) return;
  const events = Array.isArray(runOutput.events) ? runOutput.events : [];
  const last = [...events]
    .reverse()
    .find((event) => event.type !== "run:end")?.type;
  const nodeId =
    last === "execute:start"
      ? "executor"
      : last === "execute:end"
        ? "evaluator"
        : last === "evaluate:end"
          ? "decision"
          : last === "fix:start"
            ? "fixer"
            : "result";
  await appendEvent(store, session, {
    type: "node.failed",
    origin,
    target: nodeTarget(nodeId),
    payload: preview(output),
    error: { message: String(runOutput.error) },
  });
}

function countNodeAttempts(
  events: OperationEventRecord[],
  nodeId: string
): number {
  return events.filter((event) => {
    const target = event.target as { nodeId?: string } | undefined;
    return target?.nodeId === nodeId && event.type === "node.started";
  }).length;
}

function isWorkerItemEvent(event: RunLoopEvent): event is Extract<
  RunLoopEvent,
  {
    type:
      | "worker.item.started"
      | "worker.item.delta"
      | "worker.item.completed"
      | "worker.item.failed";
  }
> {
  return event.type.startsWith("worker.item.");
}

function triggerLabel(origin: OperationOrigin): string {
  if (origin === "mcp") return "MCP tool invocation";
  if (origin === "cli") return "CLI workflow run";
  if (origin === "sdk") return "SDK workflow run";
  return "HTTP workflow run";
}
