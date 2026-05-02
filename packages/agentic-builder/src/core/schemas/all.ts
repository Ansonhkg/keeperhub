import type { DagBranch, DagSession } from "@keeperhub/builder-dag/types";
import { z } from "zod";

const jsonValueSchema: z.ZodType<unknown> = z.lazy(() =>
  z.union([
    z.string(),
    z.number(),
    z.boolean(),
    z.null(),
    z.array(jsonValueSchema),
    z.record(z.string(), jsonValueSchema),
  ])
);
const recordSchema = z.record(z.string(), jsonValueSchema);

export const builderAuthContextSchema = z.object({
  userId: z.string().min(1),
  organizationId: z.string().min(1),
  actorType: z.enum(["user", "agent", "system"]),
  scopes: z.array(z.string().min(1)),
});
export type BuilderAuthContext = z.infer<typeof builderAuthContextSchema>;

export const entitySchema = z.object({
  id: z.string().min(1),
  kind: z.string().min(1),
  label: z.string().min(1),
  canonicalValue: z.string().min(1).optional(),
  confidence: z.number().min(0).max(1),
});
export type Entity = z.infer<typeof entitySchema>;

export const intentStepSchema = z.object({
  id: z.string().min(1),
  kind: z.enum([
    "trigger",
    "read",
    "transform",
    "condition",
    "notify",
    "write",
    "missing_capability",
  ]),
  label: z.string().min(1),
  dependsOn: z.array(z.string().min(1)),
  requiredEntityIds: z.array(z.string().min(1)),
  status: z.enum(["planned", "needs_answer", "ready", "blocked"]),
});
export type IntentStep = z.infer<typeof intentStepSchema>;

export const intentPlanSchema = z.object({
  id: z.string().min(1),
  sourceText: z.string().min(1),
  entities: z.array(entitySchema),
  steps: z.array(intentStepSchema),
  openQuestionIds: z.array(z.string().min(1)),
});
export type IntentPlan = z.infer<typeof intentPlanSchema>;

export const contentKindSchema = z.string().min(1);
export type ContentKind = z.infer<typeof contentKindSchema>;

export const assetPairSchema = z.object({
  base: z.string().min(1),
  quote: z.string().min(1),
});
export type AssetPair = z.infer<typeof assetPairSchema>;

const constraintBaseSchema = z.object({
  required: z.boolean(),
  sourceEntityId: z.string().min(1).optional(),
});

export const intentConstraintSchema = z.discriminatedUnion("type", [
  constraintBaseSchema.extend({
    type: z.literal("asset_pair"),
    base: z.string().min(1),
    quote: z.string().min(1),
  }),
  constraintBaseSchema.extend({
    type: z.literal("schedule"),
    interval: z.string().min(1),
  }),
  constraintBaseSchema.extend({
    type: z.literal("notification"),
    channel: z.string().min(1).optional(),
  }),
  constraintBaseSchema.extend({
    type: z.literal("provider"),
    provider: z.string().min(1),
  }),
  constraintBaseSchema.extend({
    type: z.literal("operation"),
    operation: z.string().min(1),
  }),
  constraintBaseSchema.extend({
    type: z.literal("resource"),
    resource: z.string().min(1),
  }),
  constraintBaseSchema.extend({
    type: z.literal("content_kind"),
    contentKind: contentKindSchema,
  }),
  constraintBaseSchema.extend({
    type: z.literal("destructive_intent"),
    destructive: z.boolean(),
  }),
]);
export type IntentConstraint = z.infer<typeof intentConstraintSchema>;

export const intentRequirementStatusSchema = z.enum([
  "satisfied",
  "missing",
  "ambiguous",
  "conflicting",
  "unsupported",
]);
export type IntentRequirementStatus = z.infer<
  typeof intentRequirementStatusSchema
>;

export const intentEvidenceSchema = z.object({
  source: z.enum([
    "prompt",
    "entity",
    "planner",
    "candidate",
    "evaluator",
    "answer",
  ]),
  text: z.string().min(1).optional(),
  entityId: z.string().min(1).optional(),
  candidateId: z.string().min(1).optional(),
});
export type IntentEvidence = z.infer<typeof intentEvidenceSchema>;

