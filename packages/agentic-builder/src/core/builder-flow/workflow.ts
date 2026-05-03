import {
  createBranch,
  markBranchStale,
  rejectBranch,
  requireBranch,
} from "@keeperhub/builder-dag/branch";
import {
  appendCommit,
  createDagSession,
} from "@keeperhub/builder-dag/commit-graph";
import { abandonDownstreamBranches } from "@keeperhub/builder-dag/fork";
import {
  done,
  harness,
  type StepContext,
  type StepState,
  step,
} from "@keeperhub/intent-sdk";
import {
  createAuditEvent,
  createLifecycleEvent,
} from "../events/builder-events";
import type { BuilderPorts } from "../ports/all";
import { runCatalogCandidateEvaluation } from "../services/candidate-evaluation";
import {
  normalizeIntentPlanForIntentIR,
  resolveIntentConstraints,
} from "../services/intent-resolution";
import { runBuilderActionHarness } from "./actions";
import {
  branchEdgesForIntentPlan,
  mergeBuilderPatches,
  patchWithoutDuplicateNotificationAdds,
  projectSession,
  runPredictionEngine,
  toWorkflowDraft,
  validateBuilderState,
} from "./artifact";
import {
  formatCandidateEvaluationCounts,
  formatCapabilityCount,
  runCatalogRanker,
  runCatalogSearch,
  runOptionGenerator,
  withGeneratedFallbackOptions,
} from "./capabilities";
import {
  builderProgressStages,
  buildInlineQuestions,
  buildQuestionIds,
} from "./domain";
import { type BuilderProgressReporter, reportBuilderProgress } from "./runner";
import { builderActionStepIds, builderStartStepIds } from "./steps";

export { inferCandidateCapability } from "../services/candidate-validation";
export { resolveIntentConstraints } from "../services/intent-resolution";

import {
  type AnswerQuestionInput,
  answerQuestionInputSchema,
  type BuilderAuthContext,
  type BuilderOption,
  type BuilderPatch,
  type BuilderProjection,
  type BuilderSession,
  builderProjectionSchema,
  builderSessionSchema,
  type CatalogCandidate,
  type CatalogEvaluationResult,
  entitySchema,
  type IntentPlan,
  type IntentResolution,
  type IntentStep,
  intentPlanSchema,
  type MaterializeWorkflowInput,
  type MissingCapability,
  materializeWorkflowInputSchema,
  type RegenerateInput,
  regenerateInputSchema,
} from "../schemas/all";

export type BuilderFlow = ReturnType<typeof createBuilderFlow>;

export type { BuilderProgressEvent } from "./runner";

type BuilderStartInput = {
  readonly context?: string;
  readonly prompt: string;
};

type BuilderStartUse = {
  readonly auth: BuilderAuthContext;
  readonly onProgress: BuilderProgressReporter;
  readonly ports: BuilderPorts;
  readonly sessionId: string;
  readonly startedAt: string;
};

type BuilderStartState = StepState & {
  candidates?: readonly CatalogCandidate[];
  evaluatedCandidates?: CatalogEvaluationResult;
  evaluationEvent?: BuilderSession["events"][number];
  evaluationRun?: Awaited<ReturnType<typeof runCatalogCandidateEvaluation>>;
  intentResolution?: IntentResolution;
  options?: readonly BuilderOption[];
  plan?: IntentPlan;
  projection?: BuilderProjection;
  rankedCandidates?: readonly CatalogCandidate[];
  requirementEvent?: BuilderSession["events"][number];
  validationCompatibilityEvent?: BuilderSession["events"][number];
};

type BuilderStartStepContext = StepContext<BuilderStartUse, BuilderStartInput>;

function jsonPayload<T>(payload: T): T {
  return JSON.parse(JSON.stringify(payload)) as T;
}

