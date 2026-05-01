import type {
  BuilderPreviewBranch,
  BuilderPreviewEdge,
  BuilderPreviewNode,
  WorkflowGraph,
} from "@/lib/agentic-builder/projection/contracts";
import type { WorkflowEdge, WorkflowNode } from "@/lib/workflow/store";
import type {
  MaterializationIssue,
  MaterializeBuilderProjectionInput,
  MaterializeBuilderProjectionResult,
  MaterializedWorkflowGraph,
} from "./contracts";
import { repairMaterializedGraph } from "./repair";
import { validateGraphShape } from "./graph-validator";
import { validateGraphAgainstIntent } from "./intent-validator";

export function materializeBuilderProjection(
  input: MaterializeBuilderProjectionInput
): MaterializeBuilderProjectionResult {
  const selectedBranch = findSelectedBranch(input.projection.branches, input.optionId);
  const initialIssues = selectedBranch
    ? []
    : [
        issue({
          code: "selected_branch_missing",
          message: "Selected builder option no longer exists.",
        }),
      ];

  const initialGraph = selectedBranch
    ? materializeBranch(input.realGraph, selectedBranch)
    : emptyMaterializedGraph(input.realGraph);
  const repaired = repairMaterializedGraph(initialGraph);
  const graphValidation = validateGraphShape(repaired.graph);
  const intentValidation = selectedBranch
    ? validateGraphAgainstIntent({
        projection: input.projection,
        selectedBranch,
        graph: repaired.graph,
      })
    : { valid: false, issues: [] };
  const validationIssues = [
    ...initialIssues,
    ...repaired.issues,
    ...graphValidation.issues,
    ...intentValidation.issues,
  ];

  return {
    projection: input.projection,
    selectedBranch,
    graph: repaired.graph,
    validation: {
      valid: !validationIssues.some((item) => item.severity === "error"),
      issues: validationIssues,
    },
    repaired: repaired.repaired,
  };
}

function materializeBranch(
  realGraph: WorkflowGraph,
  branch: BuilderPreviewBranch
): MaterializedWorkflowGraph {
  const nodeIds = new Set(realGraph.nodes.map((node) => node.id));
  const edgeIds = new Set(realGraph.edges.map((edge) => edge.id));
  const nodeIdMap = new Map<string, string>();
  const materializedNodes: WorkflowNode[] = [];
  const materializedEdges: WorkflowEdge[] = [];
  const requirementCoverage: Record<string, string[]> = {};
  const customProposalCoverage: Record<string, string[]> = {};

  for (const previewNode of branch.previewNodes) {
    const nodeId = uniqueId(previewNode.id, nodeIds);
    nodeIdMap.set(previewNode.id, nodeId);
    materializedNodes.push(toRealNode(previewNode, nodeId));

    for (const requirementId of previewNode.data.builderRequirementIds) {
      appendCoverage(requirementCoverage, requirementId, nodeId);
    }
    if (previewNode.data.builderCustomProposalId) {
      appendCoverage(customProposalCoverage, previewNode.data.builderCustomProposalId, nodeId);
    }
  }

  for (const previewEdge of branch.previewEdges) {
    const edgeId = uniqueId(previewEdge.id, edgeIds);
    materializedEdges.push(toRealEdge(previewEdge, edgeId, nodeIdMap));

    for (const requirementId of previewEdge.data.builderRequirementIds) {
      appendCoverage(requirementCoverage, requirementId, edgeId);
    }
  }

  return {
    nodes: [...realGraph.nodes, ...materializedNodes],
    edges: [...realGraph.edges, ...materializedEdges],
    materializedNodeIds: materializedNodes.map((node) => node.id),
    materializedEdgeIds: materializedEdges.map((edge) => edge.id),
    requirementCoverage,
    customProposalCoverage,
  };
}

function toRealNode(node: BuilderPreviewNode, id: string): WorkflowNode {
  const {
    builderPreview: _builderPreview,
    builderProjectionId: _builderProjectionId,
    builderBranchId: _builderBranchId,
    builderOptionId: _builderOptionId,
    builderRequirementIds: _builderRequirementIds,
    builderCapabilityMatchId: _builderCapabilityMatchId,
    builderCustomProposalId: _builderCustomProposalId,
    builderHighlighted: _builderHighlighted,
    ...data
  } = node.data;

  return {
    ...node,
    id,
    selected: false,
    draggable: undefined,
    selectable: undefined,
    connectable: undefined,
    data,
  };
}

function toRealEdge(
  edge: BuilderPreviewEdge,
  id: string,
  nodeIdMap: ReadonlyMap<string, string>
): WorkflowEdge {
  const {
    data: _data,
    selectable: _selectable,
    ...realEdge
  } = edge;

  return {
    ...realEdge,
    id,
    source: nodeIdMap.get(edge.source) ?? edge.source,
    target: nodeIdMap.get(edge.target) ?? edge.target,
  };
}

function findSelectedBranch(
  branches: BuilderPreviewBranch[],
  optionId: string
): BuilderPreviewBranch | undefined {
  return branches.find((branch) => branch.optionId === optionId || branch.id === optionId);
}

function uniqueId(baseId: string, existingIds: Set<string>): string {
  if (!existingIds.has(baseId)) {
    existingIds.add(baseId);
    return baseId;
  }

  let index = 1;
  let nextId = `${baseId}_${index}`;
  while (existingIds.has(nextId)) {
    index += 1;
    nextId = `${baseId}_${index}`;
  }
  existingIds.add(nextId);
  return nextId;
}

function emptyMaterializedGraph(graph: WorkflowGraph): MaterializedWorkflowGraph {
  return {
    ...graph,
    materializedNodeIds: [],
    materializedEdgeIds: [],
    requirementCoverage: {},
    customProposalCoverage: {},
  };
}

function appendCoverage(
  coverage: Record<string, string[]>,
  requirementId: string,
  graphItemId: string
) {
  coverage[requirementId] = [...(coverage[requirementId] ?? []), graphItemId];
}

function issue(input: {
  code: string;
  message: string;
  requirementIds?: string[];
}): MaterializationIssue {
  return {
    id: `materialization:${input.code}`,
    severity: "error",
    code: input.code,
    message: input.message,
    requirementIds: input.requirementIds,
  };
}

