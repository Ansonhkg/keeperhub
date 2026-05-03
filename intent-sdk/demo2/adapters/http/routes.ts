import {
  createGraphDiscoveryOpenApiDocument,
  createNodeDiscoveryResponse,
  createWorkflowDiscoveryResponse,
} from "@graph-sdk/sdk/discovery";
import { createVisualWorkflowProjection } from "@graph-sdk/visual-adapter";
import {
  applyOperationAction,
  getOperationActions,
  getOperationEvents,
  getOperationProjectionState,
  getOperationSession,
  listOperationSessions,
  operationCapabilities,
  recordWorkflowOperation,
} from "../../core/services/operations.js";
import graphStructure from "../../graph/graph-structure.ts";
import {
  getSharedEvalExecRuntime,
  invokeWorkflow,
  invokeWorkflowRerunFromCheckpoint,
  invokeWorkflowWithOperation,
  startWorkflowWithOperation,
} from "../../runtime/workflows/invoker.js";

type JsonRequest = {
  url?: string;
  signal?: AbortSignal;
  json?: () => Promise<unknown>;
};

type WorkflowRunParams = {
  workflowKey?: string;
};

type OperationSessionParams = {
  sessionId?: string;
  actionKey?: string;
};

export function createEvalExecPrepareRoute() {
  return async function handleEvalExecPrepareRoute(request: JsonRequest) {
    return invokeWorkflow("eval-exec.prepare", await readJsonBody(request));
  };
}

export function createEvalExecRunRoute() {
  return async function handleEvalExecRunRoute(request: JsonRequest) {
    const input = await readWorkflowInput(request);
    return recordWorkflowOperation(
      getSharedEvalExecRuntime().operationStore,
      "eval-exec.run",
      input,
      () => invokeWorkflow("eval-exec.run", input),
      "http"
    );
  };
}

export function createGraphWorkflowRunRoute() {
  return async function handleGraphWorkflowRunRoute(
    request: JsonRequest,
    params: WorkflowRunParams = {}
  ) {
    const workflowKey = params.workflowKey ?? workflowKeyFromUrl(request.url);
    const input = await readWorkflowInput(request);
    const output =
      workflowKey === "eval-exec.run"
        ? await invokeWorkflowWithOperation(workflowKey, input, "http")
        : await invokeWorkflow(workflowKey, input);
    return toGraphRunResponse(workflowKey, input, output);
  };
}

export function createGraphWorkflowOperationStartRoute() {
  return async function handleGraphWorkflowOperationStartRoute(
    request: JsonRequest,
    params: WorkflowRunParams = {}
  ) {
    const workflowKey = params.workflowKey ?? workflowKeyFromUrl(request.url);
    if (workflowKey !== "eval-exec.run") {
      throw new Error(
        `Workflow ${workflowKey} does not support operation sessions.`
      );
    }
    const input = await readWorkflowInput(request);
    return startWorkflowWithOperation(workflowKey, input, "http");
  };
}

export function createOperationCapabilitiesRoute() {
  return async function handleOperationCapabilitiesRoute() {
    return operationCapabilities();
  };
}

export function createOperationSessionsRoute() {
  return async function handleOperationSessionsRoute() {
    return listOperationSessions(getSharedEvalExecRuntime().operationStore);
  };
}

export function createOperationSessionRoute() {
  return async function handleOperationSessionRoute(
    _request: JsonRequest,
    params: OperationSessionParams = {}
  ) {
    return getOperationSession(
      getSharedEvalExecRuntime().operationStore,
      requireSessionId(params)
    );
  };
}

export function createOperationEventsRoute() {
  return async function handleOperationEventsRoute(
    _request: JsonRequest,
    params: OperationSessionParams = {}
  ) {
    return getOperationEvents(
      getSharedEvalExecRuntime().operationStore,
      requireSessionId(params)
    );
  };
}

export function createOperationProjectionStateRoute() {
  return async function handleOperationProjectionStateRoute(
    _request: JsonRequest,
    params: OperationSessionParams = {}
  ) {
    return getOperationProjectionState(
      getSharedEvalExecRuntime().operationStore,
      requireSessionId(params)
    );
  };
}

export function createOperationActionsRoute() {
  return async function handleOperationActionsRoute(
    _request: JsonRequest,
    params: OperationSessionParams = {}
  ) {
    return getOperationActions(
      getSharedEvalExecRuntime().operationStore,
      requireSessionId(params)
    );
  };
}

export function createOperationActionRoute() {
  return async function handleOperationActionRoute(
    request: JsonRequest,
    params: OperationSessionParams = {}
  ) {
    return applyOperationAction(
      getSharedEvalExecRuntime().operationStore,
      requireSessionId(params),
      requireActionKey(params),
      (await readJsonBody(request)) as {
        leaseId?: string;
        expectedRevision?: number;
        input?: Record<string, unknown>;
      },
      undefined,
      {
        origin: "http",
        executeRerun: (checkpoint, promptOverride, onRunEvent) =>
          invokeWorkflowRerunFromCheckpoint(
            checkpoint,
            promptOverride,
            onRunEvent
          ),
      }
    );
  };
}