export function createBuilderFlow(ports: BuilderPorts) {
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
      runBuilderActionHarness({
        execute: () => getProjection(ports, auth, sessionId),
        runId: sessionId,
        store: ports.diagnostics?.harnessStoreFor?.<Record<string, never>>(
          auth,
          sessionId
        ),
        stepId: builderActionStepIds.projectionGet,
        type: "builder.projection.get",
      }),
    getEvents: (auth: BuilderAuthContext, sessionId: string) =>
      runBuilderActionHarness({
        execute: () => ports.store.listEvents(auth, sessionId),
        runId: sessionId,
        store: ports.diagnostics?.harnessStoreFor?.<Record<string, never>>(
          auth,
          sessionId
        ),
        stepId: builderActionStepIds.eventsList,
        type: "builder.events.list",
      }),
    selectOption: (
      auth: BuilderAuthContext,
      sessionId: string,
      optionId: string,
      expectedRevision?: number
    ) =>
      runBuilderActionHarness({
        detail: { expectedRevision, optionId },
        execute: () =>
          selectOption(ports, auth, sessionId, optionId, expectedRevision),
        runId: sessionId,
        store: ports.diagnostics?.harnessStoreFor?.<Record<string, never>>(
          auth,
          sessionId
        ),
        stepId: builderActionStepIds.optionSelect,
        type: "builder.option.select",
      }),
    rejectOption: (
      auth: BuilderAuthContext,
      sessionId: string,
      optionId: string
    ) =>
      runBuilderActionHarness({
        detail: { optionId },
        execute: () => rejectOption(ports, auth, sessionId, optionId),
        runId: sessionId,
        store: ports.diagnostics?.harnessStoreFor?.<Record<string, never>>(
          auth,
          sessionId
        ),
        stepId: builderActionStepIds.optionReject,
        type: "builder.option.reject",
      }),
    answerQuestion: (
      auth: BuilderAuthContext,
      sessionId: string,
      input: AnswerQuestionInput
    ) =>
      runBuilderActionHarness({
        detail: { questionId: input.questionId },
        execute: () => answerQuestion(ports, auth, sessionId, input),
        runId: sessionId,
        store: ports.diagnostics?.harnessStoreFor?.<Record<string, never>>(
          auth,
          sessionId
        ),
        stepId: builderActionStepIds.questionAnswer,
        type: "builder.question.answer",
      }),
    regenerateFromNode: (
      auth: BuilderAuthContext,
      sessionId: string,
      input: RegenerateInput
    ) =>
      runBuilderActionHarness({
        detail: input,
        execute: () => regenerateFromNode(ports, auth, sessionId, input),
        runId: sessionId,
        store: ports.diagnostics?.harnessStoreFor?.<Record<string, never>>(
          auth,
          sessionId
        ),
        stepId: builderActionStepIds.nodeRegenerate,
        type: "builder.node.regenerate",
      }),
    requestNativeCapability: (
      auth: BuilderAuthContext,
      sessionId: string,
      missingCapability: MissingCapability
    ) =>
      runBuilderActionHarness({
        detail: { missingCapabilityId: missingCapability.id },
        execute: () =>
          requestNativeCapability(ports, auth, sessionId, missingCapability),
        runId: sessionId,
        store: ports.diagnostics?.harnessStoreFor?.<Record<string, never>>(
          auth,
          sessionId
        ),
        stepId: builderActionStepIds.nativeCapabilityRequest,
        type: "builder.capability.request",
      }),
    materializeWorkflow: (
      auth: BuilderAuthContext,
      sessionId: string,
      input: MaterializeWorkflowInput
    ) =>
      runBuilderActionHarness({
        detail: { mode: input.mode },
        execute: () => materializeWorkflow(ports, auth, sessionId, input),
        runId: sessionId,
        store: ports.diagnostics?.harnessStoreFor?.<Record<string, never>>(
          auth,
          sessionId
        ),
        stepId: builderActionStepIds.workflowMaterialize,
        type: "builder.workflow.materialize",
      }),
    cancelSession: (auth: BuilderAuthContext, sessionId: string) =>
      runBuilderActionHarness({
        execute: () => cancelSession(ports, auth, sessionId),
        runId: sessionId,
        store: ports.diagnostics?.harnessStoreFor?.<Record<string, never>>(
          auth,
          sessionId
        ),
        stepId: builderActionStepIds.sessionCancel,
        type: "builder.session.cancel",
      }),
  };
}

