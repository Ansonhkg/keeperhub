import {
  createBranch,
  markBranchStale,
  rejectBranch,
  requireBranch,
} from "@keeperhub/builder-dag/branch";
import {
  appendCommit,
  createDagSession,
  pathToHead,
} from "@keeperhub/builder-dag/commit-graph";
import { abandonDownstreamBranches } from "@keeperhub/builder-dag/fork";
import { orderedTimeline } from "@keeperhub/builder-dag/projection";
import { z } from "zod";
import {
  createAuditEvent,
  createLifecycleEvent,
} from "../events/builder-events";
import type { BuilderPorts } from "../ports/all";
import { runCatalogCandidateEvaluation } from "./candidate-evaluation";
import { inferCandidateCapability } from "./candidate-validation";
import {
  normalizeIntentPlanForIntentIR,
  resolveIntentConstraints,
} from "./intent-resolution";

export { inferCandidateCapability } from "./candidate-validation";
export { resolveIntentConstraints } from "./intent-resolution";

import {
  type AnswerQuestionInput,
  answerQuestionInputSchema,
  type BuilderAuthContext,
  type BuilderOption,
  type BuilderPatch,
  type BuilderProjection,
  type BuilderSession,
  builderOptionSchema,
  builderPatchSchema,
  builderProjectionSchema,
  builderSessionSchema,
  type CandidateEvaluation,
  type CandidateValidation,
  type CatalogCandidate,
  catalogCandidateSchema,
  entitySchema,
  type IntentPlan,
  type IntentStep,
  intentPlanSchema,
  type MaterializeWorkflowInput,
  type MissingCapability,
  materializeWorkflowInputSchema,
  type RegenerateInput,
  regenerateInputSchema,
  type ValidationResult,
  type WorkflowDraft,
} from "../schemas/all";

export type BuilderRuntime = ReturnType<typeof createBuilderRuntime>;

export type BuilderProgressEvent = {
  readonly detail?: string;
  readonly label: string;
  readonly stage: string;
  readonly status: "running" | "completed";
};

type BuilderProgressReporter = (
  event: BuilderProgressEvent
) => Promise<void> | void;

function jsonPayload<T>(payload: T): T {
  return JSON.parse(JSON.stringify(payload)) as T;
}

export function createBuilderRuntime(ports: BuilderPorts) {
  return {
    startSession: (
      auth: BuilderAuthContext,
      prompt: string,
      context?: string
    ) => startSession(ports, auth, prompt, context),
    startSessionWithProgress: (
      auth: BuilderAuthContext,
      prompt: string,
      context: string | undefined,
      onProgress: BuilderProgressReporter
    ) => startSession(ports, auth, prompt, context, onProgress),
    getProjection: (auth: BuilderAuthContext, sessionId: string) =>
      getProjection(ports, auth, sessionId),
    getEvents: (auth: BuilderAuthContext, sessionId: string) =>
      ports.store.listEvents(auth, sessionId),
    selectOption: (
      auth: BuilderAuthContext,
      sessionId: string,
      optionId: string,
      expectedRevision?: number
    ) => selectOption(ports, auth, sessionId, optionId, expectedRevision),
    rejectOption: (
      auth: BuilderAuthContext,
      sessionId: string,
      optionId: string
    ) => rejectOption(ports, auth, sessionId, optionId),
    answerQuestion: (
      auth: BuilderAuthContext,
      sessionId: string,
      input: AnswerQuestionInput
    ) => answerQuestion(ports, auth, sessionId, input),
    regenerateFromNode: (
      auth: BuilderAuthContext,
      sessionId: string,
      input: RegenerateInput
    ) => regenerateFromNode(ports, auth, sessionId, input),
    requestNativeCapability: (
      auth: BuilderAuthContext,
      sessionId: string,
      missingCapability: MissingCapability
    ) => requestNativeCapability(ports, auth, sessionId, missingCapability),
    materializeWorkflow: (
      auth: BuilderAuthContext,
      sessionId: string,
      input: MaterializeWorkflowInput
    ) => materializeWorkflow(ports, auth, sessionId, input),
    cancelSession: (auth: BuilderAuthContext, sessionId: string) =>
      cancelSession(ports, auth, sessionId),
  };
}

async function startSession(
  ports: BuilderPorts,
  auth: BuilderAuthContext,
  prompt: string,
  context?: string,
  onProgress: BuilderProgressReporter = () => undefined
): Promise<BuilderProjection> {
  const progress = (event: BuilderProgressEvent) =>
    Promise.resolve(onProgress(event));
  const now = ports.clock.now();
  const sessionId = ports.ids.next("builder_session");
  await progress({
    label: "Decomposing the prompt into requirements",
    stage: "intent_planner",
    status: "running",
  });
  const plan = normalizeIntentPlanForIntentIR(
    await runIntentPlanner(ports, auth, sessionId, prompt, context)
  );
  await progress({
    detail: `${plan.steps.length} planned step${plan.steps.length === 1 ? "" : "s"}`,
    label: "Resolved the initial intent plan",
    stage: "intent_planner",
    status: "completed",
  });
  await progress({
    label: "Checking which requirements are satisfied or unresolved",
    stage: "requirement_resolution",
    status: "running",
  });
  const intentResolution = resolveIntentConstraints(plan);
  const requirementEvent = createLifecycleEvent({
    actor: auth,
    createdAt: ports.clock.now(),
    id: ports.ids.next("event"),
    model: "builder-runtime",
    payload: jsonPayload({
      actions: intentResolution.actions.map((action) => ({
        id: action.id,
        kind: action.kind,
        requirementIds: action.requirementIds,
        title: action.title,
      })),
      dynamicRequirements: (intentResolution.dynamicRequirements ?? []).map(
        (requirement) => ({
          id: requirement.id,
          key: requirement.key,
          kind: requirement.requirementKind,
          status: requirement.status,
          value: requirement.value,
        })
      ),
      intentIR: intentResolution.intentIR,
      requirements: intentResolution.requirements.map((requirement) => ({
        appliesTo: requirement.appliesTo,
        id: requirement.id,
        status: requirement.status,
        type: requirement.type,
        value: requirement.value,
      })),
    }),
    phaseStatus: "completed",
    sessionId,
    stage: "requirement_resolution",
  });
  await ports.events.emit(auth, requirementEvent);
  await progress({
    detail: `${intentResolution.requirements.length} requirement${intentResolution.requirements.length === 1 ? "" : "s"} evaluated`,
    label: "Evaluated requirement coverage",
    stage: "requirement_resolution",
    status: "completed",
  });
  await progress({
    label: "Searching native and custom node catalogs",
    stage: "catalog_search",
    status: "running",
  });
  const candidates = await runCatalogSearch(ports, auth, sessionId, plan);
  await progress({
    detail: `${candidates.length} candidate${candidates.length === 1 ? "" : "s"} found`,
    label: "Found matching node candidates",
    stage: "catalog_search",
    status: "completed",
  });
  await progress({
    label: "Evaluating candidates against the requirements",
    stage: "candidate_evaluation",
    status: "running",
  });
  const evaluationRun = await runCatalogCandidateEvaluation(
    ports,
    intentResolution,
    candidates
  );
  const evaluatedCandidates = evaluationRun.output;
  await progress({
    detail: `${evaluatedCandidates.accepted.length} accepted, ${evaluatedCandidates.rejected.length} rejected`,
    label: "Filtered candidate matches",
    stage: "candidate_evaluation",
    status: "completed",
  });
  const evaluationEvent = createLifecycleEvent({
    actor: auth,
    createdAt: ports.clock.now(),
    id: ports.ids.next("event"),
    durationMs: evaluationRun.durationMs,
    model: evaluationRun.model,
    payload: {
      acceptedCount: evaluatedCandidates.accepted.length,
      decisionGroupCount: evaluatedCandidates.decisionGroups.length,
      dynamicRequirementCount: evaluatedCandidates.dynamicRequirements.length,
      rejectedCount: evaluatedCandidates.rejected.length,
      rejectionReasons: evaluatedCandidates.evidence
        .filter((item) => item.status === "rejected")
        .slice(0, 8)
        .map((item) => ({
          candidateId: item.candidateId,
          reasons: item.reasons.slice(0, 3),
        })),
    },
    phaseStatus: "completed",
    sessionId,
    stage: "candidate_evaluation",
    templateName: "candidate-evaluator",
    templateVersion: "1.0.0",
  });
  const validationCompatibilityEvent = {
    ...evaluationEvent,
    id: ports.ids.next("event"),
    stage: "candidate_validation",
  };
  await ports.events.emit(auth, evaluationEvent);
  await ports.events.emit(auth, validationCompatibilityEvent);
  await progress({
    label: "Ranking native matches before fallbacks",
    stage: "candidate_ranking",
    status: "running",
  });
  const rankedCandidates = await runCatalogRanker(
    ports,
    auth,
    sessionId,
    evaluatedCandidates.accepted
  );
  await progress({
    detail: `${rankedCandidates.length} ranked candidate${rankedCandidates.length === 1 ? "" : "s"}`,
    label: "Ranked candidate options",
    stage: "candidate_ranking",
    status: "completed",
  });
  await progress({
    label: "Preparing selectable builder decisions",
    stage: "option_generation",
    status: "running",
  });
  const options = withGeneratedFallbackOptions(
    ports,
    plan,
    await runOptionGenerator(
      ports,
      auth,
      sessionId,
      plan,
      rankedCandidates,
      evaluatedCandidates.evidence
    )
  );
  await progress({
    detail: `${options.length} option${options.length === 1 ? "" : "s"} prepared`,
    label: "Prepared decision options",
    stage: "option_generation",
    status: "completed",
  });
  await progress({
    label: "Projecting preview branches onto the canvas",
    stage: "preview_projection",
    status: "running",
  });
  const predictions = await runPredictionEngine(
    ports,
    auth,
    sessionId,
    options
  );
  const questionIds = buildQuestionIds(intentResolution, options.length);
  let dag = createDagSession<
    BuilderPatch,
    {
      optionId: string;
      label: string;
      previewKind: "grey_future_branch";
      risk: "low" | "medium" | "high";
    }
  >(sessionId);
  const rootPatch: BuilderPatch = {
    id: ports.ids.next("patch"),
    summary: "Initial intent plan",
    ops: [
      ...plan.steps.map((step) => ({ op: "add_step" as const, step })),
      ...branchEdgesForIntentPlan(plan),
    ],
  };
  dag = appendCommit(dag, {
    id: ports.ids.next("commit"),
    parentIds: [],
    patch: rootPatch,
    createdAt: now,
    metadata: { event: "session.started" },
  });
  for (const option of options) {
    dag = createBranch(dag, {
      id: option.id,
      baseCommitId: dag.headCommitId ?? "",
      patch: mergePatches(option.patch, predictions.get(option.id)),
      metadata: {
        optionId: option.id,
        label: option.title,
        previewKind: "grey_future_branch",
        risk: option.risk,
      },
      createdAt: now,
    });
  }
  const event = createLifecycleEvent({
    id: ports.ids.next("event"),
    sessionId,
    actor: auth,
    stage: "session.start",
    phaseStatus: "completed",
    createdAt: now,
    templateName: "intent-decomposer",
    templateVersion: "1.0.0",
    model: "builder-runtime",
    payload: { hasContext: Boolean(context), optionCount: options.length },
  });
  const session = builderSessionSchema.parse({
    id: sessionId,
    auth,
    prompt,
    status: "ready",
    dag,
    turns: [
      {
        id: ports.ids.next("turn"),
        sessionId,
        input: prompt,
        intentPlan: plan,
        createdAt: now,
      },
    ],
    catalogCandidates: [...rankedCandidates],
    options,
    questions: buildInlineQuestions(
      questionIds,
      plan,
      intentResolution,
      candidates
    ),
    events: [
      requirementEvent,
      evaluationEvent,
      validationCompatibilityEvent,
      event,
    ],
    featureRequests: [],
    createdAt: now,
    updatedAt: now,
  });
  await ports.store.createSession(auth, session);
  await ports.events.emit(auth, event);
  await progress({
    detail: `${options.length} option${options.length === 1 ? "" : "s"}, ${session.questions.length} question${session.questions.length === 1 ? "" : "s"}`,
    label: "Builder decisions are ready",
    stage: "preview_projection",
    status: "completed",
  });
  return projectSession(session);
}