export const dynamicRequirementCardinalitySchema = z.enum([
  "single",
  "multiple",
  "single_or_multiple",
  "optional",
]);
export type DynamicRequirementCardinality = z.infer<
  typeof dynamicRequirementCardinalitySchema
>;

export const dynamicRequirementKindSchema = z.enum([
  "asset.price.read",
  "state.capture",
  "state.reference",
  "temporal.repeat",
  "temporal.duration",
  "condition.compare",
  "condition.delta",
  "notification.send",
  "branch.true",
  "branch.false",
  "log.write",
  "swap.execute",
  "provider.select",
  "operation.execute",
  "resource.select",
  "content.generate",
  "safety.confirm",
]);
export type DynamicRequirementKind = z.infer<
  typeof dynamicRequirementKindSchema
>;

export const dynamicRequirementQuestionSchema = z.object({
  id: z.string().min(1),
  prompt: z.string().min(1),
  answerType: z.enum(["text", "single_choice", "multi_choice", "secret_ref"]),
  choices: z.array(z.string().min(1)).optional(),
  cardinality: dynamicRequirementCardinalitySchema.optional(),
  defaultValue: jsonValueSchema.optional(),
});
export type DynamicRequirementQuestion = z.infer<
  typeof dynamicRequirementQuestionSchema
>;

export const dynamicRequirementSchema = z.object({
  id: z.string().min(1),
  key: z.string().min(1),
  requirementKind: dynamicRequirementKindSchema.optional(),
  label: z.string().min(1),
  status: intentRequirementStatusSchema,
  value: jsonValueSchema.optional(),
  candidates: z.array(jsonValueSchema).optional(),
  cardinality: dynamicRequirementCardinalitySchema.default("single"),
  evidence: z.array(intentEvidenceSchema),
  appliesTo: z.string().min(1),
  question: dynamicRequirementQuestionSchema.optional(),
  source: z.enum(["prompt", "planner", "catalog", "evaluator", "answer"]),
  legacyType: z.string().min(1).optional(),
  legacyConstraint: z.string().min(1).optional(),
});
export type DynamicRequirement = z.infer<typeof dynamicRequirementSchema>;

export const intentRequirementSchema = z.object({
  id: z.string().min(1),
  type: z.enum([
    "asset",
    "notification_channel",
    "provider",
    "operation",
    "resource",
    "content_kind",
    "schedule",
    "destructive_intent",
  ]),
  status: intentRequirementStatusSchema,
  value: z.union([z.string().min(1), z.boolean()]).optional(),
  candidates: z.array(z.union([z.string().min(1), z.boolean()])).optional(),
  evidence: z.array(intentEvidenceSchema),
  appliesTo: z.string().min(1),
  legacyConstraint: z.string().min(1).optional(),
});
export type IntentRequirement = z.infer<typeof intentRequirementSchema>;

export const intentActionSchema = z.object({
  id: z.string().min(1),
  kind: z.enum([
    "trigger",
    "read",
    "transform",
    "condition",
    "notify",
    "write",
    "missing_capability",
    "generate",
    "unknown",
  ]),
  title: z.string().min(1),
  requirementIds: z.array(z.string().min(1)),
});
export type IntentAction = z.infer<typeof intentActionSchema>;

export const semanticConditionSchema = z.discriminatedUnion("kind", [
  z.object({
    id: z.string().min(1),
    kind: z.literal("price_threshold"),
    metric: z.string().min(1),
    operator: z.enum(["<", "<=", ">", ">="]),
    threshold: z.number(),
    unit: z.string().min(1),
  }),
  z.object({
    baseline: z.enum(["previous_run", "initial_value"]).default("previous_run"),
    id: z.string().min(1),
    kind: z.literal("percent_delta"),
    metric: z.string().min(1),
    operator: z.enum([">", ">="]),
    threshold: z.number(),
    unit: z.literal("%"),
  }),
  z.object({
    baselineRef: z.string().min(1),
    freshRef: z.string().min(1),
    id: z.string().min(1),
    kind: z.literal("absolute_delta"),
    metric: z.string().min(1),
    operator: z.enum([">", ">="]),
    threshold: z.number(),
    unit: z.string().min(1),
  }),
]);
export type SemanticCondition = z.infer<typeof semanticConditionSchema>;

