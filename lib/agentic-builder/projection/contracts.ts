import type { BuilderIntentDraft } from "@/lib/agentic-builder/intent/contracts";
import type { RequirementEvaluationResult } from "@/lib/agentic-builder/evaluation/contracts";
import type { WorkflowEdge, WorkflowNode } from "@/lib/workflow/store";

export type BuilderProjectionStatus =
  | "planning"
  | "ready"
  | "needs_input"
  | "accepted"
  | "rejected"
  | "invalid";

export type BuilderProjectionRisk = "low" | "medium" | "high";

export type BuilderProjectionIssue = {
  id: string;
  severity: "info" | "warning" | "error";
  message: string;
  requirementIds?: string[];
};

export type BuilderProjectionQuestion = {
  id: string;
  requirementId: string;
  question: string;
  answer?: string;
  blocksMaterialization: boolean;
};

export type BuilderPreviewNodeData = WorkflowNode["data"] & {
  builderPreview: true;
  builderProjectionId: string;
  builderBranchId: string;
  builderOptionId?: string;
  builderRequirementIds: string[];
  builderCapabilityMatchId?: string;
  builderCustomProposalId?: string;
};

export type BuilderPreviewEdgeData = {
  builderPreview: true;
  builderProjectionId: string;
  builderBranchId: string;
  builderOptionId?: string;
  builderRequirementIds: string[];
};

export type BuilderPreviewNode = Omit<WorkflowNode, "data"> & {
  data: BuilderPreviewNodeData;
};

export type BuilderPreviewEdge = WorkflowEdge & {
  data: BuilderPreviewEdgeData;
};

export type BuilderPreviewBranch = {
  id: string;
  optionId?: string;
  optionGroupId?: string;
  title: string;
  rationale?: string;
  risk: BuilderProjectionRisk;
  requirementIds: string[];
  capabilityMatchIds?: string[];
  customProposalIds?: string[];
  previewNodes: BuilderPreviewNode[];
  previewEdges: BuilderPreviewEdge[];
};

export type BuilderProjectionBaseGraph = {
  nodeIds: string[];
  edgeIds: string[];
  capturedAt: string;
};

export type BuilderProjection = {
  id: string;
  workflowId?: string | null;
  sourcePrompt: string;
  status: BuilderProjectionStatus;
  baseGraph: BuilderProjectionBaseGraph;
  intent: BuilderIntentDraft;
  evaluation: RequirementEvaluationResult;
  branches: BuilderPreviewBranch[];
  questions: BuilderProjectionQuestion[];
  validationIssues: BuilderProjectionIssue[];
  selectedOptionId?: string;
  rejectedOptionIds: string[];
};

export type WorkflowGraph = {
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
};
