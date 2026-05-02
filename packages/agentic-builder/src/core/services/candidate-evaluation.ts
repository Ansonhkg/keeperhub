import { z } from "zod";
import type { AiTemplateRunResult, BuilderPorts } from "../ports/all";
import type {
  CandidateEvaluation,
  CandidateRelationship,
  CatalogCandidate,
  CatalogEvaluationResult,
  DecisionGroup,
  DynamicRequirement,
  DynamicRequirementKind,
  IntentRequirement,
  IntentResolution,
} from "../schemas/all";
import {
  candidateEvaluationSchema,
  catalogEvaluationResultSchema,
  decisionGroupSchema,
  dynamicRequirementSchema,
} from "../schemas/all";
import { validateCatalogCandidates } from "./candidate-validation";

const NATIVE_PROVIDER_TIERS = new Set(["native", "protocol"]);

const candidateEvaluatorOutputSchema = z.object({
  decisionGroups: z.array(decisionGroupSchema).default([]),
  dynamicRequirements: z.array(dynamicRequirementSchema).optional(),
  evidence: z.array(candidateEvaluationSchema).default([]),
});

export type CatalogEvaluationRunResult =
  AiTemplateRunResult<CatalogEvaluationResult> & {
    readonly usedFallback: boolean;
  };

export async function runCatalogCandidateEvaluation(
  ports: BuilderPorts,
  intentResolution: IntentResolution,
  candidates: readonly CatalogCandidate[]
): Promise<CatalogEvaluationRunResult> {
  const fallback = evaluateCatalogCandidates(intentResolution, candidates);
  if (candidates.length === 0) {
    return {
      durationMs: 0,
      model: "candidate-evaluator-empty",
      output: fallback,
      repairAttempts: 0,
      usedFallback: true,
    };
  }
  try {
    const result = await ports.ai.run(
      {
        outputSchemaName: "CandidateEvaluationResult",
        templateName: "candidate-evaluator",
        templateVersion: "1.0.0",
        variables: {
          candidates: JSON.stringify(candidates),
          dynamicRequirements: JSON.stringify(fallback.dynamicRequirements),
          fallbackEvaluation: JSON.stringify(fallback),
          intentResolution: JSON.stringify(intentResolution),
          sourceText: intentResolution.sourceText,
        },
      },
      (output) => normalizeEvaluatorOutput(output, fallback, candidates)
    );
    return { ...result, usedFallback: false };
  } catch {
    return {
      durationMs: 0,
      model: "candidate-evaluator-fallback",
      output: fallback,
      repairAttempts: 0,
      usedFallback: true,
    };
  }
}

export function evaluateCatalogCandidates(
  intentResolution: IntentResolution,
  candidates: readonly CatalogCandidate[]
): CatalogEvaluationResult {
  const validation = validateCatalogCandidates(intentResolution, candidates);
  const dynamicRequirements =
    dynamicRequirementsForEvaluation(intentResolution);
  const accepted = suppressFallbacksWithNativeAlternatives(validation.accepted);
  const evidence = validation.evidence.map<CandidateEvaluation>((item) => {
    const candidate = candidates.find(
      (candidateItem) => candidateItem.id === item.candidateId
    );
    const relationship = relationshipForCandidate(candidate, item.status);
    const requirementIds = item.requirementEvaluations
      .filter((evaluation) => evaluation.status !== "not_applicable")
      .map((evaluation) => evaluation.requirementId);
    return {
      candidateId: item.candidateId,
      conflictingRequirementIds: item.requirementEvaluations
        .filter((evaluation) => evaluation.status === "conflicting")
        .map((evaluation) => evaluation.requirementId),
      decisionGroupId: decisionGroupIdForRequirementIds(requirementIds),
      evidence: item.requirementEvaluations.flatMap(
        (evaluation) => evaluation.evidence
      ),
      missingRequirementIds: item.requirementEvaluations
        .filter((evaluation) => evaluation.status === "missing")
        .map((evaluation) => evaluation.requirementId),
      reasons: item.reasons.length > 0 ? item.reasons : ["candidate accepted"],
      relationship,
      requirementIds,
      satisfiedRequirementIds: item.requirementEvaluations
        .filter(
          (evaluation) =>
            evaluation.status === "satisfied" ||
            evaluation.status === "ambiguous"
        )
        .map((evaluation) => evaluation.requirementId),
      score: candidate?.score ?? 0,
      status: item.status === "accepted" ? "accepted" : "rejected",
    };
  });
  const decisionGroups = buildDecisionGroups(
    dynamicRequirements,
    evidence,
    accepted
  );
  return catalogEvaluationResultSchema.parse({
    accepted,
    decisionGroups,
    dynamicRequirements,
    evidence,
    rejected: validation.rejected,
  });
}