export async function runIntentPlanner(
  ports: BuilderPorts,
  auth: BuilderAuthContext,
  sessionId: string,
  prompt: string,
  context?: string
): Promise<IntentPlan> {
  const plannerIntent = context
    ? `${prompt}\n\nExisting workflow context:\n${context}`
    : prompt;
  const entityResult = await ports.ai.run(
    {
      outputSchemaName: "{ entities: Entity[] }",
      templateName: "entity-extractor",
      templateVersion: "1.0.0",
      variables: { intent: plannerIntent, workflowContext: context ?? "" },
    },
    (output) =>
      zObject("entity extraction", output, (value) => ({
        entities: entitySchema.array().parse(coerceEntities(value.entities)),
      }))
  );
  const planResult = await ports.ai.run(
    {
      outputSchemaName: "IntentPlan",
      templateName: "intent-decomposer",
      templateVersion: "1.0.0",
      variables: {
        entities: JSON.stringify(entityResult.output.entities),
        intent: plannerIntent,
        workflowContext: context ?? "",
      },
    },
    (output) => intentPlanSchema.parse(coerceIntentPlanOutput(output))
  );
  const plan: IntentPlan = {
    ...planResult.output,
    entities: entityResult.output.entities,
    id: planResult.output.id || ports.ids.next("intent_plan"),
    sourceText: prompt,
  };
  await ports.events.emit(
    auth,
    createLifecycleEvent({
      id: ports.ids.next("event"),
      sessionId,
      actor: auth,
      stage: "intent_planner",
      phaseStatus: "completed",
      createdAt: ports.clock.now(),
      templateName: "intent-decomposer",
      templateVersion: "1.0.0",
      model: planResult.model,
      durationMs: planResult.durationMs,
      payload: { input: prompt },
    })
  );
  return plan;
}

function coerceEntities(value: unknown): unknown[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.flatMap((entity, index) => {
    if (!entity || typeof entity !== "object" || Array.isArray(entity)) {
      return [];
    }
    const record = entity as Record<string, unknown>;
    return [
      {
        ...record,
        canonicalValue:
          record.canonicalValue === undefined
            ? undefined
            : String(record.canonicalValue),
        confidence:
          typeof record.confidence === "number" ? record.confidence : 0.5,
        id: record.id === undefined ? `entity_${index + 1}` : String(record.id),
        kind: record.kind === undefined ? "unknown" : String(record.kind),
        label: record.label === undefined ? "Unknown" : String(record.label),
      },
    ];
  });
}

function coerceIntentPlanOutput(output: unknown): unknown {
  if (!output || typeof output !== "object" || Array.isArray(output)) {
    return output;
  }
  const record = output as Record<string, unknown>;
  return {
    ...record,
    entities: coerceEntities(record.entities),
    id: record.id === undefined ? "intent_plan" : String(record.id),
    openQuestionIds: Array.isArray(record.openQuestionIds)
      ? record.openQuestionIds.map(String)
      : [],
    sourceText:
      record.sourceText === undefined ? "" : String(record.sourceText),
    steps: Array.isArray(record.steps)
      ? record.steps.map((step, index) => {
          if (!step || typeof step !== "object" || Array.isArray(step)) {
            return step;
          }
          const stepRecord = step as Record<string, unknown>;
          return {
            ...stepRecord,
            dependsOn: Array.isArray(stepRecord.dependsOn)
              ? stepRecord.dependsOn.map(String)
              : [],
            id:
              stepRecord.id === undefined
                ? `step_${index + 1}`
                : String(stepRecord.id),
            kind: coerceIntentStepKind(stepRecord.kind, stepRecord.label),
            label:
              stepRecord.label === undefined
                ? `Step ${index + 1}`
                : String(stepRecord.label),
            requiredEntityIds: Array.isArray(stepRecord.requiredEntityIds)
              ? stepRecord.requiredEntityIds.map(String)
              : [],
          };
        })
      : [],
  };
}

function coerceIntentStepKind(
  kind: unknown,
  label: unknown
): IntentStep["kind"] {
  const normalizedKind = String(kind ?? "").toLowerCase();
  if (
    [
      "trigger",
      "read",
      "transform",
      "condition",
      "notify",
      "write",
      "missing_capability",
    ].includes(normalizedKind)
  ) {
    return normalizedKind as IntentStep["kind"];
  }
  const normalizedLabel = String(label ?? "").toLowerCase();
  if (/\b(every|schedule|manual|trigger|when)\b/.test(normalizedLabel)) {
    return "trigger";
  }
  if (/\b(price|read|get|fetch|check)\b/.test(normalizedLabel)) {
    return "read";
  }
  if (/\b(if|condition|threshold|below|above)\b/.test(normalizedLabel)) {
    return "condition";
  }
  if (
    /\b(notify|alert|webhook|message|email|slack|telegram)\b/.test(
      normalizedLabel
    )
  ) {
    return "notify";
  }
  if (/\b(write|swap|transfer|send transaction)\b/.test(normalizedLabel)) {
    return "write";
  }
  return "transform";
}

export async function runCatalogSearch(
  ports: BuilderPorts,
  auth: BuilderAuthContext,
  sessionId: string,
  intentPlan: IntentPlan
): Promise<readonly CatalogCandidate[]> {
  const output = await ports.catalog.search({
    auth,
    intentPlan,
    query: intentPlan.sourceText,
  });
  await ports.events.emit(
    auth,
    createLifecycleEvent({
      actor: auth,
      createdAt: ports.clock.now(),
      id: ports.ids.next("event"),
      model: "builder-runtime",
      payload: { candidateCount: output.length },
      phaseStatus: "completed",
      sessionId,
      stage: "catalog_search",
    })
  );
  return output;
}

async function runCatalogRanker(
  ports: BuilderPorts,
  auth: BuilderAuthContext,
  sessionId: string,
  candidates: readonly CatalogCandidate[]
): Promise<readonly CatalogCandidate[]> {
  if (candidates.length === 0) {
    return [];
  }
  const ranked = await ports.ai.run(
    {
      outputSchemaName: "CatalogCandidate[]",
      templateName: "catalog-ranker",
      templateVersion: "1.0.0",
      variables: { candidates: JSON.stringify(candidates) },
    },
    (output) => normalizeRankedCatalogOutput(output, candidates)
  );
  const output = [...ranked.output].sort(
    (left, right) => right.score - left.score
  );
  await ports.events.emit(
    auth,
    createLifecycleEvent({
      actor: auth,
      createdAt: ports.clock.now(),
      durationMs: ranked.durationMs,
      id: ports.ids.next("event"),
      model: ranked.model,
      payload: { candidateCount: output.length },
      phaseStatus: "completed",
      sessionId,
      stage: "catalog_ranker",
      templateName: "catalog-ranker",
      templateVersion: "1.0.0",
    })
  );
  return output;
}

