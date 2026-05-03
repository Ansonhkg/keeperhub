import { z } from "zod";
import { createLifecycleEvent } from "../events/builder-events";
import type { BuilderPorts } from "../ports/all";
import {
  type BuilderOption,
  builderOptionSchema,
  type CandidateEvaluation,
  type CandidateValidation,
  type CatalogCandidate,
  catalogCandidateSchema,
  type IntentPlan,
} from "../schemas/all";
import { inferCandidateCapability } from "../services/candidate-validation";

export function formatCapabilityCount(count: number, label: string) {
  return `${count} ${label}${count === 1 ? "" : "s"}`;
}

export function formatCandidateEvaluationCounts(input: {
  readonly accepted: number;
  readonly rejected: number;
}) {
  return `${input.accepted} accepted, ${input.rejected} rejected`;
}

export async function runCatalogSearch(
  ports: BuilderPorts,
  auth: Parameters<BuilderPorts["catalog"]["search"]>[0]["auth"],
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

export async function runCatalogRanker(
  ports: BuilderPorts,
  auth: Parameters<BuilderPorts["catalog"]["search"]>[0]["auth"],
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
  auth: Parameters<BuilderPorts["catalog"]["search"]>[0]["auth"],
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

export function withGeneratedFallbackOptions(
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
