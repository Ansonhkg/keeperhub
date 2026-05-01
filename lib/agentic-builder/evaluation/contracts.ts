import type {
  IntentClause,
  IntentRequirement,
  RequirementKind,
  RequirementStatus,
  UnresolvedRequirementStatus,
} from "../intent/contracts";

export type CapabilityIntent = NonNullable<IntentRequirement["capabilityIntent"]>;

export type CapabilityDescriptor = {
  id: string;
  label: string;
  source: string;
  description?: string;
  category?: string;
  integration?: string;
  requirementKinds?: RequirementKind[];
  capabilityIntent: CapabilityIntent;
};

export type CapabilityIntentBindings = Record<string, Partial<CapabilityIntent>>;

export type SystemCapabilityDescriptor = {
  id: string;
  label: string;
  description: string;
  category: string;
  capabilityIntent: CapabilityIntent;
};

export type EvaluatedRequirement = {
  id: string;
  kind: RequirementKind;
  status: RequirementStatus;
  summary: string;
  fields?: Record<string, unknown>;
  capabilityIntent?: CapabilityIntent;
  question?: string;
  blocksMaterialization: boolean;
  sourceClauseId: string;
};

export type BuilderTaskCandidate = {
  id: string;
  clauseId: string;
  requirementId: string;
  kind: RequirementKind;
  summary: string;
  capabilityIntent?: CapabilityIntent;
  optionGroupId?: string;
  preservesOrder: boolean;
  requiresAllTasks: boolean;
};

export type BuilderOptionGroup = {
  id: string;
  clauseId: string;
  taskIds: string[];
};

export type CapabilityMatch = {
  requirementId: string;
  capabilityId: string;
  label: string;
  source: string;
  score: number;
};

export type CustomNodeProposal = {
  id: string;
  requirementId: string;
  kind: string;
  title: string;
  summary: string;
  requestNativeFeatureAction: boolean;
  genericHttpRequiresExplicitSelection: boolean;
};

export type RequirementEvaluationResult = {
  requirements: EvaluatedRequirement[];
  unresolved: Array<{
    requirementId: string;
    status: UnresolvedRequirementStatus;
    question: string;
    blocksMaterialization: boolean;
  }>;
  tasks: BuilderTaskCandidate[];
  optionGroups: BuilderOptionGroup[];
  capabilityMatches: CapabilityMatch[];
  customNodeProposals: CustomNodeProposal[];
};

export type ConnectorSemantics = {
  requiresAllTasks: boolean;
  createsOptionGroup: boolean;
  preservesOrder: boolean;
  bindsField: string | null;
};

export type EvaluationPolicy = {
  connectorSemantics: Record<string, ConnectorSemantics>;
  capabilityPolicy: {
    sourcePriority: string[];
    sources: {
      nativeAction: string;
      protocolAction: string;
      systemAction: string;
    };
    fallback: {
      missingCapabilityKind: string;
      missingCapabilityTitle: string;
      requestNativeFeatureAction: boolean;
      genericHttpRequiresExplicitSelection: boolean;
    };
  };
  capabilityBindings: {
    integrationBindings: CapabilityIntentBindings;
    categoryBindings: CapabilityIntentBindings;
    actionBindings: CapabilityIntentBindings;
  };
  systemCapabilities: SystemCapabilityDescriptor[];
};

export type ClauseEvaluationContext = {
  clause: IntentClause;
  semantics?: ConnectorSemantics;
};