function normalizeRankedCatalogOutput(
  output: unknown,
  sourceCandidates: readonly CatalogCandidate[]
): readonly CatalogCandidate[] {
  const sourceById = new Map(
    sourceCandidates.map((candidate) => [candidate.id, candidate])
  );
  const parsed = z.array(z.unknown()).safeParse(output);
  if (!parsed.success) {
    return sourceCandidates;
  }
  const normalized: CatalogCandidate[] = [];
  for (const item of parsed.data) {
    const full = catalogCandidateSchema.safeParse(item);
    if (full.success) {
      normalized.push(full.data);
      continue;
    }
    if (typeof item === "string") {
      const source = sourceById.get(item);
      if (source) {
        normalized.push(source);
      }
      continue;
    }
    if (item && typeof item === "object" && "id" in item) {
      const source = sourceById.get(String(item.id));
      if (source) {
        const score =
          "score" in item && typeof item.score === "number"
            ? Math.max(0, Math.min(1, item.score))
            : source.score;
        normalized.push({ ...source, score });
      }
    }
  }
  const seen = new Set(normalized.map((candidate) => candidate.id));
  return [
    ...normalized,
    ...sourceCandidates.filter((candidate) => !seen.has(candidate.id)),
  ];
}

export async function runOptionGenerator(
  ports: BuilderPorts,
  auth: BuilderAuthContext,
  sessionId: string,
  intentPlan: IntentPlan,
  candidates: readonly CatalogCandidate[],
  validationEvidence: readonly (
    | CandidateValidation
    | CandidateEvaluation
  )[] = []
): Promise<readonly BuilderOption[]> {
  if (candidates.length === 0) {
    return [];
  }
  const optionCandidates = orderCandidatesForOptionCoverage(
    intentPlan,
    candidates
  );
  let generated: {
    readonly durationMs: number;
    readonly model: string;
    readonly output: readonly BuilderOption[];
  };
  try {
    generated = await ports.ai.run(
      {
        outputSchemaName: "BuilderOption[]",
        templateName: "option-generator",
        templateVersion: "1.0.0",
        variables: {
          candidates: JSON.stringify(optionCandidates),
          intentPlan: JSON.stringify(intentPlan),
          validationEvidence: JSON.stringify(validationEvidence),
        },
      },
      (output) => builderOptionSchema.array().parse(output)
    );
  } catch {
    generated = {
      durationMs: 0,
      model: "option-generator-fallback",
      output: buildFallbackOptions(ports, intentPlan, optionCandidates),
    };
  }
  const generatedOptions = generated.output.length
    ? generated.output
    : buildFallbackOptions(ports, intentPlan, optionCandidates);
  const evaluationByCandidateId =
    evaluationMetadataByCandidateId(validationEvidence);
  const candidatesById = new Map(
    optionCandidates.map((candidate) => [candidate.id, candidate])
  );
  const options = splitCompetingCandidateOptions(
    generatedOptions,
    evaluationByCandidateId,
    candidatesById
  ).map((option) =>
    alignOptionToCandidateStep(
      {
        ...option,
        ...optionEvaluationMetadata(option, evaluationByCandidateId),
        id: option.id || ports.ids.next("option"),
        patch: {
          ...option.patch,
          id: option.patch.id || ports.ids.next("patch"),
        },
      },
      intentPlan,
      candidatesById
    )
  );
  await ports.events.emit(
    auth,
    createLifecycleEvent({
      actor: auth,
      createdAt: ports.clock.now(),
      durationMs: generated.durationMs,
      id: ports.ids.next("event"),
      model: generated.model,
      payload: { optionCount: options.length },
      phaseStatus: "completed",
      sessionId,
      stage: "option_generator",
      templateName: "option-generator",
      templateVersion: "1.0.0",
    })
  );
  return options;
}

function splitCompetingCandidateOptions(
  options: readonly BuilderOption[],
  evaluations: ReadonlyMap<string, CandidateEvaluation>,
  candidatesById: ReadonlyMap<string, CatalogCandidate>
): readonly BuilderOption[] {
  return options.flatMap((option) => {
    const candidateIds = [
      ...new Set(
        option.candidateIds.filter((candidateId) =>
          candidatesById.has(candidateId)
        )
      ),
    ];
    if (candidateIds.length <= 1) {
      return [{ ...option, candidateIds }];
    }
    const candidateEvaluations = candidateIds.map((candidateId) =>
      evaluations.get(candidateId)
    );
    const decisionGroupIds = new Set(
      candidateEvaluations.flatMap((evaluation) =>
        evaluation?.decisionGroupId ? [evaluation.decisionGroupId] : []
      )
    );
    const shouldSplit =
      decisionGroupIds.size === 1 &&
      candidateEvaluations.every(
        (evaluation) => evaluation?.relationship === "competing"
      );
    if (!shouldSplit) {
      return [{ ...option, candidateIds }];
    }
    return candidateIds.map((candidateId, index) => {
      const candidate = candidatesById.get(candidateId);
      const suffix = candidateId.replace(/[^a-z0-9]+/gi, "-");
      return {
        ...option,
        candidateIds: [candidateId],
        confidence: candidate?.score ?? option.confidence,
        id: index === 0 ? option.id : `${option.id}-${suffix}`,
        patch: {
          ...option.patch,
          id: index === 0 ? option.patch.id : `${option.patch.id}-${suffix}`,
          ops: option.patch.ops.map((op) =>
            op.op === "update_step" && candidate
              ? {
                  ...op,
                  changes: {
                    ...op.changes,
                    label: candidate.label,
                    status: "ready" as const,
                  },
                }
              : op
          ),
          summary: candidate ? `Use ${candidate.label}` : option.patch.summary,
        },
        rationale: candidate?.description ?? option.rationale,
        requiredInputs: candidate?.requiredInputs ?? option.requiredInputs,
        title: candidate?.label ?? option.title,
      };
    });
  });
}

function orderCandidatesForOptionCoverage(
  intentPlan: IntentPlan,
  candidates: readonly CatalogCandidate[]
): readonly CatalogCandidate[] {
  const remaining = new Map(
    candidates.map((candidate) => [candidate.id, candidate])
  );
  const ordered: CatalogCandidate[] = [];
  for (const step of intentPlan.steps) {
    const candidate = candidates.find(
      (item) =>
        remaining.has(item.id) &&
        targetStepIdForCandidate(intentPlan, item) === step.id
    );
    if (!candidate) {
      continue;
    }
    ordered.push(candidate);
    remaining.delete(candidate.id);
  }
  return [
    ...ordered,
    ...candidates.filter((candidate) => remaining.has(candidate.id)),
  ];
}

function alignOptionToCandidateStep(
  option: BuilderOption,
  intentPlan: IntentPlan,
  candidatesById: ReadonlyMap<string, CatalogCandidate>
): BuilderOption {
  const targetCandidate = option.candidateIds
    .map((candidateId) => candidatesById.get(candidateId))
    .find((candidate): candidate is CatalogCandidate => Boolean(candidate));
  const targetStepId = targetCandidate
    ? targetStepIdForCandidate(intentPlan, targetCandidate)
    : undefined;
  if (!targetStepId || targetStepId === option.stepId) {
    return retargetMissingCapabilityOption(option, intentPlan, targetCandidate);
  }
  return {
    ...option,
    patch: {
      ...option.patch,
      ops: option.patch.ops.map((op) =>
        op.op === "update_step"
          ? {
              ...op,
              changes: stepChangesForCandidate(
                op.changes,
                intentPlan,
                targetStepId,
                targetCandidate
              ),
              stepId: targetStepId,
            }
          : op
      ),
    },
    stepId: targetStepId,
  };
}

function retargetMissingCapabilityOption(
  option: BuilderOption,
  intentPlan: IntentPlan,
  candidate: CatalogCandidate | undefined
): BuilderOption {
  return {
    ...option,
    patch: {
      ...option.patch,
      ops: option.patch.ops.map((op) =>
        op.op === "update_step"
          ? {
              ...op,
              changes: stepChangesForCandidate(
                op.changes,
                intentPlan,
                op.stepId,
                candidate
              ),
            }
          : op
      ),
    },
  };
}

function stepChangesForCandidate(
  changes: Partial<IntentPlan["steps"][number]>,
  intentPlan: IntentPlan,
  stepId: string,
  candidate: CatalogCandidate | undefined
): Partial<IntentPlan["steps"][number]> {
  const step = intentPlan.steps.find((item) => item.id === stepId);
  if (step?.kind !== "missing_capability" || !candidate) {
    return changes;
  }
  const capability =
    candidate.capability ?? inferCandidateCapability(candidate);
  const kind = stepKindForCapability(capability.kind);
  return kind ? { ...changes, kind } : changes;
}