function normalizeEvaluatorOutput(
  output: unknown,
  fallback: CatalogEvaluationResult,
  candidates: readonly CatalogCandidate[]
): CatalogEvaluationResult {
  const full = catalogEvaluationResultSchema.safeParse(output);
  if (full.success) {
    return guardEvaluationResult(full.data, fallback, candidates);
  }
  const partial = candidateEvaluatorOutputSchema.safeParse(output);
  if (!partial.success || partial.data.evidence.length === 0) {
    return fallback;
  }
  return guardEvaluationResult(
    {
      accepted: [],
      decisionGroups: partial.data.decisionGroups,
      dynamicRequirements:
        partial.data.dynamicRequirements ?? fallback.dynamicRequirements,
      evidence: partial.data.evidence,
      rejected: [],
    },
    fallback,
    candidates
  );
}

function guardEvaluationResult(
  result: CatalogEvaluationResult,
  fallback: CatalogEvaluationResult,
  candidates: readonly CatalogCandidate[]
): CatalogEvaluationResult {
  const candidatesById = new Map(
    candidates.map((candidate) => [candidate.id, candidate])
  );
  const fallbackEvidenceById = new Map(
    fallback.evidence.map((item) => [item.candidateId, item])
  );
  const evidenceById = new Map<string, CandidateEvaluation>();
  for (const candidate of candidates) {
    const fallbackEvidence = fallbackEvidenceById.get(candidate.id);
    if (fallbackEvidence) {
      evidenceById.set(candidate.id, fallbackEvidence);
    }
  }
  for (const item of result.evidence) {
    if (candidatesById.has(item.candidateId)) {
      const fallbackEvidence = fallbackEvidenceById.get(item.candidateId);
      if (
        fallbackEvidence?.status === "rejected" &&
        item.status === "accepted"
      ) {
        continue;
      }
      evidenceById.set(item.candidateId, item);
    }
  }
  const evidence = candidates.flatMap((candidate) => {
    const item = evidenceById.get(candidate.id);
    return item ? [item] : [];
  });
  if (evidence.length === 0) {
    return fallback;
  }
  const acceptedIds = new Set(
    evidence
      .filter((item) => item.status === "accepted")
      .map((item) => item.candidateId)
  );
  const accepted = suppressFallbacksWithNativeAlternatives(
    candidates.filter((candidate) => acceptedIds.has(candidate.id))
  );
  const acceptedAfterNativeGuard = new Set(
    accepted.map((candidate) => candidate.id)
  );
  const rejected = candidates.filter(
    (candidate) => !acceptedAfterNativeGuard.has(candidate.id)
  );
  const decisionGroups = normalizeDecisionGroups(
    result.decisionGroups,
    accepted,
    result.dynamicRequirements
  );
  return catalogEvaluationResultSchema.parse({
    accepted,
    decisionGroups:
      decisionGroups.length > 0
        ? decisionGroups
        : buildDecisionGroups(result.dynamicRequirements, evidence, accepted),
    dynamicRequirements:
      result.dynamicRequirements.length > 0
        ? result.dynamicRequirements
        : fallback.dynamicRequirements,
    evidence,
    rejected,
  });
}

function normalizeDecisionGroups(
  decisionGroups: readonly DecisionGroup[],
  accepted: readonly CatalogCandidate[],
  requirements: readonly DynamicRequirement[]
): DecisionGroup[] {
  const acceptedIds = new Set(accepted.map((candidate) => candidate.id));
  return decisionGroups.flatMap((group) => {
    const candidateIds = group.candidateIds.filter((candidateId) =>
      acceptedIds.has(candidateId)
    );
    if (candidateIds.length === 0) {
      return [];
    }
    return [
      {
        ...group,
        candidateIds,
        label:
          requirements.find((requirement) =>
            group.requirementIds.includes(requirement.id)
          )?.label ?? group.label,
        recommendedCandidateIds: group.recommendedCandidateIds.filter(
          (candidateId) => acceptedIds.has(candidateId)
        ),
      },
    ];
  });
}