export function createOperationEventsStreamRoute() {
  return async function handleOperationEventsStreamRoute(
    _request: JsonRequest,
    params: OperationSessionParams = {}
  ) {
    const sessionId = requireSessionId(params);
    const store = getSharedEvalExecRuntime().operationStore;
    await getOperationSession(store, sessionId);
    const encoder = new TextEncoder();
    return new Response(
      new ReadableStream({
        async start(controller) {
          const send = (event: unknown) =>
            controller.enqueue(
              encoder.encode(
                `event: operation-event\ndata: ${JSON.stringify(event)}\n\n`
              )
            );
          for (const event of await store.listEvents(sessionId)) send(event);
          const unsubscribe = store.subscribe?.(sessionId, send);
          const heartbeat = setInterval(
            () => controller.enqueue(encoder.encode(": heartbeat\n\n")),
            15_000
          );
          _request.signal?.addEventListener?.("abort", () => {
            clearInterval(heartbeat);
            unsubscribe?.();
            controller.close();
          });
        },
      }),
      {
        headers: {
          "content-type": "text/event-stream; charset=utf-8",
          "cache-control": "no-cache, no-transform",
          connection: "keep-alive",
        },
      }
    );
  };
}

export function createWorkflowDiscoveryRoute() {
  return async function handleWorkflowDiscoveryRoute() {
    return createWorkflowDiscoveryResponse(graphStructure);
  };
}

export function createNodeDiscoveryRoute() {
  return async function handleNodeDiscoveryRoute() {
    return createNodeDiscoveryResponse(graphStructure);
  };
}

export function createVisualProjectionRoute() {
  return async function handleVisualProjectionRoute(request: JsonRequest) {
    const workflowKey = workflowKeyFromQuery(request.url);
    return createVisualWorkflowProjection(graphStructure, workflowKey);
  };
}

export function createOpenApiRoute() {
  return async function handleOpenApiRoute() {
    return createGraphDiscoveryOpenApiDocument({
      title: "Eval Exec Loop v3 Discovery API",
      version: "0.1.0",
    });
  };
}

export function createSwaggerRoute() {
  return async function handleSwaggerRoute() {
    return [
      "<!doctype html>",
      "<html>",
      '<head><meta charset="utf-8"><title>Eval Exec Loop v3 API</title></head>',
      "<body>",
      "<h1>Eval Exec Loop v3 API</h1>",
      '<p>OpenAPI JSON is available at <a href="/api/openapi.json">/api/openapi.json</a>.</p>',
      "</body>",
      "</html>",
    ].join("");
  };
}

async function readJsonBody(request: JsonRequest): Promise<unknown> {
  if (!request || typeof request.json !== "function") return {};
  return request.json();
}

async function readWorkflowInput(request: JsonRequest): Promise<unknown> {
  const body = await readJsonBody(request);
  if (
    body &&
    typeof body === "object" &&
    !Array.isArray(body) &&
    "input" in body
  ) {
    return (body as { input: unknown }).input;
  }
  return body;
}

function workflowKeyFromQuery(url: string | undefined): string {
  if (!url) throw new Error("Missing request URL.");
  const workflow = new URL(url).searchParams.get("workflow")?.trim();
  if (!workflow) throw new Error("Missing required workflow query parameter.");
  return workflow;
}

function workflowKeyFromUrl(url: string | undefined): string {
  if (!url) throw new Error("Missing request URL.");
  const pathname = new URL(url).pathname;
  const match = pathname.match(/^\/api\/graph\/workflows\/([^/]+)\/runs$/);
  const workflowKey = match?.[1] ? decodeURIComponent(match[1]) : "";
  if (!workflowKey) throw new Error("Missing workflow key in run URL.");
  return workflowKey;
}

function requireSessionId(params: OperationSessionParams): string {
  if (!params.sessionId) throw new Error("Missing operation session id.");
  return params.sessionId;
}

function requireActionKey(params: OperationSessionParams): string {
  if (!params.actionKey) throw new Error("Missing operation action key.");
  return params.actionKey;
}

function toGraphRunResponse(
  workflowKey: string,
  input: unknown,
  output: unknown
) {
  const phase =
    output && typeof output === "object" && "phase" in output
      ? String((output as { phase: unknown }).phase)
      : "passed";
  const isError = phase === "failed" || phase === "cancelled";

  return {
    schemaVersion: "graph-sdk/run/v0",
    workflowKey,
    status: isError ? "error" : "succeeded",
    output,
    steps: [
      {
        id: `${workflowKey}:run`,
        nodeId: workflowKey === "eval-exec.prepare" ? "prepare" : "run-loop",
        definitionKey:
          workflowKey === "eval-exec.prepare"
            ? "node.eval-exec-v3.prepare"
            : "node.eval-exec-v3.run-loop",
        label:
          workflowKey === "eval-exec.prepare" ? "Prepare request" : "Run loop",
        status: isError ? "error" : "success",
        input,
        output,
      },
    ],
  };
}