function stepKindForCapability(
  kind: NonNullable<CatalogCandidate["capability"]>["kind"]
): IntentPlan["steps"][number]["kind"] | undefined {
  if (kind === "wallet_write") {
    return "write";
  }
  if (kind === "price_feed" || kind === "wallet_read") {
    return "read";
  }
  if (kind === "notification" || kind === "http_request") {
    return "notify";
  }
  if (
    kind === "code_execution" ||
    kind === "numeric_aggregate" ||
    kind === "transform"
  ) {
    return "transform";
  }
  return undefined;
}

function targetStepIdForCandidate(
  intentPlan: IntentPlan,
  candidate: CatalogCandidate
): string | undefined {
  const capability =
    candidate.capability ?? inferCandidateCapability(candidate);
  if (!capability) {
    return undefined;
  }
  if (capability.kind === "price_feed") {
    return findStepByKindAndAsset(
      intentPlan,
      "read",
      capability.assetPair?.base
    );
  }
  if (capability.kind === "wallet_write") {
    return (
      findStepByKindAndOperation(intentPlan, "write", capability.operation) ??
      findMissingCapabilityStep(intentPlan, capability.operation)
    );
  }
  if (
    capability.kind === "notification" ||
    capability.kind === "http_request"
  ) {
    return intentPlan.steps.find((step) => step.kind === "notify")?.id;
  }
  if (
    capability.kind === "code_execution" ||
    capability.kind === "numeric_aggregate" ||
    capability.kind === "transform"
  ) {
    return (
      intentPlan.steps.find((step) => step.kind === "transform")?.id ??
      intentPlan.steps.find((step) => step.kind === "condition")?.id
    );
  }
  if (capability.kind === "schedule") {
    return intentPlan.steps.find((step) => step.kind === "trigger")?.id;
  }
  return undefined;
}

function findMissingCapabilityStep(
  intentPlan: IntentPlan,
  operation: string | undefined
): string | undefined {
  const normalizedOperation = operation?.toLowerCase();
  return (
    intentPlan.steps.find(
      (step) =>
        step.kind === "missing_capability" &&
        (!normalizedOperation ||
          step.label.toLowerCase().includes(normalizedOperation))
    )?.id ??
    intentPlan.steps.find((step) => step.kind === "missing_capability")?.id
  );
}

function findStepByKindAndAsset(
  intentPlan: IntentPlan,
  kind: IntentPlan["steps"][number]["kind"],
  asset: string | undefined
): string | undefined {
  const normalizedAsset = asset?.toLowerCase();
  return (
    intentPlan.steps.find(
      (step) =>
        step.kind === kind &&
        (!normalizedAsset ||
          step.label.toLowerCase().includes(normalizedAsset) ||
          step.requiredEntityIds.some((entityId) =>
            entityId.toLowerCase().includes(normalizedAsset)
          ))
    )?.id ?? intentPlan.steps.find((step) => step.kind === kind)?.id
  );
}

function findStepByKindAndOperation(
  intentPlan: IntentPlan,
  kind: IntentPlan["steps"][number]["kind"],
  operation: string | undefined
): string | undefined {
  const normalizedOperation = operation?.toLowerCase();
  return (
    intentPlan.steps.find(
      (step) =>
        step.kind === kind &&
        (!normalizedOperation ||
          step.label.toLowerCase().includes(normalizedOperation))
    )?.id ?? intentPlan.steps.find((step) => step.kind === kind)?.id
  );
}

function evaluationMetadataByCandidateId(
  evidence: readonly (CandidateValidation | CandidateEvaluation)[]
): ReadonlyMap<string, CandidateEvaluation> {
  const evaluations = new Map<string, CandidateEvaluation>();
  for (const item of evidence) {
    if ("relationship" in item) {
      evaluations.set(item.candidateId, item);
    }
  }
  return evaluations;
}

function optionEvaluationMetadata(
  option: BuilderOption,
  evaluations: ReadonlyMap<string, CandidateEvaluation>
): Pick<BuilderOption, "decisionGroupId" | "relationship" | "requirementIds"> {
  const firstEvaluation = option.candidateIds
    .map((candidateId) => evaluations.get(candidateId))
    .find((evaluation): evaluation is CandidateEvaluation =>
      Boolean(evaluation)
    );
  return {
    decisionGroupId: firstEvaluation?.decisionGroupId,
    relationship: firstEvaluation?.relationship,
    requirementIds: firstEvaluation?.requirementIds,
  };
}

function buildInlineQuestions(
  questionIds: readonly string[],
  plan: IntentPlan,
  intentResolution: ReturnType<typeof resolveIntentConstraints>,
  candidates: readonly CatalogCandidate[] = []
): BuilderSession["questions"] {
  const notificationChoices = notificationChoicesFromCandidates(candidates);
  const dynamicQuestions = new Map(
    (intentResolution.dynamicRequirements ?? [])
      .filter((requirement) => requirement.question)
      .map((requirement) => [requirement.question?.id, requirement] as const)
  );
  return questionIds.map((id) => {
    const dynamicRequirement = dynamicQuestions.get(id);
    const dynamicQuestion = dynamicRequirement?.question;
    if (dynamicQuestion) {
      return {
        answerType: dynamicQuestion.answerType,
        cardinality: dynamicQuestion.cardinality,
        choices:
          id === "question-notification-channel" &&
          notificationChoices.length > 0
            ? notificationChoices
            : dynamicQuestion.choices,
        id,
        prompt: dynamicQuestion.prompt,
        requirementId: dynamicRequirement.id,
        status: "open" as const,
        stepId: plan.steps.find(
          (step) => step.id === dynamicRequirement.appliesTo
        )?.id,
      };
    }
    if (id === "question-candidate-clarification") {
      return {
        answerType: "text" as const,
        choices: undefined,
        id,
        prompt: "Which provider, resource, or action should be used?",
        status: "open" as const,
      };
    }
    return {
      answerType: "single_choice" as const,
      choices: notificationChoices.length > 0 ? notificationChoices : undefined,
      id,
      prompt: "Which notification channel should be used?",
      status: "open" as const,
      stepId: plan.steps.find((step) => step.kind === "notify")?.id,
    };
  });
}

function notificationChoicesFromCandidates(
  candidates: readonly CatalogCandidate[]
): string[] {
  const labels = new Map<string, string>();
  for (const candidate of candidates) {
    const capability =
      candidate.capability ?? inferCandidateCapability(candidate);
    const isNotification =
      capability.kind === "notification" || capability.kind === "http_request";
    if (!isNotification) {
      continue;
    }
    const provider =
      capability.provider ??
      candidate.manifest?.actionId?.split("/")[0] ??
      candidate.id.replace(/^(native|protocol|system)-/, "").split("/")[0];
    if (!provider) {
      continue;
    }
    const normalized = provider.toLowerCase().replace(/[^a-z0-9]+/g, "-");
    const label = provider
      .split(/[-_\s]+/)
      .filter(Boolean)
      .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
      .join(" ");
    labels.set(normalized, label);
  }
  return [...labels.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([, label]) => label);
}

function buildQuestionIds(
  intentResolution: ReturnType<typeof resolveIntentConstraints>,
  optionCount: number
): readonly string[] {
  const unresolvedQuestionIds =
    questionIdsForUnresolvedRequirements(intentResolution);
  return [
    ...(optionCount === 0 && unresolvedQuestionIds.length === 0
      ? ["question-candidate-clarification"]
      : []),
    ...unresolvedQuestionIds,
  ].filter(
    (questionId, index, questionIds) =>
      questionIds.indexOf(questionId) === index
  );
}

function questionIdsForUnresolvedRequirements(
  intentResolution: ReturnType<typeof resolveIntentConstraints>
): readonly string[] {
  const questionIds = new Set<string>();
  for (const requirement of intentResolution.dynamicRequirements ?? []) {
    if (requirement.status === "missing" && requirement.question) {
      questionIds.add(requirement.question.id);
    }
  }
  if (questionIds.size > 0) {
    return [...questionIds];
  }
  for (const requirement of intentResolution.requirements) {
    if (requirement.status !== "missing") {
      continue;
    }
    if (requirement.type === "notification_channel") {
      questionIds.add("question-notification-channel");
    } else {
      questionIds.add("question-candidate-clarification");
    }
  }
  return [...questionIds];
}

function buildFallbackOptions(
  ports: BuilderPorts,
  intentPlan: IntentPlan,
  candidates: readonly CatalogCandidate[]
): readonly BuilderOption[] {
  return candidates.slice(0, 3).map((candidate, index) => {
    const stepId =
      intentPlan.steps[Math.min(index + 1, intentPlan.steps.length - 1)]?.id ??
      intentPlan.steps[0]?.id ??
      ports.ids.next("step");
    return {
      candidateIds: [candidate.id],
      confidence: candidate.score,
      id: `option-${candidate.id}`,
      patch: {
        id: `patch-${candidate.id}`,
        ops: [
          {
            changes: {
              label: candidate.label,
              status: candidate.provider === "missing" ? "blocked" : "ready",
            },
            op: "update_step" as const,
            stepId,
          },
        ],
        summary: `Use ${candidate.label}`,
      },
      rationale: candidate.description,
      requiredInputs: candidate.requiredInputs,
      risk: candidate.provider === "missing" ? "high" : "low",
      stepId,
      strategy:
        candidate.provider === "native" || candidate.provider === "protocol"
          ? "native_action"
          : candidate.provider === "missing"
            ? "request_native_capability"
            : "fallback_action",
      title: candidate.label,
    };
  });
}

