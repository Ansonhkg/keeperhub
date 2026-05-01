import type {
  IntentConnector,
  RequirementKind,
  RequirementStatus,
  UnresolvedRequirementStatus,
} from "./generated/vocabulary";

export {
  INTENT_CONNECTORS,
  REQUIREMENT_KINDS,
  REQUIREMENT_STATUSES,
  RESOLVED_REQUIREMENT_STATUS,
  UNRESOLVED_REQUIREMENT_STATUSES,
  type IntentConnector,
  type RequirementKind,
  type RequirementStatus,
  type UnresolvedRequirementStatus,
} from "./generated/vocabulary";

export type IntentRequirement = {
  id: string;
  kind: RequirementKind;
  status: RequirementStatus;
  summary: string;
  sourceText?: string;
  fields?: Record<string, unknown>;
  capabilityIntent?: {
    action?: string;
    provider?: string;
    channel?: string;
    resource?: string;
    operation?: string;
  };
  question?: string;
  blocksMaterialization?: boolean;
};

export type IntentClause = {
  id: string;
  sourceText: string;
  connector?: IntentConnector;
  requirements: IntentRequirement[];
};

export type UnresolvedRequirement = {
  requirementId: string;
  status: UnresolvedRequirementStatus;
  question: string;
  blocksMaterialization: boolean;
};

export type BuilderAssumption = {
  id: string;
  summary: string;
  reason: string;
  requirementIds?: string[];
};

export type BuilderIntentDraft = {
  schemaVersion: "agentic-builder.intent.v1";
  prompt: string;
  clauses: IntentClause[];
  unresolved: UnresolvedRequirement[];
  assumptions: BuilderAssumption[];
};