export const builderIntentIRSchema = z.object({
  id: z.string().min(1),
  assetPairs: z.array(assetPairSchema).default([]),
  state: z
    .array(
      z.object({
        id: z.string().min(1),
        mutability: z.enum(["constant", "mutable"]),
        source: z.string().min(1),
        timing: z.enum(["before_loop", "inside_loop", "after_loop"]),
      })
    )
    .default([]),
  temporal: z
    .array(
      z.object({
        durationSeconds: z.number().positive().optional(),
        id: z.string().min(1),
        intervalSeconds: z.number().positive().optional(),
        mode: z.enum(["once", "bounded_loop", "unbounded_loop"]),
      })
    )
    .default([]),
  conditions: z.array(semanticConditionSchema).default([]),
  branches: z
    .array(
      z.object({
        action: z.enum(["notify", "log", "custom"]),
        conditionId: z.string().min(1),
        id: z.string().min(1),
        target: z.string().min(1).optional(),
        when: z.enum(["true", "false"]),
      })
    )
    .default([]),
});
export type BuilderIntentIR = z.infer<typeof builderIntentIRSchema>;

export const intentResolutionSchema = z.object({
  intentPlanId: z.string().min(1),
  sourceText: z.string().min(1),
  actions: z.array(intentActionSchema).default([]),
  requirements: z.array(intentRequirementSchema).default([]),
  dynamicRequirements: z.array(dynamicRequirementSchema).default([]).optional(),
  intentIR: builderIntentIRSchema.optional(),
  requiredEntities: z.array(intentConstraintSchema),
  optionalEntities: z.array(intentConstraintSchema),
  taskHints: z.array(z.string().min(1)),
});
export type IntentResolution = z.infer<typeof intentResolutionSchema>;

export const openQuestionSchema = z.object({
  id: z.string().min(1),
  stepId: z.string().min(1).optional(),
  prompt: z.string().min(1),
  answerType: z.enum(["text", "single_choice", "multi_choice", "secret_ref"]),
  choices: z.array(z.string().min(1)).optional(),
  answer: z.union([z.string().min(1), z.array(z.string().min(1))]).optional(),
  status: z.enum(["open", "answered"]),
  requirementId: z.string().min(1).optional(),
  cardinality: dynamicRequirementCardinalitySchema.optional(),
});
export type OpenQuestion = z.infer<typeof openQuestionSchema>;

export const answerQuestionInputSchema = z.object({
  questionId: z.string().min(1),
  answer: z.union([z.string().min(1), z.array(z.string().min(1))]),
});
export type AnswerQuestionInput = z.infer<typeof answerQuestionInputSchema>;

export const catalogCandidateCapabilitySchema = z.object({
  kind: z.string().min(1),
  provider: z.string().min(1).optional(),
  operation: z.string().min(1).optional(),
  resource: z.string().min(1).optional(),
  contentKind: contentKindSchema.optional(),
  destructive: z.boolean().optional(),
  assetPair: assetPairSchema.optional(),
});
export type CatalogCandidateCapability = z.infer<
  typeof catalogCandidateCapabilitySchema
>;

export const catalogCandidateProviderTierSchema = z.enum([
  "native",
  "protocol",
  "system",
  "workflow",
  "template",
  "generated",
  "missing",
]);
export type CatalogCandidateProviderTier = z.infer<
  typeof catalogCandidateProviderTierSchema
>;

export const catalogCapabilityFieldSchema = z.object({
  key: z.string().min(1),
  label: z.string().min(1).optional(),
  type: z.string().min(1).optional(),
  required: z.boolean().optional(),
  defaultValue: jsonValueSchema.optional(),
  options: z.array(z.string().min(1)).optional(),
  metadata: recordSchema.optional(),
});
export type CatalogCapabilityField = z.infer<
  typeof catalogCapabilityFieldSchema
>;