function withGeneratedFallbackOptions(
  ports: BuilderPorts,
  intentPlan: IntentPlan,
  options: readonly BuilderOption[]
): readonly BuilderOption[] {
  const existingStepIds = new Set(options.map((option) => option.stepId));
  const fallbackOptions = intentPlan.steps
    .filter(
      (step) =>
        step.kind === "missing_capability" && !existingStepIds.has(step.id)
    )
    .map((step) => generatedCodeOptionForMissingStep(ports, step));
  return [...options, ...fallbackOptions];
}

function generatedCodeOptionForMissingStep(
  ports: BuilderPorts,
  step: IntentPlan["steps"][number]
): BuilderOption {
  const optionId = `option-generated-code-${step.id}`;
  return {
    candidateIds: [`generated-code-${step.id}`],
    confidence: 0.55,
    id: optionId,
    patch: {
      id: ports.ids.next("patch"),
      ops: [
        {
          changes: {
            kind: "transform",
            label: `Custom code: ${step.label}`,
            status: "ready",
          },
          op: "update_step" as const,
          stepId: step.id,
        },
      ],
      summary: `Use custom code for ${step.label}`,
    },
    rationale:
      "Use a custom code step as the fallback when no native catalog node fully covers this requirement.",
    requiredInputs: step.requiredEntityIds,
    risk: "medium",
    stepId: step.id,
    strategy: "generated_code",
    title: `Custom code: ${step.label}`,
  };
}

export async function runPredictionEngine(
  ports: BuilderPorts,
  auth: BuilderAuthContext,
  sessionId: string,
  options: readonly BuilderOption[]
): Promise<ReadonlyMap<string, BuilderPatch>> {
  let result: {
    readonly durationMs: number;
    readonly model: string;
    readonly output: {
      readonly predictions: readonly {
        optionId: string;
        patch: BuilderPatch;
      }[];
    };
  };
  try {
    result = await ports.ai.run(
      {
        outputSchemaName:
          "{ predictions: { optionId: string, patch: BuilderPatch }[] }",
        templateName: "prediction-engine",
        templateVersion: "1.0.0",
        variables: { options: JSON.stringify(options) },
      },
      (output) =>
        zObject("prediction engine", output, (value) => ({
          predictions: predictionOutputSchema.parse(value.predictions),
        }))
    );
  } catch {
    result = {
      durationMs: 0,
      model: "prediction-engine-fallback",
      output: { predictions: buildFallbackPredictions(options) },
    };
  }
  const predictionOutput = result.output.predictions.some((prediction) =>
    prediction.patch.ops.some((op) => op.op === "add_step")
  )
    ? result.output.predictions
    : buildFallbackPredictions(options);
  const predictions = new Map(
    predictionOutput.map((prediction) => [
      prediction.optionId,
      prediction.patch,
    ])
  );
  await ports.events.emit(
    auth,
    createLifecycleEvent({
      actor: auth,
      createdAt: ports.clock.now(),
      durationMs: result.durationMs,
      id: ports.ids.next("event"),
      model: result.model,
      payload: { branchPredictionCount: predictions.size },
      phaseStatus: "completed",
      sessionId,
      stage: "prediction_engine",
      templateName: "prediction-engine",
      templateVersion: "1.0.0",
    })
  );
  return predictions;
}

function buildFallbackPredictions(
  options: readonly BuilderOption[]
): readonly { readonly optionId: string; readonly patch: BuilderPatch }[] {
  return options.map((option) => ({
    optionId: option.id,
    patch: {
      id: `prediction-${option.id}`,
      ops: [
        {
          op: "add_step" as const,
          step: {
            dependsOn: [option.stepId],
            id: `future-${option.id}`,
            kind: "notify" as const,
            label: `Future follow-up after ${option.title}`,
            requiredEntityIds: [],
            status: "planned" as const,
          },
        },
        {
          fromStepId: option.stepId,
          op: "add_edge" as const,
          toStepId: `future-${option.id}`,
        },
      ],
      summary: `Predict next step after ${option.title}`,
    },
  }));
}

const predictionOutputSchema = z
  .object({
    optionId: z.string().min(1),
    patch: builderPatchSchema,
  })
  .array();

function mergePatches(
  optionPatch: BuilderPatch,
  predictionPatch: BuilderPatch | undefined
): BuilderPatch {
  if (!predictionPatch) {
    return optionPatch;
  }
  return {
    id: `${optionPatch.id}+${predictionPatch.id}`,
    ops: [...optionPatch.ops, ...predictionPatch.ops],
    summary: `${optionPatch.summary}; ${predictionPatch.summary}`,
  };
}

function zObject<T>(
  label: string,
  output: unknown,
  parse: (value: Record<string, unknown>) => T
): T {
  if (!output || typeof output !== "object" || Array.isArray(output)) {
    throw new Error(`Invalid ${label} output`);
  }
  return parse(output as Record<string, unknown>);
}

function validateBuilderState(session: BuilderSession): ValidationResult {
  const committed = toWorkflowDraft(session, false);
  const issues =
    committed.nodes.length === 0
      ? [
          {
            code: "empty_workflow",
            message: "No committed workflow steps",
            severity: "error" as const,
          },
        ]
      : [];
  return { valid: issues.every((issue) => issue.severity !== "error"), issues };
}

function normalizedLabelIncludes(
  step: IntentPlan["steps"][number],
  term: string
) {
  return step.label.toLowerCase().includes(term.toLowerCase());
}

function branchEdgesForIntentPlan(plan: IntentPlan): BuilderPatch["ops"] {
  const conditionStep = plan.steps.find(
    (step) =>
      step.kind === "condition" &&
      (normalizedLabelIncludes(step, "0.10") ||
        normalizedLabelIncludes(step, "cached") ||
        normalizedLabelIncludes(step, "baseline") ||
        normalizedLabelIncludes(step, "delta") ||
        normalizedLabelIncludes(step, "moved"))
  );
  if (!conditionStep) {
    return [];
  }

  const notifyStep = plan.steps.find(
    (step) =>
      step.id !== conditionStep.id &&
      (step.kind === "notify" ||
        normalizedLabelIncludes(step, "telegram") ||
        normalizedLabelIncludes(step, "notify"))
  );
  const logStep = plan.steps.find(
    (step) =>
      step.id !== conditionStep.id &&
      (normalizedLabelIncludes(step, "log") ||
        normalizedLabelIncludes(step, "record"))
  );
  const edges: BuilderPatch["ops"] = [];
  if (notifyStep) {
    edges.push({
      fromStepId: conditionStep.id,
      op: "add_edge",
      sourceHandle: "true",
      toStepId: notifyStep.id,
    });
  }
  if (logStep) {
    edges.push({
      fromStepId: conditionStep.id,
      op: "add_edge",
      sourceHandle: "false",
      toStepId: logStep.id,
    });
  }
  return edges;
}

function workflowDraftEdgeKey(edge: WorkflowDraft["edges"][number]): string {
  return [
    edge.fromStepId,
    edge.sourceHandle ?? "",
    edge.toStepId,
    edge.targetHandle ?? "",
  ].join("->");
}

function workflowDraftStepLabelIncludes(
  step: WorkflowDraft["nodes"][number],
  term: string
): boolean {
  return step.label.toLowerCase().includes(term.toLowerCase());
}

function ensureWorkflowDraftSemanticEdges(draft: WorkflowDraft): WorkflowDraft {
  const edges = new Map(
    draft.edges.map((edge) => [workflowDraftEdgeKey(edge), edge])
  );
  const addEdge = (edge: WorkflowDraft["edges"][number]) => {
    edges.set(workflowDraftEdgeKey(edge), edge);
  };
  const hasIncomingEdge = (stepId: string) =>
    [...edges.values()].some((edge) => edge.toStepId === stepId);

  const triggerStep = draft.nodes.find((step) => step.kind === "trigger");
  const baselineStep = draft.nodes.find(
    (step) =>
      step.kind !== "condition" &&
      (workflowDraftStepLabelIncludes(step, "cache") ||
        workflowDraftStepLabelIncludes(step, "cached") ||
        workflowDraftStepLabelIncludes(step, "baseline") ||
        workflowDraftStepLabelIncludes(step, "fixed constant"))
  );
  const freshStep = draft.nodes.find(
    (step) =>
      step.kind !== "condition" &&
      (workflowDraftStepLabelIncludes(step, "fresh") ||
        workflowDraftStepLabelIncludes(step, "every 5 seconds") ||
        workflowDraftStepLabelIncludes(step, "30 seconds"))
  );
  const conditionStep = draft.nodes.find(
    (step) =>
      (workflowDraftStepLabelIncludes(step, "$0.10") ||
        workflowDraftStepLabelIncludes(step, "moved") ||
        workflowDraftStepLabelIncludes(step, "threshold") ||
        workflowDraftStepLabelIncludes(step, "whether")) &&
      (workflowDraftStepLabelIncludes(step, "cached") ||
        workflowDraftStepLabelIncludes(step, "baseline") ||
        workflowDraftStepLabelIncludes(step, "price"))
  );
  const telegramStep = draft.nodes.find(
    (step) =>
      step.id !== conditionStep?.id &&
      workflowDraftStepLabelIncludes(step, "telegram")
  );
  const logStep = draft.nodes.find(
    (step) =>
      step.id !== conditionStep?.id &&
      workflowDraftStepLabelIncludes(step, "log")
  );

  if (triggerStep && baselineStep && !hasIncomingEdge(baselineStep.id)) {
    addEdge({ fromStepId: triggerStep.id, toStepId: baselineStep.id });
  }
  if (freshStep && conditionStep && !hasIncomingEdge(conditionStep.id)) {
    addEdge({ fromStepId: freshStep.id, toStepId: conditionStep.id });
  }
  if (conditionStep && telegramStep && !hasIncomingEdge(telegramStep.id)) {
    addEdge({
      fromStepId: conditionStep.id,
      sourceHandle: "true",
      toStepId: telegramStep.id,
    });
  }
  if (conditionStep && logStep && !hasIncomingEdge(logStep.id)) {
    addEdge({
      fromStepId: conditionStep.id,
      sourceHandle: "false",
      toStepId: logStep.id,
    });
  }

  return { ...draft, edges: [...edges.values()] };
}

