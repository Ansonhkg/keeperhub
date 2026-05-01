import type {
  BuilderPreviewEdge,
  BuilderPreviewNode,
  BuilderProjectionHighlight,
  BuilderProjection,
  WorkflowGraph,
} from "./contracts";

export function projectWorkflowGraph(
  realGraph: WorkflowGraph,
  projection?: BuilderProjection | null,
  highlight: BuilderProjectionHighlight = {}
): WorkflowGraph {
  if (!projection) {
    return realGraph;
  }

  return {
    nodes: [
      ...realGraph.nodes,
      ...projection.branches.flatMap((branch) =>
        branch.previewNodes.map((node) =>
          preparePreviewNode(node, isHighlighted(branch.id, branch.optionId, highlight))
        )
      ),
    ],
    edges: [
      ...realGraph.edges,
      ...projection.branches.flatMap((branch) =>
        branch.previewEdges.map((edge) =>
          preparePreviewEdge(edge, isHighlighted(branch.id, branch.optionId, highlight))
        )
      ),
    ],
  };
}

export function stripBuilderPreviewGraph(graph: WorkflowGraph): WorkflowGraph {
  const previewNodeIds = new Set(
    graph.nodes.filter(isBuilderPreviewNode).map((node) => node.id)
  );

  return {
    nodes: graph.nodes.filter((node) => !isBuilderPreviewNode(node)),
    edges: graph.edges.filter(
      (edge) =>
        !isBuilderPreviewEdge(edge) &&
        !previewNodeIds.has(edge.source) &&
        !previewNodeIds.has(edge.target)
    ),
  };
}

export function isBuilderPreviewNode(
  node: WorkflowGraph["nodes"][number]
): node is BuilderPreviewNode {
  const data = node.data as Record<string, unknown>;
  return data.builderPreview === true;
}

export function isBuilderPreviewEdge(
  edge: WorkflowGraph["edges"][number]
): edge is BuilderPreviewEdge {
  const data = edge.data as Record<string, unknown> | undefined;
  return data?.builderPreview === true;
}

function preparePreviewNode(
  node: BuilderPreviewNode,
  highlighted: boolean
): BuilderPreviewNode {
  return {
    ...node,
    draggable: false,
    selectable: false,
    connectable: false,
    data: {
      ...node.data,
      builderHighlighted: highlighted,
    },
  };
}

function preparePreviewEdge(
  edge: BuilderPreviewEdge,
  highlighted: boolean
): BuilderPreviewEdge {
  return {
    ...edge,
    selectable: false,
    data: {
      ...edge.data,
      builderHighlighted: highlighted,
    },
  };
}

function isHighlighted(
  branchId: string,
  optionId: string | undefined,
  highlight: BuilderProjectionHighlight
): boolean {
  return (
    highlight.branchId === branchId ||
    (optionId !== undefined && highlight.optionId === optionId)
  );
}