export const catalogCapabilityManifestSchema = z.object({
  providerTier: catalogCandidateProviderTierSchema,
  source: z.enum(["plugin", "protocol", "workflow", "system", "missing"]),
  actionId: z.string().min(1).optional(),
  title: z.string().min(1),
  description: z.string().min(1),
  facts: z.record(z.string(), jsonValueSchema).default({}),
  requiredFields: z.array(catalogCapabilityFieldSchema).default([]),
  optionalFields: z.array(catalogCapabilityFieldSchema).default([]),
  outputFields: z.array(catalogCapabilityFieldSchema).default([]),
  credentialRequired: z.boolean(),
  credentialIntegrationType: z.string().min(1).optional(),
  risk: z.enum(["low", "medium", "high"]).default("low"),
});
export type CatalogCapabilityManifest = z.infer<
  typeof catalogCapabilityManifestSchema
>;

export const catalogCandidateSchema = z.object({
  id: z.string().min(1),
  provider: z.enum([
    "native",
    "protocol",
    "system",
    "workflow",
    "template",
    "missing",
  ]),
  label: z.string().min(1),
  description: z.string().min(1),
  requiredInputs: z.array(z.string().min(1)),
  outputFields: z.array(z.string().min(1)),
  credentialsAvailable: z.boolean(),
  score: z.number().min(0).max(1),
  capability: catalogCandidateCapabilitySchema.optional(),
  manifest: catalogCapabilityManifestSchema.optional(),
});
export type CatalogCandidate = z.infer<typeof catalogCandidateSchema>;

export const candidateRelationshipSchema = z.enum([
  "competing",
  "complementary",
  "required_bundle",
  "optional",
  "fallback",
]);
export type CandidateRelationship = z.infer<typeof candidateRelationshipSchema>;

export const candidateEvaluationSchema = z.object({
  candidateId: z.string().min(1),
  status: z.enum(["accepted", "rejected", "needs_input"]),
  relationship: candidateRelationshipSchema,
  decisionGroupId: z.string().min(1),
  requirementIds: z.array(z.string().min(1)).default([]),
  satisfiedRequirementIds: z.array(z.string().min(1)).default([]),
  missingRequirementIds: z.array(z.string().min(1)).default([]),
  conflictingRequirementIds: z.array(z.string().min(1)).default([]),
  score: z.number().min(0).max(1),
  reasons: z.array(z.string().min(1)),
  evidence: z.array(intentEvidenceSchema).default([]),
});
export type CandidateEvaluation = z.infer<typeof candidateEvaluationSchema>;

export const decisionGroupSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  requirementIds: z.array(z.string().min(1)),
  relationship: candidateRelationshipSchema,
  candidateIds: z.array(z.string().min(1)),
  recommendedCandidateIds: z.array(z.string().min(1)).default([]),
});
export type DecisionGroup = z.infer<typeof decisionGroupSchema>;

export const catalogEvaluationResultSchema = z.object({
  accepted: z.array(catalogCandidateSchema),
  rejected: z.array(catalogCandidateSchema),
  evidence: z.array(candidateEvaluationSchema),
  decisionGroups: z.array(decisionGroupSchema).default([]),
  dynamicRequirements: z.array(dynamicRequirementSchema).default([]),
});
export type CatalogEvaluationResult = z.infer<
  typeof catalogEvaluationResultSchema
>;

export const candidateValidationSchema = z.object({
  candidateId: z.string().min(1),
  status: z.enum(["accepted", "rejected"]),
  reasons: z.array(z.string().min(1)),
  matchedConstraints: z.array(z.string().min(1)),
  failedConstraints: z.array(z.string().min(1)),
  requirementEvaluations: z
    .array(
      z.object({
        actionId: z.string().min(1),
        requirementId: z.string().min(1),
        status: z.enum([
          "satisfied",
          "missing",
          "ambiguous",
          "conflicting",
          "not_applicable",
        ]),
        reasons: z.array(z.string().min(1)),
        evidence: z.array(intentEvidenceSchema),
      })
    )
    .default([]),
});
export type CandidateValidation = z.infer<typeof candidateValidationSchema>;