function notificationChannelForText(text: string): string | undefined {
  const normalized = text.toLowerCase();
  if (normalized.includes("telegram")) {
    return "telegram";
  }
  if (normalized.includes("slack")) {
    return "slack";
  }
  if (normalized.includes("email")) {
    return "email";
  }
  if (normalized.includes("discord")) {
    return "discord";
  }
  if (normalized.includes("webhook")) {
    return "webhook";
  }
  return undefined;
}

function isNotificationLikeStep(step: WorkflowDraft["nodes"][number]): boolean {
  const normalized = step.label.toLowerCase();
  return (
    step.kind === "notify" ||
    normalized.includes("notify") ||
    normalized.includes("notification") ||
    normalized.includes("alert") ||
    notificationChannelForText(step.label) !== undefined
  );
}

function isPreviewFutureStep(step: WorkflowDraft["nodes"][number]): boolean {
  return (
    step.id.startsWith("future-") ||
    step.label.toLowerCase().startsWith("future follow-up")
  );
}

function isPriceReadLikeStep(step: WorkflowDraft["nodes"][number]): boolean {
  const normalized = step.label.toLowerCase();
  return (
    step.kind === "read" &&
    (normalized.includes("price") ||
      normalized.includes("eth/usd") ||
      normalized.includes("oracle"))
  );
}

function patchWithoutDuplicateNotificationAdds(
  session: BuilderSession,
  patch: BuilderPatch
): BuilderPatch {
  const committedDraft = toWorkflowDraft(session, false);
  const committedNotifications = new Set(
    committedDraft.nodes
      .filter(isNotificationLikeStep)
      .map((step) => notificationChannelForText(step.label) ?? "generic")
  );
  const hasCommittedPriceRead = committedDraft.nodes.some(isPriceReadLikeStep);

  const removedStepIds = new Set<string>();
  const ops = patch.ops.filter((op) => {
    if (op.op === "add_step") {
      if (isPreviewFutureStep(op.step)) {
        removedStepIds.add(op.step.id);
        return false;
      }
      if (hasCommittedPriceRead && isPriceReadLikeStep(op.step)) {
        removedStepIds.add(op.step.id);
        return false;
      }
      const channel = notificationChannelForText(op.step.label) ?? "generic";
      if (
        isNotificationLikeStep(op.step) &&
        committedNotifications.has(channel)
      ) {
        removedStepIds.add(op.step.id);
        return false;
      }
    }
    if (
      op.op === "add_edge" &&
      (removedStepIds.has(op.fromStepId) || removedStepIds.has(op.toStepId))
    ) {
      return false;
    }
    return true;
  });

  return ops.length === patch.ops.length ? patch : { ...patch, ops };
}

function toWorkflowDraft(
  session: BuilderSession,
  includePreview: boolean
): WorkflowDraft {
  const committedSteps = new Map<string, WorkflowDraft["nodes"][number]>();
  const edges = new Map<string, WorkflowDraft["edges"][number]>();
  const upsertStepEdges = (step: WorkflowDraft["nodes"][number]) => {
    for (const dependencyId of step.dependsOn) {
      const edge = { fromStepId: dependencyId, toStepId: step.id };
      edges.set(workflowDraftEdgeKey(edge), edge);
    }
  };
  const removeStepEdges = (stepId: string) => {
    for (const [edgeId, edge] of edges) {
      if (edge.fromStepId === stepId || edge.toStepId === stepId) {
        edges.delete(edgeId);
      }
    }
  };
  for (const commit of pathToHead(session.dag)) {
    for (const op of commit.patch.ops) {
      if (op.op === "add_step") {
        committedSteps.set(op.step.id, op.step);
        upsertStepEdges(op.step);
      }
      if (op.op === "update_step") {
        const current = committedSteps.get(op.stepId);
        if (current) {
          const next = { ...current, ...op.changes };
          committedSteps.set(op.stepId, next);
          if (op.changes.dependsOn) {
            for (const [edgeId, edge] of edges) {
              if (edge.toStepId === op.stepId) {
                edges.delete(edgeId);
              }
            }
          }
          upsertStepEdges(next);
        }
      }
      if (op.op === "remove_step") {
        committedSteps.delete(op.stepId);
        removeStepEdges(op.stepId);
      }
      if (op.op === "add_edge")
        edges.set(workflowDraftEdgeKey(op), {
          fromStepId: op.fromStepId,
          sourceHandle: op.sourceHandle,
          targetHandle: op.targetHandle,
          toStepId: op.toStepId,
        });
    }
  }
  if (includePreview) {
    for (const branch of session.dag.branches.filter(
      (candidate) => candidate.status === "open"
    )) {
      for (const op of branch.patch.ops) {
        if (op.op === "add_step") committedSteps.set(op.step.id, op.step);
      }
    }
  }
  const draft = {
    id: session.id,
    nodes: [...committedSteps.values()],
    edges: [...edges.values()],
  };
  return ensureWorkflowDraftSemanticEdges(draft);
}

function projectSession(session: BuilderSession): BuilderProjection {
  const candidateBranches = session.dag.branches.map((branch) => ({
    branchId: branch.id,
    optionId: branch.metadata.optionId,
    baseCommitId: branch.baseCommitId,
    status: branch.status,
    greyNodes: branch.patch.ops.flatMap((op) =>
      op.op === "add_step" ? [op.step] : []
    ),
    dashedEdges: branch.patch.ops.flatMap((op) =>
      op.op === "add_edge"
        ? [
            {
              fromStepId: op.fromStepId,
              sourceHandle: op.sourceHandle,
              targetHandle: op.targetHandle,
              toStepId: op.toStepId,
            },
          ]
        : []
    ),
  }));
  return builderProjectionSchema.parse({
    sessionId: session.id,
    headCommitId: session.dag.headCommitId,
    committed: toWorkflowDraft(session, false),
    candidateBranches,
    options: session.options,
    questions: session.questions,
    timeline: orderedTimeline(session.dag).map((item) => ({
      id: item.id,
      kind: item.kind,
      label: item.id,
      createdAt: item.createdAt,
    })),
    validation: validateBuilderState(session),
  });
}

async function requireSession(
  ports: BuilderPorts,
  auth: BuilderAuthContext,
  sessionId: string
): Promise<BuilderSession> {
  const session = await ports.store.getSession(auth, sessionId);
  if (!session) throw new Error(`Unknown builder session: ${sessionId}`);
  return session;
}

async function saveAndProject(
  ports: BuilderPorts,
  auth: BuilderAuthContext,
  session: BuilderSession
): Promise<BuilderProjection> {
  const parsed = builderSessionSchema.parse(session);
  await ports.store.saveSession(auth, parsed);
  return projectSession(parsed);
}

async function getProjection(
  ports: BuilderPorts,
  auth: BuilderAuthContext,
  sessionId: string
): Promise<BuilderProjection> {
  return projectSession(await requireSession(ports, auth, sessionId));
}

async function selectOption(
  ports: BuilderPorts,
  auth: BuilderAuthContext,
  sessionId: string,
  optionId: string,
  expectedRevision?: number
): Promise<BuilderProjection> {
  const session = await requireSession(ports, auth, sessionId);
  const option = session.options.find((candidate) => candidate.id === optionId);
  if (!option) throw new Error(`Unknown option: ${optionId}`);
  const now = ports.clock.now();
  let dag = selectOptionPatch(
    session,
    option,
    ports.ids.next("commit"),
    now,
    expectedRevision
  );
  for (const branch of dag.branches) {
    const branchOption = session.options.find(
      (candidate) => candidate.id === branch.metadata.optionId
    );
    if (
      branch.status === "open" &&
      branchOption &&
      areCompetingOptions(option, branchOption)
    ) {
      dag = markBranchStale(dag, branch.id, now, "option_selected");
    }
  }
  dag = rebaseActionableBranchesToHead(dag, now);
  const event = createAuditEvent({
    id: ports.ids.next("event"),
    sessionId,
    actor: auth,
    stage: "option.select",
    outcome: "accepted",
    targetId: optionId,
    createdAt: now,
    payload: {
      candidateIds: option.candidateIds,
      decisionGroupId: option.decisionGroupId ?? "",
      requirementIds: option.requirementIds ?? [],
      title: option.title,
    },
  });
  await ports.events.emit(auth, event);
  return saveAndProject(ports, auth, {
    ...session,
    dag,
    events: [...session.events, event],
    updatedAt: now,
  });
}