function dynamicRequirementsForEvaluation(
  intentResolution: IntentResolution
): readonly DynamicRequirement[] {
  if ((intentResolution.dynamicRequirements ?? []).length > 0) {
    return intentResolution.dynamicRequirements ?? [];
  }
  return intentResolution.requirements.map(dynamicRequirementFromLegacy);
}

function dynamicRequirementFromLegacy(
  requirement: IntentRequirement
): DynamicRequirement {
  return {
    appliesTo: requirement.appliesTo,
    candidates: requirement.candidates,
    cardinality:
      requirement.status === "ambiguous" ? "single_or_multiple" : "single",
    evidence: requirement.evidence,
    id: `dynamic-${requirement.id}`,
    key: requirement.type,
    label: requirement.type.replace(/_/g, " "),
    legacyConstraint: requirement.legacyConstraint,
    legacyType: requirement.type,
    requirementKind: dynamicRequirementKindForLegacy(requirement),
    source: "planner",
    status: requirement.status,
    value: requirement.value,
  };
}

function dynamicRequirementKindForLegacy(
  requirement: IntentRequirement
): DynamicRequirementKind {
  const typeToKind: Record<IntentRequirement["type"], DynamicRequirementKind> =
    {
      asset: "asset.price.read",
      content_kind: "content.generate",
      destructive_intent: "safety.confirm",
      notification_channel: "notification.send",
      operation:
        requirement.value === "swap" ? "swap.execute" : "operation.execute",
      provider: "provider.select",
      resource: "resource.select",
      schedule: "temporal.repeat",
    };
  return typeToKind[requirement.type];
}

function relationshipForCandidate(
  candidate: CatalogCandidate | undefined,
  status: "accepted" | "rejected"
): CandidateRelationship {
  if (
    candidate?.provider === "workflow" ||
    candidate?.provider === "template"
  ) {
    return "fallback";
  }
  if (candidate?.provider === "missing") {
    return "fallback";
  }
  if (status === "rejected") {
    return "competing";
  }
  return "competing";
}

function decisionGroupIdForRequirementIds(requirementIds: readonly string[]) {
  return requirementIds[0]
    ? `decision-${requirementIds[0]}`
    : "decision-general";
}

function buildDecisionGroups(
  requirements: readonly DynamicRequirement[],
  evidence: readonly CandidateEvaluation[],
  accepted: readonly CatalogCandidate[]
): DecisionGroup[] {
  const groups = new Map<string, DecisionGroup>();
  for (const item of evidence.filter(
    (candidate) => candidate.status === "accepted"
  )) {
    const candidate = accepted.find(
      (acceptedCandidate) => acceptedCandidate.id === item.candidateId
    );
    if (!candidate) {
      continue;
    }
    const requirement = requirements.find((requirementItem) =>
      item.requirementIds.includes(
        requirementItem.legacyType ?? requirementItem.id
      )
    );
    const groupId = item.decisionGroupId;
    const existing = groups.get(groupId);
    if (existing) {
      groups.set(groupId, {
        ...existing,
        candidateIds: [...existing.candidateIds, item.candidateId],
        recommendedCandidateIds:
          candidate.score >
          (scoreForCandidate(accepted, existing.recommendedCandidateIds[0]) ??
            0)
            ? [item.candidateId]
            : existing.recommendedCandidateIds,
      });
      continue;
    }
    groups.set(groupId, {
      candidateIds: [item.candidateId],
      id: groupId,
      label: requirement?.label ?? candidate.label,
      recommendedCandidateIds: [item.candidateId],
      relationship: item.relationship,
      requirementIds: item.requirementIds,
    });
  }
  return [...groups.values()];
}

function scoreForCandidate(
  candidates: readonly CatalogCandidate[],
  candidateId: string | undefined
): number | undefined {
  if (!candidateId) {
    return undefined;
  }
  return candidates.find((candidate) => candidate.id === candidateId)?.score;
}

function suppressFallbacksWithNativeAlternatives(
  accepted: readonly CatalogCandidate[]
): CatalogCandidate[] {
  const hasNativeCandidate = accepted.some((candidate) =>
    NATIVE_PROVIDER_TIERS.has(candidate.provider)
  );
  if (!hasNativeCandidate) {
    return [...accepted];
  }
  return accepted.filter(
    (candidate) =>
      NATIVE_PROVIDER_TIERS.has(candidate.provider) ||
      candidate.provider === "missing"
  );
}
