import {
  defineGraphStructure,
  GRAPH_OPERATION_STANDARD_ACTION_INPUT_SCHEMA_IDS,
  GRAPH_STRUCTURE_SCHEMA_VERSION,
} from "@graph-sdk/sdk";
import { schemaManifests } from "../core/schema-manifests.ts";
import { appManifest } from "../manifests/app.manifest.ts";
import { evalExecV3GraphManifests } from "../runtime/graphs/registry.ts";
import { evalExecV3NodeManifests } from "../runtime/nodes/registry.ts";

type OperationActionScope = "session" | "node" | "edge";

type OperationActionTarget =
  | { kind: "session" }
  | { kind: "node"; workflowKey: string; graphKey: string; nodeId: string }
  | { kind: "edge"; workflowKey: string; graphKey: string; edgeId: string };

export default defineGraphStructure({
  schemaVersion: GRAPH_STRUCTURE_SCHEMA_VERSION,
  app: {
    key: appManifest.appKey,
    title: appManifest.title,
    version: appManifest.version,
  },
  schemas: schemaManifests,
  runtime: {
    backends: [{ key: "backend.eval-exec-v3.runtime" }],
    workflowInvoker: {
      key: "runtime.workflow-invoker",
      module: "./demo2/runtime/workflows/invoker.ts",
      export: "invokeWorkflow",
    },
    graphExecutor: {
      key: "runtime.graph-executor",
      module: "./demo2/runtime/graphs/runner.ts",
      export: "executeEvalExecWorkflowGraph",
    },
  },
  nodes: evalExecV3NodeManifests,
  graphs: evalExecV3GraphManifests,
  workflows: appManifest.workflows,
  adapterBindings: {
    http: {
      enabled: true,
      routes: [
        {
          method: "POST",
          path: "/api/eval-exec/prepare",
          workflow: "eval-exec.prepare",
        },
        {
          method: "POST",
          path: "/api/eval-exec/run",
          workflow: "eval-exec.run",
        },
        {
          method: "POST",
          path: "/api/graph/workflows/:workflowKey/runs",
          workflow: "eval-exec.prepare",
        },
        {
          method: "POST",
          path: "/api/graph/workflows/:workflowKey/runs",
          workflow: "eval-exec.run",
        },
        {
          method: "POST",
          path: "/api/graph/workflows/eval-exec.run/operations",
          workflow: "eval-exec.run",
        },
      ],
    },
    web: {
      enabled: false,
      routes: [],
    },
    cli: {
      enabled: true,
      commands: [
        { command: "eval-exec-v3 prepare", workflow: "eval-exec.prepare" },
        { command: "eval-exec-v3 run", workflow: "eval-exec.run" },
      ],
    },
    sdk: {
      enabled: true,
      bindings: [
        { label: "SDK prepare", workflow: "eval-exec.prepare" },
        { label: "SDK run", workflow: "eval-exec.run" },
      ],
    },
  },
  operations: {
    enabled: true,
    endpoints: {
      capabilities: "/api/operations/capabilities",
      sessions: "/api/operations/sessions",
      session: "/api/operations/sessions/{sessionId}",
      events: "/api/operations/sessions/{sessionId}/events",
      eventStream: "/api/operations/sessions/{sessionId}/events/stream",
      projectionState: "/api/operations/sessions/{sessionId}/projection-state",
      actions: "/api/operations/sessions/{sessionId}/actions",
      action: "/api/operations/sessions/{sessionId}/actions/{actionKey}",
    },
    payloadPolicy: {
      rawPayloadsDefault: true,
      redactionConfigurable: true,
      previewMode: "summary-default-raw-on-demand",
    },
    actions: [
      operationAction(
        "claim-control",
        "Claim control",
        "session",
        GRAPH_OPERATION_STANDARD_ACTION_INPUT_SCHEMA_IDS["claim-control"],
        { kind: "session" }
      ),
      operationAction(
        "renew-control",
        "Renew control",
        "session",
        GRAPH_OPERATION_STANDARD_ACTION_INPUT_SCHEMA_IDS["renew-control"],
        { kind: "session" }
      ),
      operationAction(
        "release-control",
        "Release control",
        "session",
        GRAPH_OPERATION_STANDARD_ACTION_INPUT_SCHEMA_IDS["release-control"],
        { kind: "session" }
      ),
      operationAction(
        "cancel",
        "Cancel operation",
        "session",
        GRAPH_OPERATION_STANDARD_ACTION_INPUT_SCHEMA_IDS.cancel,
        { kind: "session" }
      ),
      operationAction(
        "pause",
        "Pause operation",
        "session",
        GRAPH_OPERATION_STANDARD_ACTION_INPUT_SCHEMA_IDS.pause,
        { kind: "session" }
      ),
      operationAction(
        "resume",
        "Resume operation",
        "session",
        GRAPH_OPERATION_STANDARD_ACTION_INPUT_SCHEMA_IDS.resume,
        { kind: "session" }
      ),
      ...["executor", "evaluator", "fixer"].map((nodeId) =>
        operationAction(
          "continue-step",
          `Continue ${nodeId}`,
          "node",
          "schema.eval-exec-v3.operation.continue-step.input",
          operationNodeTarget(nodeId)
        )
      ),
      ...[
        "prepare-request",
        "executor",
        "evaluator",
        "decision",
        "fixer",
        "result",
      ].map((nodeId) =>
        operationAction(
          "retry-from-checkpoint",
          `Retry from ${nodeId}`,
          "node",
          GRAPH_OPERATION_STANDARD_ACTION_INPUT_SCHEMA_IDS[
            "retry-from-checkpoint"
          ],
          operationNodeTarget(nodeId)
        )
      ),
      operationAction(
        "approve-transition",
        "Approve transition",
        "edge",
        GRAPH_OPERATION_STANDARD_ACTION_INPUT_SCHEMA_IDS["approve-transition"],
        operationEdgeTarget("decision-to-result")
      ),
      operationAction(
        "reject-transition",
        "Reject transition",
        "edge",
        GRAPH_OPERATION_STANDARD_ACTION_INPUT_SCHEMA_IDS["reject-transition"],
        operationEdgeTarget("decision-to-fixer")
      ),
    ],
  },
});

function operationAction(
  key: string,
  title: string,
  scope: OperationActionScope,
  inputSchemaId: string,
  target: OperationActionTarget
) {
  return {
    key,
    title,
    scope,
    method: "POST",
    href: `/api/operations/sessions/{sessionId}/actions/${key}`,
    authRequired: true,
    inputSchemaId,
    preconditions: ["valid control lease", "fresh session revision"],
    effect: `operation.${key}`,
    target,
  };
}

function operationNodeTarget(nodeId: string): OperationActionTarget {
  return {
    kind: "node",
    workflowKey: "eval-exec.run",
    graphKey: "graph.eval-exec-v3.run",
    nodeId,
  };
}

function operationEdgeTarget(edgeId: string): OperationActionTarget {
  return {
    kind: "edge",
    workflowKey: "eval-exec.run",
    graphKey: "graph.eval-exec-v3.run",
    edgeId,
  };
}