function rebaseActionableBranchesToHead(
  dag: BuilderSession["dag"],
  updatedAt: string
): BuilderSession["dag"] {
  const headCommitId = dag.headCommitId;
  if (!headCommitId) {
    return dag;
  }
  let changed = false;
  const branches = dag.branches.map((branch) => {
    if (branch.status !== "open" || branch.baseCommitId === headCommitId) {
      return branch;
    }
    changed = true;
    return { ...branch, baseCommitId: headCommitId, updatedAt };
  });
  return changed ? { ...dag, branches, revision: dag.revision + 1 } : dag;
}

function selectOptionPatch(
  session: BuilderSession,
  option: BuilderOption,
  commitId: string,
  selectedAt: string,
  expectedRevision?: number
): BuilderSession["dag"] {
  if (
    expectedRevision !== undefined &&
    session.dag.revision !== expectedRevision
  ) {
    throw new Error(
      `Revision conflict: expected ${expectedRevision}, got ${session.dag.revision}`
    );
  }
  const branch = requireBranch(session.dag, option.id);
  if (branch.status !== "open") {
    throw new Error(`Branch is terminal: ${branch.id}`);
  }
  if (session.dag.headCommitId !== branch.baseCommitId) {
    throw new Error(`Stale branch base: ${branch.baseCommitId}`);
  }

  const withCommit = appendCommit(session.dag, {
    id: commitId,
    parentIds: [branch.baseCommitId],
    patch: patchWithoutDuplicateNotificationAdds(session, option.patch),
    createdAt: selectedAt,
    metadata: { branchId: branch.id },
  });

  return {
    ...withCommit,
    branches: withCommit.branches.map((candidate) =>
      candidate.id === branch.id
        ? {
            ...candidate,
            status: "selected" as const,
            updatedAt: selectedAt,
            selectedCommitId: commitId,
          }
        : candidate
    ),
    revision: withCommit.revision + 1,
  };
}

function areCompetingOptions(
  selected: BuilderOption,
  candidate: BuilderOption
): boolean {
  if (selected.id === candidate.id) {
    return true;
  }
  if (
    selected.relationship &&
    candidate.relationship &&
    ["complementary", "required_bundle"].includes(selected.relationship) &&
    ["complementary", "required_bundle"].includes(candidate.relationship)
  ) {
    return false;
  }
  const selectedRequirementIds = new Set(selected.requirementIds ?? []);
  const sharesRequirement =
    selectedRequirementIds.size > 0 &&
    (candidate.requirementIds ?? []).some((id) =>
      selectedRequirementIds.has(id)
    );
  const sharesDecisionGroup =
    Boolean(selected.decisionGroupId) &&
    selected.decisionGroupId === candidate.decisionGroupId;

  return sharesRequirement || sharesDecisionGroup;
}

async function rejectOption(
  ports: BuilderPorts,
  auth: BuilderAuthContext,
  sessionId: string,
  optionId: string
): Promise<BuilderProjection> {
  const session = await requireSession(ports, auth, sessionId);
  const now = ports.clock.now();
  const event = createAuditEvent({
    id: ports.ids.next("event"),
    sessionId,
    actor: auth,
    stage: "option.reject",
    outcome: "rejected",
    targetId: optionId,
    createdAt: now,
  });
  await ports.events.emit(auth, event);
  return saveAndProject(ports, auth, {
    ...session,
    dag: rejectBranch(session.dag, optionId, now, "user_rejected"),
    events: [...session.events, event],
    updatedAt: now,
  });
}

async function answerQuestion(
  ports: BuilderPorts,
  auth: BuilderAuthContext,
  sessionId: string,
  input: AnswerQuestionInput
): Promise<BuilderProjection> {
  const answer = answerQuestionInputSchema.parse(input);
  const session = await requireSession(ports, auth, sessionId);
  const now = ports.clock.now();
  const event = createAuditEvent({
    id: ports.ids.next("event"),
    sessionId,
    actor: auth,
    stage: "question.answer",
    outcome: "accepted",
    targetId: answer.questionId,
    createdAt: now,
    payload: {
      answerType: Array.isArray(answer.answer) ? "multi_value" : "text",
      questionId: answer.questionId,
    },
  });
  await ports.events.emit(auth, event);
  const isConditionClarification = answer.questionId.startsWith(
    "question-condition-criteria-"
  );
  if (
    answer.questionId === "question-candidate-clarification" ||
    answer.questionId === "question-notification-channel" ||
    answer.questionId === "question-webhook-url" ||
    isConditionClarification
  ) {
    const isCandidateClarification =
      answer.questionId === "question-candidate-clarification";
    const clarificationLabel = isCandidateClarification
      ? "Clarification"
      : isConditionClarification
        ? "Condition clarification"
        : answer.questionId === "question-webhook-url"
          ? "Webhook URL"
          : "Notification channel";
    const answerText = Array.isArray(answer.answer)
      ? answer.answer.join(", ")
      : answer.answer;
    const latestInput = session.turns.at(-1)?.input ?? session.prompt;
    const clarifiedPrompt = `${latestInput}\n\n${clarificationLabel}: ${answerText}`;
    const plan = await runIntentPlanner(
      ports,
      auth,
      sessionId,
      clarifiedPrompt
    );
    const intentResolution = resolveIntentConstraints(plan);
    const requirementEvent = createLifecycleEvent({
      actor: auth,
      createdAt: ports.clock.now(),
      id: ports.ids.next("event"),
      model: "builder-runtime",
      payload: jsonPayload({
        dynamicRequirements: (intentResolution.dynamicRequirements ?? []).map(
          (requirement) => ({
            id: requirement.id,
            key: requirement.key,
            kind: requirement.requirementKind,
            status: requirement.status,
            value: requirement.value,
          })
        ),
        intentIR: intentResolution.intentIR,
        requirements: intentResolution.requirements.map((requirement) => ({
          appliesTo: requirement.appliesTo,
          id: requirement.id,
          status: requirement.status,
          type: requirement.type,
          value: requirement.value,
        })),
      }),
      phaseStatus: "completed",
      sessionId,
      stage: "requirement_resolution",
    });
    await ports.events.emit(auth, requirementEvent);
    const candidates = await runCatalogSearch(ports, auth, sessionId, plan);
    const evaluationRun = await runCatalogCandidateEvaluation(
      ports,
      intentResolution,
      candidates
    );
    const evaluatedCandidates = evaluationRun.output;
    const evaluationEvent = createLifecycleEvent({
      actor: auth,
      createdAt: ports.clock.now(),
      id: ports.ids.next("event"),
      durationMs: evaluationRun.durationMs,
      model: evaluationRun.model,
      payload: {
        acceptedCount: evaluatedCandidates.accepted.length,
        decisionGroupCount: evaluatedCandidates.decisionGroups.length,
        dynamicRequirementCount: evaluatedCandidates.dynamicRequirements.length,
        rejectedCount: evaluatedCandidates.rejected.length,
        rejectionReasons: evaluatedCandidates.evidence
          .filter((item) => item.status === "rejected")
          .slice(0, 8)
          .map((item) => ({
            candidateId: item.candidateId,
            reasons: item.reasons.slice(0, 3),
          })),
      },
      phaseStatus: "completed",
      sessionId,
      stage: "candidate_evaluation",
      templateName: "candidate-evaluator",
      templateVersion: "1.0.0",
    });
    const validationCompatibilityEvent = {
      ...evaluationEvent,
      id: ports.ids.next("event"),
      stage: "candidate_validation",
    };
    await ports.events.emit(auth, evaluationEvent);
    await ports.events.emit(auth, validationCompatibilityEvent);
    const rankedCandidates = await runCatalogRanker(
      ports,
      auth,
      sessionId,
      evaluatedCandidates.accepted
    );
    const generatedOptions = withGeneratedFallbackOptions(
      ports,
      plan,
      await runOptionGenerator(
        ports,
        auth,
        sessionId,
        plan,
        rankedCandidates,
        evaluatedCandidates.evidence
      )
    );
    const existingBranchIds = new Set(
      session.dag.branches.map((branch) => branch.id)
    );
    const options = generatedOptions.map((option) =>
      existingBranchIds.has(option.id)
        ? { ...option, id: `${option.id}-${ports.ids.next("option")}` }
        : option
    );
    const predictions = await runPredictionEngine(
      ports,
      auth,
      sessionId,
      options
    );
    let dag = session.dag;
    for (const branch of session.dag.branches) {
      if (branch.status === "open") {
        dag = markBranchStale(dag, branch.id, now, "question_answered");
      }
    }
    dag = appendCommit(dag, {
      createdAt: now,
      id: ports.ids.next("commit"),
      metadata: { event: "question.clarified" },
      parentIds: session.dag.headCommitId ? [session.dag.headCommitId] : [],
      patch: {
        id: ports.ids.next("patch"),
        ops: [
          ...toWorkflowDraft(session, false).nodes.map((step) => ({
            op: "remove_step" as const,
            stepId: step.id,
          })),
          ...plan.steps.map((step) => ({ op: "add_step" as const, step })),
        ],
        summary: "Clarified intent plan",
      },
    });
    for (const option of options) {
      dag = createBranch(dag, {
        baseCommitId: dag.headCommitId ?? "",
        createdAt: now,
        id: option.id,
        metadata: {
          label: option.title,
          optionId: option.id,
          previewKind: "grey_future_branch",
          risk: option.risk,
        },
        patch: mergePatches(option.patch, predictions.get(option.id)),
      });
    }
    const questionIds = buildQuestionIds(intentResolution, options.length);
    const nextQuestionIds = new Set(questionIds);
    const answeredQuestions = session.questions.map((question) =>
      question.id === answer.questionId
        ? { ...question, answer: answer.answer, status: "answered" as const }
        : question
    );
    const questions = [
      ...answeredQuestions.filter(
        (question) =>
          !nextQuestionIds.has(question.id) &&
          (!isCandidateClarification ||
            question.id !== "question-notification-channel")
      ),
      ...buildInlineQuestions(questionIds, plan, intentResolution, candidates),
    ];
    return saveAndProject(ports, auth, {
      ...session,
      catalogCandidates: [...rankedCandidates],
      dag,
      events: [
        ...session.events,
        event,
        requirementEvent,
        evaluationEvent,
        validationCompatibilityEvent,
      ],
      options: [...options],
      questions,
      turns: [
        ...session.turns,
        {
          createdAt: now,
          id: ports.ids.next("turn"),
          input: clarifiedPrompt,
          intentPlan: plan,
          sessionId,
        },
      ],
      updatedAt: now,
    });
  }
  return saveAndProject(ports, auth, {
    ...session,
    questions: session.questions.map((question) =>
      question.id === answer.questionId
        ? { ...question, answer: answer.answer, status: "answered" }
        : question
    ),
    events: [...session.events, event],
    updatedAt: now,
  });
}

