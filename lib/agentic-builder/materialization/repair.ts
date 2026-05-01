import type { WorkflowEdge, WorkflowNode } from "@/lib/workflow/store";
import type {
  MaterializationIssue,
  MaterializedWorkflowGraph,
} from "./contracts";

export type RepairMaterializedGraphResult = {
  graph: MaterializedWorkflowGraph;
  issues: MaterializationIssue[];
  repaired: boolean;
};

export function repairMaterializedGraph(
  graph: MaterializedWorkflowGraph
): RepairMaterializedGraphResult {
  const nodeRepair = repairDuplicateNodeIds(graph.nodes);
  const edgeRepair = repairDuplicateEdgeIds(graph.edges, nodeRepair.idMap);
  const issues = [...nodeRepair.issues, ...edgeRepair.issues];

  return {
    graph: {
      ...graph,
      nodes: nodeRepair.nodes,
      edges: edgeRepair.edges,
      materializedNodeIds: graph.materializedNodeIds.map(
        (id) => nodeRepair.idMap.get(id) ?? id
      ),
      materializedEdgeIds: graph.materializedEdgeIds.map(
        (id) => edgeRepair.idMap.get(id) ?? id
      ),
      requirementCoverage: remapCoverage(
        graph.requirementCoverage,
        nodeRepair.idMap,
        edgeRepair.idMap
      ),
      customProposalCoverage: remapCoverage(
        graph.customProposalCoverage,
        nodeRepair.idMap,
        edgeRepair.idMap
      ),
    },
    issues,
    repaired: issues.length > 0,
  };
}

function repairDuplicateNodeIds(nodes: WorkflowNode[]): {
  nodes: WorkflowNode[];
  idMap: Map<string, string>;
  issues: MaterializationIssue[];
} {
  const seen = new Set<string>();
  const idMap = new Map<string, string>();
  const issues: MaterializationIssue[] = [];

  return {
    nodes: nodes.map((node) => {
      if (!seen.has(node.id)) {
        seen.add(node.id);
        return node;
      }

      const repairedId = uniqueId(node.id, seen);
      idMap.set(node.id, repairedId);
      issues.push(repairIssue("repaired_duplicate_node_id", {
        message: `Repaired duplicate node ID "${node.id}".`,
        nodeIds: [repairedId],
      }));
      return { ...node, id: repairedId };
    }),
    idMap,
    issues,
  };
}

function repairDuplicateEdgeIds(
  edges: WorkflowEdge[],
  nodeIdMap: ReadonlyMap<string, string>
): {
  edges: WorkflowEdge[];
  idMap: Map<string, string>;
  issues: MaterializationIssue[];
} {
  const seen = new Set<string>();
  const idMap = new Map<string, string>();
  const issues: MaterializationIssue[] = [];

  return {
    edges: edges.map((edge) => {
      const source = nodeIdMap.get(edge.source) ?? edge.source;
      const target = nodeIdMap.get(edge.target) ?? edge.target;

      if (!seen.has(edge.id)) {
        seen.add(edge.id);
        return { ...edge, source, target };
      }

      const repairedId = uniqueId(edge.id, seen);
      idMap.set(edge.id, repairedId);
      issues.push(repairIssue("repaired_duplicate_edge_id", {
        message: `Repaired duplicate edge ID "${edge.id}".`,
        edgeIds: [repairedId],
      }));
      return { ...edge, id: repairedId, source, target };
    }),
    idMap,
    issues,
  };
}

function uniqueId(baseId: string, existingIds: Set<string>): string {
  let index = 1;
  let nextId = `${baseId}_${index}`;
  while (existingIds.has(nextId)) {
    index += 1;
    nextId = `${baseId}_${index}`;
  }
  existingIds.add(nextId);
  return nextId;
}

function remapCoverage(
  coverage: Record<string, string[]>,
  nodeIdMap: ReadonlyMap<string, string>,
  edgeIdMap: ReadonlyMap<string, string>
): Record<string, string[]> {
  return Object.fromEntries(
    Object.entries(coverage).map(([requirementId, graphItemIds]) => [
      requirementId,
      graphItemIds.map(
        (id) => nodeIdMap.get(id) ?? edgeIdMap.get(id) ?? id
      ),
    ])
  );
}

function repairIssue(
  code: string,
  extras: Pick<MaterializationIssue, "message"> &
    Partial<Pick<MaterializationIssue, "nodeIds" | "edgeIds">>
): MaterializationIssue {
  return {
    id: `repair:${code}:${[
      ...(extras.nodeIds ?? []),
      ...(extras.edgeIds ?? []),
    ].join(":")}`,
    severity: "info",
    code,
    message: extras.message,
    nodeIds: extras.nodeIds,
    edgeIds: extras.edgeIds,
  };
}

