import { pathToHead } from "@keeperhub/builder-dag/commit-graph";
import { orderedTimeline } from "@keeperhub/builder-dag/projection";
import { z } from "zod";
import { createLifecycleEvent } from "../events/builder-events";
import type { BuilderPorts } from "../ports/all";
import {
  type BuilderAuthContext,
  type BuilderOption,
  type BuilderPatch,
  type BuilderProjection,
  type BuilderSession,
  builderPatchSchema,
  builderProjectionSchema,
  type IntentPlan,
  type ValidationResult,
  type WorkflowDraft,
} from "../schemas/all";
import { validateBuilderReadiness } from "./readiness";

export function mergeBuilderPatches(
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

export function validateBuilderState(
  session: BuilderSession
): ValidationResult {
  return validateBuilderReadiness(toWorkflowDraft(session, false));
}

function normalizedLabelIncludes(
  step: IntentPlan["steps"][number],
  term: string
) {
  return step.label.toLowerCase().includes(term.toLowerCase());
}

export function branchEdgesForIntentPlan(
  plan: IntentPlan
): BuilderPatch["ops"] {
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

export function patchWithoutDuplicateNotificationAdds(
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

export function toWorkflowDraft(
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
      if (op.op === "add_edge") {
        edges.set(workflowDraftEdgeKey(op), {
          fromStepId: op.fromStepId,
          sourceHandle: op.sourceHandle,
          targetHandle: op.targetHandle,
          toStepId: op.toStepId,
        });
      }
    }
  }
  if (includePreview) {
    for (const branch of session.dag.branches.filter(
      (candidate) => candidate.status === "open"
    )) {
      for (const op of branch.patch.ops) {
        if (op.op === "add_step") {
          committedSteps.set(op.step.id, op.step);
        }
      }
    }
  }
  const draft = {
    edges: [...edges.values()],
    id: session.id,
    nodes: [...committedSteps.values()],
  };
  return ensureWorkflowDraftSemanticEdges(draft);
}

export function projectSession(session: BuilderSession): BuilderProjection {
  const candidateBranches = session.dag.branches.map((branch) => ({
    baseCommitId: branch.baseCommitId,
    branchId: branch.id,
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
    greyNodes: branch.patch.ops.flatMap((op) =>
      op.op === "add_step" ? [op.step] : []
    ),
    optionId: branch.metadata.optionId,
    status: branch.status,
  }));
  return builderProjectionSchema.parse({
    candidateBranches,
    committed: toWorkflowDraft(session, false),
    headCommitId: session.dag.headCommitId,
    options: session.options,
    questions: session.questions,
    sessionId: session.id,
    timeline: orderedTimeline(session.dag).map((item) => ({
      createdAt: item.createdAt,
      id: item.id,
      kind: item.kind,
      label: item.id,
    })),
    validation: validateBuilderState(session),
  });
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