async function regenerateFromNode(
  ports: BuilderPorts,
  auth: BuilderAuthContext,
  sessionId: string,
  input: RegenerateInput
): Promise<BuilderProjection> {
  const regenerate = regenerateInputSchema.parse(input);
  const session = await requireSession(ports, auth, sessionId);
  const now = ports.clock.now();
  const commitId =
    regenerate.kind === "from_commit"
      ? regenerate.commitId
      : findCommitIdForNode(session, regenerate.nodeId);
  if (!commitId) throw new Error("Cannot regenerate without a commit");
  let dag = abandonDownstreamBranches(
    session.dag,
    commitId,
    now,
    `regenerate_${regenerate.kind}`
  );
  dag = createBranch(dag, {
    baseCommitId: commitId,
    createdAt: now,
    id: ports.ids.next("option-regenerated"),
    metadata: {
      label: "Regenerated downstream option",
      optionId: "regenerated-downstream",
      previewKind: "grey_future_branch",
      risk: "medium",
    },
    patch: {
      id: ports.ids.next("patch"),
      ops: buildRegeneratedOps(session, regenerate, ports),
      summary: `Regenerate downstream branch from ${regenerate.kind}`,
    },
  });
  const event = createAuditEvent({
    id: ports.ids.next("event"),
    sessionId,
    actor: auth,
    stage: "subtree.regenerate",
    outcome: "accepted",
    targetId: commitId,
    createdAt: now,
  });
  await ports.events.emit(auth, event);
  return saveAndProject(ports, auth, {
    ...session,
    dag,
    events: [...session.events, event],
    updatedAt: now,
  });
}

async function requestNativeCapability(
  ports: BuilderPorts,
  auth: BuilderAuthContext,
  sessionId: string,
  missingCapability: MissingCapability
): Promise<BuilderProjection> {
  const session = await requireSession(ports, auth, sessionId);
  const request = await ports.featureRequests.create(
    auth,
    sessionId,
    missingCapability
  );
  const now = ports.clock.now();
  const event = createAuditEvent({
    id: ports.ids.next("event"),
    sessionId,
    actor: auth,
    stage: "feature_request.create",
    outcome: "requested",
    targetId: request.id,
    createdAt: now,
  });
  await ports.events.emit(auth, event);
  return saveAndProject(ports, auth, {
    ...session,
    featureRequests: [...session.featureRequests, request.id],
    events: [...session.events, event],
    updatedAt: now,
  });
}

async function materializeWorkflow(
  ports: BuilderPorts,
  auth: BuilderAuthContext,
  sessionId: string,
  input: MaterializeWorkflowInput
): Promise<BuilderProjection> {
  const materialize = materializeWorkflowInputSchema.parse(input);
  const session = await requireSession(ports, auth, sessionId);
  if (
    session.dag.commits.some(
      (commit) => commit.idempotencyKey === materialize.idempotencyKey
    )
  ) {
    return projectSession(session);
  }
  const validation = validateBuilderState(session);
  if (!validation.valid)
    throw new Error("Cannot materialize invalid builder state");
  const now = ports.clock.now();
  const materialized = await ports.workflowMaterializer.materialize({
    auth,
    expectedRevision:
      materialize.mode === "update" ? materialize.expectedRevision : undefined,
    idempotencyKey: materialize.idempotencyKey,
    mode: materialize.mode,
    name: materialize.mode === "create" ? materialize.name : undefined,
    overwritePolicy:
      materialize.mode === "update" ? materialize.overwritePolicy : undefined,
    projection: projectSession(session),
    session,
    workflowId:
      materialize.mode === "update" ? materialize.workflowId : undefined,
  });
  const workflowId = materialized.workflowId;
  const patch: BuilderPatch = {
    id: ports.ids.next("patch"),
    summary: "Workflow materialized",
    ops: [{ op: "materialized", workflowId, mode: materialize.mode }],
  };
  const dag = appendCommit(session.dag, {
    id: ports.ids.next("commit"),
    parentIds: session.dag.headCommitId ? [session.dag.headCommitId] : [],
    patch,
    createdAt: now,
    idempotencyKey: materialize.idempotencyKey,
    metadata: { event: "workflow.materialized" },
  });
  const event = createAuditEvent({
    id: ports.ids.next("event"),
    sessionId,
    actor: auth,
    stage: "workflow.materialize",
    outcome: "materialized",
    targetId: workflowId,
    createdAt: now,
    payload: { mode: materialize.mode },
  });
  await ports.events.emit(auth, event);
  return saveAndProject(ports, auth, {
    ...session,
    status: "materialized",
    dag,
    events: [...session.events, event],
    updatedAt: now,
  });
}

function findCommitIdForNode(
  session: BuilderSession,
  nodeId: string
): string | undefined {
  return [...session.dag.commits]
    .reverse()
    .find((commit) =>
      commit.patch.ops.some((op) =>
        op.op === "add_step"
          ? op.step.id === nodeId
          : op.op === "update_step" || op.op === "remove_step"
            ? op.stepId === nodeId
            : false
      )
    )?.id;
}

function regeneratedStepLabel(input: RegenerateInput): string {
  if (input.kind === "from_commit") {
    return `Regenerated downstream plan from commit ${input.commitId}`;
  }
  if (input.kind === "replace_node") {
    return `Replacement plan for ${input.nodeId}`;
  }
  return `Next-step plan after ${input.nodeId}`;
}

function buildRegeneratedOps(
  session: BuilderSession,
  input: RegenerateInput,
  ports: BuilderPorts
): BuilderPatch["ops"] {
  if (input.kind === "from_commit") {
    return [
      {
        op: "add_step",
        step: {
          dependsOn: [],
          id: ports.ids.next("step-regenerated"),
          kind: "transform",
          label: regeneratedStepLabel(input),
          requiredEntityIds: [],
          status: "planned",
        },
      },
    ];
  }

  const draft = toWorkflowDraft(session, false);
  const target = draft.nodes.find((node) => node.id === input.nodeId);
  if (!target) {
    throw new Error(`Cannot regenerate unknown node: ${input.nodeId}`);
  }
  const downstreamIds = new Set<string>();
  let changed = true;
  while (changed) {
    changed = false;
    for (const node of draft.nodes) {
      if (downstreamIds.has(node.id) || node.id === input.nodeId) {
        continue;
      }
      if (
        node.dependsOn.includes(input.nodeId) ||
        node.dependsOn.some((dependencyId) => downstreamIds.has(dependencyId))
      ) {
        downstreamIds.add(node.id);
        changed = true;
      }
    }
  }
  const selectedNodes = draft.nodes.filter((node) =>
    input.kind === "replace_node"
      ? node.id === input.nodeId || downstreamIds.has(node.id)
      : downstreamIds.has(node.id)
  );
  const nodesToRebuild = selectedNodes.length > 0 ? selectedNodes : [target];
  return nodesToRebuild.map((node) => ({
    op: "add_step" as const,
    step: {
      ...node,
      id: ports.ids.next(`regen-${node.id}`),
      label: `${regeneratedStepLabel(input)}: ${node.label}`,
      status: "planned" as const,
    },
  }));
}

async function cancelSession(
  ports: BuilderPorts,
  auth: BuilderAuthContext,
  sessionId: string
): Promise<BuilderProjection> {
  const session = await requireSession(ports, auth, sessionId);
  const now = ports.clock.now();
  const event = createAuditEvent({
    actor: auth,
    createdAt: now,
    id: ports.ids.next("event"),
    outcome: "rejected",
    sessionId,
    stage: "session.cancel",
    targetId: sessionId,
  });
  await ports.events.emit(auth, event);
  return saveAndProject(ports, auth, {
    ...session,
    events: [...session.events, event],
    status: "cancelled",
    updatedAt: now,
  });
}
