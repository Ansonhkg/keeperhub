import type { WorkflowNode } from "@/lib/workflow-store";
import { isBuilderPreviewNode } from "./canvas-projection";

function hasMeaningfulTriggerConfig(node: WorkflowNode): boolean {
  if (node.data.type !== "trigger") {
    return false;
  }

  const triggerType = node.data.config?.triggerType;
  return typeof triggerType === "string" && triggerType !== "Manual";
}

function hasMeaningfulActionConfig(node: WorkflowNode): boolean {
  if (node.data.type !== "action") {
    return false;
  }

  const actionType = node.data.config?.actionType;
  return typeof actionType === "string" && actionType.trim() !== "";
}

export function workflowContextNodesForBuilder(
  nodes: readonly WorkflowNode[]
): WorkflowNode[] {
  return nodes.filter(
    (node) => node.type !== "add" && !isBuilderPreviewNode(node)
  );
}

export function hasBuilderWorkflowContext(
  nodes: readonly WorkflowNode[]
): boolean {
  return workflowContextNodesForBuilder(nodes).some(
    (node) =>
      hasMeaningfulActionConfig(node) || hasMeaningfulTriggerConfig(node)
  );
}