async function startSession(
  ports: BuilderPorts,
  auth: BuilderAuthContext,
  prompt: string,
  context?: string,
  onProgress: BuilderProgressReporter = () => undefined
): Promise<BuilderProjection> {
  const now = ports.clock.now();
  const sessionId = ports.ids.next("builder_session");
  const workflow = harness<BuilderStartUse, BuilderStartInput>({
    id: "agentic-builder.start-session",
    steps: [
      step(builderStartStepIds.intentPlanner, runIntentPlannerStep),
      step(
        builderStartStepIds.requirementResolution,
        runRequirementResolutionStep
      ),
      step(builderStartStepIds.catalogSearch, runCatalogSearchStep),
      step(builderStartStepIds.candidateEvaluation, runCandidateEvaluationStep),
      step(builderStartStepIds.candidateRanking, runCandidateRankingStep),
      step(builderStartStepIds.optionGeneration, runOptionGenerationStep),
      step(builderStartStepIds.previewProjection, runPreviewProjectionStep),
    ],
    use: {
      auth,
      onProgress,
      ports,
      sessionId,
      startedAt: now,
    },
  });

  const result = await workflow.start(
    { context, prompt },
    {
      runId: sessionId,
      store: ports.diagnostics?.harnessStoreFor?.<BuilderStartInput>(
        auth,
        sessionId
      ),
    }
  );
  const projection = result.state.projection;
  if (!projection) {
    throw new Error("Agentic builder session did not produce a projection");
  }
  return builderProjectionSchema.parse(projection);
}

function builderState(state: StepState): BuilderStartState {
  return state as BuilderStartState;
}

async function runIntentPlannerStep({
  emit,
  input,
  state,
  use,
}: BuilderStartStepContext) {
  const stage = builderProgressStages.intentPlanner;
  await reportBuilderProgress(use.onProgress, {
    label: stage.runningLabel,
    stage: stage.stage,
    status: "running",
  });
  const plan = normalizeIntentPlanForIntentIR(
    await runIntentPlanner(
      use.ports,
      use.auth,
      use.sessionId,
      input.prompt,
      input.context
    )
  );
  emit({
    detail: { stepCount: plan.steps.length },
    message: "Resolved the initial intent plan.",
    type: "builder.intent_planner.completed",
  });
  await reportBuilderProgress(use.onProgress, {
    detail: `${plan.steps.length} planned step${plan.steps.length === 1 ? "" : "s"}`,
    label: stage.completedLabel,
    stage: stage.stage,
    status: "completed",
  });
  return done({ ...builderState(state), plan });
}

async function runRequirementResolutionStep({
  emit,
  state,
  use,
}: BuilderStartStepContext) {
  const stage = builderProgressStages.requirementResolution;
  const current = builderState(state);
  const plan = requireBuilderState(current.plan, "plan");
  await reportBuilderProgress(use.onProgress, {
    label: stage.runningLabel,
    stage: stage.stage,
    status: "running",
  });
  const intentResolution = resolveIntentConstraints(plan);
  const requirementEvent = createLifecycleEvent({
    actor: use.auth,
    createdAt: use.ports.clock.now(),
    id: use.ports.ids.next("event"),
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
    sessionId: use.sessionId,
    stage: "requirement_resolution",
  });
  await use.ports.events.emit(use.auth, requirementEvent);
  emit({
    detail: { requirementCount: intentResolution.requirements.length },
    message: "Evaluated requirement coverage.",
    type: "builder.requirement_resolution.completed",
  });
  await reportBuilderProgress(use.onProgress, {
    detail: `${intentResolution.requirements.length} requirement${intentResolution.requirements.length === 1 ? "" : "s"} evaluated`,
    label: stage.completedLabel,
    stage: stage.stage,
    status: "completed",
  });
  return done({ ...current, intentResolution, requirementEvent });
}

async function runCatalogSearchStep({
  emit,
  state,
  use,
}: BuilderStartStepContext) {
  const stage = builderProgressStages.catalogSearch;
  const current = builderState(state);
  const plan = requireBuilderState(current.plan, "plan");
  await reportBuilderProgress(use.onProgress, {
    label: stage.runningLabel,
    stage: stage.stage,
    status: "running",
  });
  const candidates = await runCatalogSearch(
    use.ports,
    use.auth,
    use.sessionId,
    plan
  );
  emit({
    detail: { candidateCount: candidates.length },
    message: "Found matching node candidates.",
    type: "builder.catalog_search.completed",
  });
  await reportBuilderProgress(use.onProgress, {
    detail: `${formatCapabilityCount(candidates.length, "candidate")} found`,
    label: stage.completedLabel,
    stage: stage.stage,
    status: "completed",
  });
  return done({ ...current, candidates });
}

