import { isBuilderPreviewNode } from "@/lib/agentic-builder/canvas-projection";
import type { WorkflowEdge, WorkflowNode } from "@/lib/workflow-store";
import { findActionById, flattenConfigFields } from "@/plugins/registry";

const SYSTEM_ACTION_TYPES = new Set([
  "Collect",
  "Condition",
  "Database Query",
  "For Each",
  "HTTP Request",
]);

const BUILDER_RUNTIME_PLACEHOLDER_KEYS = new Set([
  "builderConditionNeedsAnswer",
  "builderPreview",
  "builderPreviewOptionId",
  "builderHighlighted",
  "builderOptionIndex",
  "builderOptionLane",
]);

const BUILDER_RUNTIME_PLACEHOLDER_PATTERN =
  /\{\{(?:fresh[A-Za-z0-9]*Price|baseline[A-Za-z0-9]*Price|price_usd|price_change_percent)\}\}/;

export type RuntimeReadinessIssue = {
  nodeId: string;
  nodeLabel: string;
  message: string;
  fieldKey?: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isEmptyValue(value: unknown): boolean {
  return value === undefined || value === null || value === "";
}

function collectBuilderPlaceholders(
  value: unknown,
  prefix = ""
): RuntimeReadinessIssue["fieldKey"][] {
  if (typeof value === "string") {
    return BUILDER_RUNTIME_PLACEHOLDER_PATTERN.test(value) ? [prefix] : [];
  }

  if (!isRecord(value)) {
    return [];
  }

  return Object.entries(value).flatMap(([key, nestedValue]) => {
    const fieldKey = prefix ? `${prefix}.${key}` : key;
    if (BUILDER_RUNTIME_PLACEHOLDER_KEYS.has(key)) {
      return [fieldKey];
    }
    return collectBuilderPlaceholders(nestedValue, fieldKey);
  });
}

function hasExecutableAction(actionType: string): boolean {
  return (
    SYSTEM_ACTION_TYPES.has(actionType) || Boolean(findActionById(actionType))
  );
}

function requiredFieldIssues(
  node: WorkflowNode,
  config: Record<string, unknown>,
  actionType: string
): RuntimeReadinessIssue[] {
  const action = findActionById(actionType);
  if (!action) {
    return [];
  }

  return flattenConfigFields(action.configFields)
    .filter((field) => field.required && isEmptyValue(config[field.key]))
    .map((field) => ({
      fieldKey: field.key,
      message: `${field.label} is required before this step can run.`,
      nodeId: node.id,
      nodeLabel: node.data.label || action.label || "Unnamed step",
    }));
}

function conditionIssues(
  node: WorkflowNode,
  config: Record<string, unknown>
): RuntimeReadinessIssue[] {
  if (config.actionType !== "Condition") {
    return [];
  }

  if (config.builderConditionNeedsAnswer === true) {
    return [
      {
        fieldKey: "condition",
        message:
          "This condition still needs a concrete threshold or comparison rule.",
        nodeId: node.id,
        nodeLabel: node.data.label || "Condition",
      },
    ];
  }

  if (isEmptyValue(config.condition) && isEmptyValue(config.conditionConfig)) {
    return [
      {
        fieldKey: "condition",
        message: "Condition must be configured before the workflow can run.",
        nodeId: node.id,
        nodeLabel: node.data.label || "Condition",
      },
    ];
  }

  return [];
}

export function getRuntimeReadinessIssues({
  edges,
  includeRequiredFields = true,
  nodes,
}: {
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
  includeRequiredFields?: boolean;
}): RuntimeReadinessIssue[] {
  const nodeIds = new Set(nodes.map((node) => node.id));
  const issues: RuntimeReadinessIssue[] = [];

  for (const node of nodes) {
    const nodeLabel = node.data.label || "Unnamed step";

    if (isBuilderPreviewNode(node)) {
      issues.push({
        message: "Preview-only builder option must be selected or dismissed.",
        nodeId: node.id,
        nodeLabel,
      });
      continue;
    }

    if (node.data.enabled === false || node.data.type !== "action") {
      continue;
    }

    const config = node.data.config;
    if (!isRecord(config)) {
      issues.push({
        message: "Action step has no runtime configuration.",
        nodeId: node.id,
        nodeLabel,
      });
      continue;
    }

    const actionType = config.actionType;
    if (typeof actionType !== "string" || actionType.trim() === "") {
      issues.push({
        fieldKey: "actionType",
        message: "Action type must be selected before this step can run.",
        nodeId: node.id,
        nodeLabel,
      });
      continue;
    }

    if (!hasExecutableAction(actionType)) {
      issues.push({
        fieldKey: "actionType",
        message: `"${actionType}" is not an executable runtime action.`,
        nodeId: node.id,
        nodeLabel,
      });
    }

    if (includeRequiredFields) {
      issues.push(...requiredFieldIssues(node, config, actionType));
    }
    issues.push(...conditionIssues(node, config));

    for (const fieldKey of collectBuilderPlaceholders(config)) {
      issues.push({
        fieldKey,
        message: "Builder placeholder must be resolved before execution.",
        nodeId: node.id,
        nodeLabel,
      });
    }
  }

  for (const edge of edges) {
    if (!(nodeIds.has(edge.source) && nodeIds.has(edge.target))) {
      issues.push({
        message: `Edge points to a missing ${nodeIds.has(edge.source) ? "target" : "source"} node.`,
        nodeId: nodeIds.has(edge.source) ? edge.source : edge.target,
        nodeLabel: "Workflow edge",
      });
    }
  }

  return issues;
}
