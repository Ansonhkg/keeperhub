import type {
  BuilderPreviewEdge,
  BuilderPreviewNode,
  BuilderProjection,
  WorkflowGraph,
} from "./contracts";

export function projectWorkflowGraph(
  realGraph: WorkflowGraph,
  projection?: BuilderProjection | null
): WorkflowGraph {
  if (!projection) {
    return realGraph;
  }

  return {
    nodes: [
      ...realGraph.nodes,
      ...projection.branches.flatMap((branch) => branch.previewNodes),
    ],
    edges: [
      ...realGraph.edges,
      ...projection.branches.flatMap((branch) => branch.previewEdges),
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