async function runCandidateEvaluationStep({
  emit,
  state,
  use,
}: BuilderStartStepContext) {
  const stage = builderProgressStages.candidateEvaluation;
  const current = builderState(state);
  const candidates = requireBuilderState(current.candidates, "candidates");
  const intentResolution = requireBuilderState(
    current.intentResolution,
    "intentResolution"
  );
  await reportBuilderProgress(use.onProgress, {
    label: stage.runningLabel,
    stage: stage.stage,
    status: "running",
  });
  const evaluationRun = await runCatalogCandidateEvaluation(
    use.ports,
    intentResolution,
    candidates
  );
  const evaluatedCandidates = evaluationRun.output;
  await reportBuilderProgress(use.onProgress, {
    detail: formatCandidateEvaluationCounts({
      accepted: evaluatedCandidates.accepted.length,
      rejected: evaluatedCandidates.rejected.length,
    }),
    label: stage.completedLabel,
    stage: stage.stage,
    status: "completed",
  });
  const evaluationEvent = createLifecycleEvent({
    actor: use.auth,
    createdAt: use.ports.clock.now(),
    id: use.ports.ids.next("event"),
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
    sessionId: use.sessionId,
    stage: "candidate_evaluation",
    templateName: "candidate-evaluator",
    templateVersion: "1.0.0",
  });
  const validationCompatibilityEvent = {
    ...evaluationEvent,
    id: use.ports.ids.next("event"),
    stage: "candidate_validation",
  };
  await use.ports.events.emit(use.auth, evaluationEvent);
  await use.ports.events.emit(use.auth, validationCompatibilityEvent);
  emit({
    detail: {
      acceptedCount: evaluatedCandidates.accepted.length,
      rejectedCount: evaluatedCandidates.rejected.length,
    },
    message: "Filtered candidate matches.",
    type: "builder.candidate_evaluation.completed",
  });
  return done({
    ...current,
    evaluatedCandidates,
    evaluationEvent,
    evaluationRun,
    validationCompatibilityEvent,
  });
}

async function runCandidateRankingStep({
  emit,
  state,
  use,
}: BuilderStartStepContext) {
  const stage = builderProgressStages.candidateRanking;
  const current = builderState(state);
  const evaluatedCandidates = requireBuilderState(
    current.evaluatedCandidates,
    "evaluatedCandidates"
  );
  await reportBuilderProgress(use.onProgress, {
    label: stage.runningLabel,
    stage: stage.stage,
    status: "running",
  });
  const rankedCandidates = await runCatalogRanker(
    use.ports,
    use.auth,
    use.sessionId,
    evaluatedCandidates.accepted
  );
  emit({
    detail: { rankedCandidateCount: rankedCandidates.length },
    message: "Ranked candidate options.",
    type: "builder.candidate_ranking.completed",
  });
  await reportBuilderProgress(use.onProgress, {
    detail: formatCapabilityCount(rankedCandidates.length, "ranked candidate"),
    label: stage.completedLabel,
    stage: stage.stage,
    status: "completed",
  });
  return done({ ...current, rankedCandidates });
}

async function runOptionGenerationStep({
  emit,
  state,
  use,
}: BuilderStartStepContext) {
  const stage = builderProgressStages.optionGeneration;
  const current = builderState(state);
  const evaluatedCandidates = requireBuilderState(
    current.evaluatedCandidates,
    "evaluatedCandidates"
  );
  const plan = requireBuilderState(current.plan, "plan");
  const rankedCandidates = requireBuilderState(
    current.rankedCandidates,
    "rankedCandidates"
  );
  await reportBuilderProgress(use.onProgress, {
    label: stage.runningLabel,
    stage: stage.stage,
    status: "running",
  });
  const options = withGeneratedFallbackOptions(
    use.ports,
    plan,
    await runOptionGenerator(
      use.ports,
      use.auth,
      use.sessionId,
      plan,
      rankedCandidates,
      evaluatedCandidates.evidence
    )
  );
  emit({
    detail: { optionCount: options.length },
    message: "Prepared decision options.",
    type: "builder.option_generation.completed",
  });
  await reportBuilderProgress(use.onProgress, {
    detail: `${formatCapabilityCount(options.length, "option")} prepared`,
    label: stage.completedLabel,
    stage: stage.stage,
    status: "completed",
  });
  return done({ ...current, options });
}