export const catalogValidationResultSchema = z.object({
  accepted: z.array(catalogCandidateSchema),
  rejected: z.array(catalogCandidateSchema),
  evidence: z.array(candidateValidationSchema),
});
export type CatalogValidationResult = z.infer<
  typeof catalogValidationResultSchema
>;

export const builderPatchOpSchema = z.discriminatedUnion("op", [
  z.object({ op: z.literal("add_step"), step: intentStepSchema }),
  z.object({
    op: z.literal("update_step"),
    stepId: z.string().min(1),
    changes: intentStepSchema.partial(),
  }),
  z.object({ op: z.literal("remove_step"), stepId: z.string().min(1) }),
  z.object({
    op: z.literal("add_edge"),
    fromStepId: z.string().min(1),
    sourceHandle: z.string().min(1).optional(),
    targetHandle: z.string().min(1).optional(),
    toStepId: z.string().min(1),
  }),
  z.object({
    op: z.literal("answer_question"),
    questionId: z.string().min(1),
    answer: jsonValueSchema,
  }),
  z.object({
    op: z.literal("materialized"),
    workflowId: z.string().min(1),
    mode: z.enum(["create", "update"]),
  }),
]);
export const builderPatchSchema = z.object({
  id: z.string().min(1),
  ops: z.array(builderPatchOpSchema).min(1),
  summary: z.string().min(1),
});
export type BuilderPatch = z.infer<typeof builderPatchSchema>;
export type BuilderPatchOp = z.infer<typeof builderPatchOpSchema>;

export const builderOptionSchema = z.object({
  id: z.string().min(1),
  stepId: z.string().min(1),
  strategy: z.enum([
    "native_action",
    "fallback_action",
    "multi_source_fallback",
    "workflow_call",
    "generated_code",
    "request_native_capability",
  ]),
  title: z.string().min(1),
  rationale: z.string().min(1),
  risk: z.enum(["low", "medium", "high"]),
  confidence: z.number().min(0).max(1),
  candidateIds: z.array(z.string().min(1)),
  patch: builderPatchSchema,
  requiredInputs: z.array(z.string().min(1)),
  relationship: candidateRelationshipSchema.optional(),
  decisionGroupId: z.string().min(1).optional(),
  requirementIds: z.array(z.string().min(1)).optional(),
});
export type BuilderOption = z.infer<typeof builderOptionSchema>;

export const builderCandidateMetadataSchema = z.object({
  optionId: z.string().min(1),
  label: z.string().min(1),
  previewKind: z.literal("grey_future_branch"),
  risk: z.enum(["low", "medium", "high"]),
});
export type BuilderCandidateMetadata = z.infer<
  typeof builderCandidateMetadataSchema
>;
export type BuilderCandidateBranch = DagBranch<
  BuilderPatch,
  BuilderCandidateMetadata
>;

export const candidateBranchProjectionSchema = z.object({
  branchId: z.string().min(1),
  optionId: z.string().min(1),
  baseCommitId: z.string().min(1),
  status: z.enum(["open", "rejected", "selected", "stale"]),
  greyNodes: z.array(intentStepSchema),
  dashedEdges: z.array(
    z.object({
      fromStepId: z.string().min(1),
      sourceHandle: z.string().min(1).optional(),
      targetHandle: z.string().min(1).optional(),
      toStepId: z.string().min(1),
    })
  ),
});
export type CandidateBranchProjection = z.infer<
  typeof candidateBranchProjectionSchema
>;

export const workflowDraftSchema = z.object({
  id: z.string().min(1),
  nodes: z.array(intentStepSchema),
  edges: z.array(
    z.object({
      fromStepId: z.string().min(1),
      sourceHandle: z.string().min(1).optional(),
      targetHandle: z.string().min(1).optional(),
      toStepId: z.string().min(1),
    })
  ),
});
export type WorkflowDraft = z.infer<typeof workflowDraftSchema>;

export const validationIssueSchema = z.object({
  code: z.string().min(1),
  message: z.string().min(1),
  severity: z.enum(["info", "warning", "error"]),
  targetId: z.string().min(1).optional(),
});
export const validationResultSchema = z.object({
  valid: z.boolean(),
  issues: z.array(validationIssueSchema),
});
export type ValidationResult = z.infer<typeof validationResultSchema>;

