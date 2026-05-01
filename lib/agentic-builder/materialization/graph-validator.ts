import { findActionById } from "@/plugins/registry";
import { evaluationPolicy } from "@/lib/agentic-builder/evaluation/policy";
import {
  WorkflowTriggerEnum,
  type WorkflowEdge,
  type WorkflowNode,
} from "@/lib/workflow/store";
import type {
  MaterializationIssue,
  MaterializationValidationResult,
  MaterializedWorkflowGraph,
} from "./contracts";

const VALID_TRIGGER_TYPES = new Set<string>(Object.values(WorkflowTriggerEnum));
const CRON_FIELD_SPLITTER = /\s+/;

export function validateGraphShape(
  graph: MaterializedWorkflowGraph
): MaterializationValidationResult {
  const issues: MaterializationIssue[] = [];
  const nodeIds = new Set<string>();
  const edgeIds = new Set<string>();

  for (const node of graph.nodes) {
    if (nodeIds.has(node.id)) {
      issues.push(issue("duplicate_node_id", `Duplicate node ID "${node.id}".`, {
        nodeIds: [node.id],
      }));
    }
    nodeIds.add(node.id);
    issues.push(...validateNode(node));
  }

  for (const edge of graph.edges) {
    if (edgeIds.has(edge.id)) {
      issues.push(issue("duplicate_edge_id", `Duplicate edge ID "${edge.id}".`, {
        edgeIds: [edge.id],
      }));
    }
    edgeIds.add(edge.id);
    issues.push(...validateEdge(edge, nodeIds));
  }

  if (graph.materializedNodeIds.length === 0) {
    issues.push(
      issue("empty_materialized_branch", "Selected option has no materializable nodes.")
    );
  }

  return {
    valid: !issues.some((item) => item.severity === "error"),
    issues,
  };
}

function validateNode(node: WorkflowNode): MaterializationIssue[] {
  if (node.data.type === "trigger") {
    return validateTriggerNode(node);
  }

  if (node.data.type === "action") {
    return validateActionNode(node);
  }

  return [];
}

function validateTriggerNode(node: WorkflowNode): MaterializationIssue[] {
  const triggerType = node.data.config?.triggerType;
  if (typeof triggerType !== "string" || !VALID_TRIGGER_TYPES.has(triggerType)) {
    return [
      issue("invalid_trigger_type", "Trigger node is missing a valid trigger type.", {
        nodeIds: [node.id],
      }),
    ];
  }

  if (triggerType !== WorkflowTriggerEnum.SCHEDULE) {
    return [];
  }

  const cronExpression = node.data.config?.scheduleCron;
  if (typeof cronExpression !== "string" || !isValidCronShape(cronExpression)) {
    return [
      issue("invalid_schedule_config", "Schedule trigger is missing a valid cron expression.", {
        nodeIds: [node.id],
      }),
    ];
  }

  return [];
}

function validateActionNode(node: WorkflowNode): MaterializationIssue[] {
  const actionType = node.data.config?.actionType;
  if (typeof actionType !== "string" || actionType.length === 0) {
    return [
      issue("missing_action_type", "Action node is missing an action type.", {
        nodeIds: [node.id],
      }),
    ];
  }

  if (isKnownActionType(actionType) || isExplicitCustomNode(node)) {
    return [];
  }

  return [
    issue("unknown_action_type", `Action type "${actionType}" is not available.`, {
      nodeIds: [node.id],
    }),
  ];
}

function validateEdge(
  edge: WorkflowEdge,
  nodeIds: ReadonlySet<string>
): MaterializationIssue[] {
  const issues: MaterializationIssue[] = [];

  if (!nodeIds.has(edge.source)) {
    issues.push(
      issue("missing_edge_source", `Edge "${edge.id}" source does not exist.`, {
        edgeIds: [edge.id],
        nodeIds: [edge.source],
      })
    );
  }

  if (!nodeIds.has(edge.target)) {
    issues.push(
      issue("missing_edge_target", `Edge "${edge.id}" target does not exist.`, {
        edgeIds: [edge.id],
        nodeIds: [edge.target],
      })
    );
  }

  return issues;
}

function isKnownActionType(actionType: string): boolean {
  return (
    systemActionTypes().has(actionType) ||
    evaluationPolicy.capabilityPolicy.fallback.missingCapabilityTitle === actionType ||
    Boolean(findActionById(actionType))
  );
}

function systemActionTypes(): Set<string> {
  return new Set(
    evaluationPolicy.systemCapabilities.flatMap((capability) => [
      capability.id,
      capability.label,
    ])
  );
}

function isExplicitCustomNode(node: WorkflowNode): boolean {
  return (
    node.data.config?.customNode === true ||
    node.data.config?.isCustomNode === true ||
    node.data.config?.kind === "custom"
  );
}

function isValidCronShape(cronExpression: string): boolean {
  const parts = cronExpression.trim().split(CRON_FIELD_SPLITTER);
  return parts.length >= 5 && parts.length <= 6 && parts.every(Boolean);
}

function issue(
  code: string,
  message: string,
  extras: Partial<MaterializationIssue> = {}
): MaterializationIssue {
  return {
    id: `graph:${code}:${[...(extras.nodeIds ?? []), ...(extras.edgeIds ?? [])].join(":")}`,
    severity: "error",
    code,
    message,
    ...extras,
  };
}