async function runPreviewProjectionStep({
  emit,
  input,
  state,
  use,
}: BuilderStartStepContext) {
  const stage = builderProgressStages.previewProjection;
  const current = builderState(state);
  const candidates = requireBuilderState(current.candidates, "candidates");
  const evaluationEvent = requireBuilderState(
    current.evaluationEvent,
    "evaluationEvent"
  );
  const intentResolution = requireBuilderState(
    current.intentResolution,
    "intentResolution"
  );
  const options = requireBuilderState(current.options, "options");
  const plan = requireBuilderState(current.plan, "plan");
  const rankedCandidates = requireBuilderState(
    current.rankedCandidates,
    "rankedCandidates"
  );
  const requirementEvent = requireBuilderState(
    current.requirementEvent,
    "requirementEvent"
  );
  const validationCompatibilityEvent = requireBuilderState(
    current.validationCompatibilityEvent,
    "validationCompatibilityEvent"
  );
  await reportBuilderProgress(use.onProgress, {
    label: stage.runningLabel,
    stage: stage.stage,
    status: "running",
  });
  const predictions = await runPredictionEngine(
    use.ports,
    use.auth,
    use.sessionId,
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
  >(use.sessionId);
  const rootPatch: BuilderPatch = {
    id: use.ports.ids.next("patch"),
    summary: "Initial intent plan",
    ops: [
      ...plan.steps.map((step) => ({ op: "add_step" as const, step })),
      ...branchEdgesForIntentPlan(plan),
    ],
  };
  dag = appendCommit(dag, {
    id: use.ports.ids.next("commit"),
    parentIds: [],
    patch: rootPatch,
    createdAt: use.startedAt,
    metadata: { event: "session.started" },
  });
  for (const option of options) {
    dag = createBranch(dag, {
      id: option.id,
      baseCommitId: dag.headCommitId ?? "",
      patch: mergeBuilderPatches(option.patch, predictions.get(option.id)),
      metadata: {
        optionId: option.id,
        label: option.title,
        previewKind: "grey_future_branch",
        risk: option.risk,
      },
      createdAt: use.startedAt,
    });
  }
  const event = createLifecycleEvent({
    id: use.ports.ids.next("event"),
    sessionId: use.sessionId,
    actor: use.auth,
    stage: "session.start",
    phaseStatus: "completed",
    createdAt: use.startedAt,
    templateName: "intent-decomposer",
    templateVersion: "1.0.0",
    model: "builder-runtime",
    payload: {
      hasContext: Boolean(input.context),
      optionCount: options.length,
    },
  });
  const session = builderSessionSchema.parse({
    id: use.sessionId,
    auth: use.auth,
    prompt: input.prompt,
    status: "ready",
    dag,
    turns: [
      {
        id: use.ports.ids.next("turn"),
        sessionId: use.sessionId,
        input: input.prompt,
        intentPlan: plan,
        createdAt: use.startedAt,
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
    createdAt: use.startedAt,
    updatedAt: use.startedAt,
  });
  await use.ports.store.createSession(use.auth, session);
  await use.ports.events.emit(use.auth, event);
  const projection = projectSession(session);
  emit({
    detail: {
      optionCount: options.length,
      questionCount: session.questions.length,
    },
    message: "Builder decisions are ready.",
    type: "builder.preview_projection.completed",
  });
  await reportBuilderProgress(use.onProgress, {
    detail: `${options.length} option${options.length === 1 ? "" : "s"}, ${session.questions.length} question${session.questions.length === 1 ? "" : "s"}`,
    label: stage.completedLabel,
    stage: stage.stage,
    status: "completed",
  });
  return done({ ...current, projection });
}

function requireBuilderState<T>(value: T | undefined, label: string): T {
  if (value === undefined) {
    throw new Error(`Missing builder harness state: ${label}`);
  }
  return value;
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
        patch: mergeBuilderPatches(option.patch, predictions.get(option.id)),
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