export const builderProjectionSchema = z.object({
  sessionId: z.string().min(1),
  headCommitId: z.string().min(1).optional(),
  committed: workflowDraftSchema,
  candidateBranches: z.array(candidateBranchProjectionSchema),
  options: z.array(builderOptionSchema),
  questions: z.array(openQuestionSchema),
  timeline: z.array(
    z.object({
      id: z.string().min(1),
      kind: z.enum(["commit", "branch", "event"]),
      label: z.string().min(1),
      createdAt: z.string().min(1),
    })
  ),
  validation: validationResultSchema,
});
export type BuilderProjection = z.infer<typeof builderProjectionSchema>;

export const builderEventSchema = z.object({
  id: z.string().min(1),
  sessionId: z.string().min(1),
  turnId: z.string().min(1).optional(),
  eventKind: z.enum(["lifecycle", "audit"]),
  stage: z.string().min(1),
  phaseStatus: z.enum(["started", "completed", "failed"]).optional(),
  outcome: z
    .enum(["accepted", "rejected", "blocked", "requested", "materialized"])
    .optional(),
  actor: builderAuthContextSchema,
  targetId: z.string().min(1).optional(),
  model: z.string().min(1).optional(),
  templateName: z.string().min(1).optional(),
  templateVersion: z.string().min(1).optional(),
  durationMs: z.number().nonnegative().optional(),
  payload: recordSchema.optional(),
  createdAt: z.string().min(1),
});
export type BuilderEvent = z.infer<typeof builderEventSchema>;

export const builderTurnSchema = z.object({
  id: z.string().min(1),
  sessionId: z.string().min(1),
  input: z.string().min(1),
  intentPlan: intentPlanSchema,
  createdAt: z.string().min(1),
});
export type BuilderTurn = z.infer<typeof builderTurnSchema>;

export const builderSessionSchema = z.object({
  id: z.string().min(1),
  auth: builderAuthContextSchema,
  prompt: z.string().min(1),
  status: z.enum(["planning", "ready", "blocked", "materialized", "cancelled"]),
  dag: z.custom<DagSession<BuilderPatch, BuilderCandidateMetadata>>(),
  turns: z.array(builderTurnSchema),
  catalogCandidates: z.array(catalogCandidateSchema),
  options: z.array(builderOptionSchema),
  questions: z.array(openQuestionSchema),
  events: z.array(builderEventSchema),
  featureRequests: z.array(z.string().min(1)),
  createdAt: z.string().min(1),
  updatedAt: z.string().min(1),
});
export type BuilderSession = z.infer<typeof builderSessionSchema>;

export const missingCapabilitySchema = z.object({
  id: z.string().min(1),
  originalIntent: z.string().min(1),
  expectedInputs: z.array(z.string()),
  expectedOutputs: z.array(z.string()),
  context: recordSchema,
});
export type MissingCapability = z.infer<typeof missingCapabilitySchema>;
export const featureRequestSchema = z.object({
  id: z.string().min(1),
  sessionId: z.string().min(1),
  missingCapability: missingCapabilitySchema,
  createdAt: z.string().min(1),
});
export type FeatureRequest = z.infer<typeof featureRequestSchema>;

export const materializeWorkflowInputSchema = z.discriminatedUnion("mode", [
  z.object({
    mode: z.literal("create"),
    idempotencyKey: z.string().min(1),
    name: z.string().min(1),
  }),
  z.object({
    mode: z.literal("update"),
    idempotencyKey: z.string().min(1),
    workflowId: z.string().min(1),
    expectedRevision: z.number().int().nonnegative(),
    overwritePolicy: z.enum(["fail", "overwrite"]),
  }),
]);
export type MaterializeWorkflowInput = z.infer<
  typeof materializeWorkflowInputSchema
>;

export const regenerateInputSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("after_node"), nodeId: z.string().min(1) }),
  z.object({ kind: z.literal("replace_node"), nodeId: z.string().min(1) }),
  z.object({ kind: z.literal("from_commit"), commitId: z.string().min(1) }),
]);
export type RegenerateInput = z.infer<typeof regenerateInputSchema>;
