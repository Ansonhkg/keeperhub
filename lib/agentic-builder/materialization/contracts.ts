import type {
  BuilderPreviewBranch,
  BuilderProjection,
  WorkflowGraph,
} from "@/lib/agentic-builder/projection/contracts";

export type MaterializationIssueSeverity = "info" | "warning" | "error";

export type MaterializationIssue = {
  id: string;
  severity: MaterializationIssueSeverity;
  code: string;
  message: string;
  nodeIds?: string[];
  edgeIds?: string[];
  requirementIds?: string[];
};

export type MaterializationValidationResult = {
  valid: boolean;
  issues: MaterializationIssue[];
};

export type MaterializedWorkflowGraph = WorkflowGraph & {
  materializedNodeIds: string[];
  materializedEdgeIds: string[];
  requirementCoverage: Record<string, string[]>;
  customProposalCoverage: Record<string, string[]>;
};

export type MaterializeBuilderProjectionInput = {
  projection: BuilderProjection;
  realGraph: WorkflowGraph;
  optionId: string;
};

export type MaterializeBuilderProjectionResult = {
  projection: BuilderProjection;
  selectedBranch?: BuilderPreviewBranch;
  graph: MaterializedWorkflowGraph;
  validation: MaterializationValidationResult;
  repaired: boolean;
};

