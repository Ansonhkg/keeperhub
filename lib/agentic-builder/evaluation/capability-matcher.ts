import type {
  CapabilityDescriptor,
  CapabilityIntent,
  CapabilityMatch,
  CustomNodeProposal,
  EvaluationPolicy,
} from "./contracts";
import { evaluationPolicy } from "./policy";
import type { IntentRequirement } from "../intent/contracts";

export type CapabilityMatchResult = {
  matches: CapabilityMatch[];
  customNodeProposal?: CustomNodeProposal;
};

export function matchRequirementCapability(
  requirement: IntentRequirement,
  capabilities: CapabilityDescriptor[],
  policy: EvaluationPolicy = evaluationPolicy
): CapabilityMatchResult {
  const requiredIntent = requirement.capabilityIntent;
  if (!requiredIntent) {
    return { matches: [] };
  }

  const matches = capabilities
    .map((capability) => scoreCapability(requirement.id, requiredIntent, capability))
    .filter((match): match is CapabilityMatch => Boolean(match))
    .sort((left, right) => {
      const sourceDelta =
        sourceRank(left.source, policy) - sourceRank(right.source, policy);
      return sourceDelta || right.score - left.score;
    });

  if (matches.length > 0) {
    return { matches };
  }

  return {
    matches,
    customNodeProposal: createCustomNodeProposal(requirement, policy),
  };
}

function scoreCapability(
  requirementId: string,
  requiredIntent: CapabilityIntent,
  capability: CapabilityDescriptor
): CapabilityMatch | null {
  const requiredEntries = Object.entries(requiredIntent).filter(
    (entry): entry is [string, string] =>
      typeof entry[1] === "string" && entry[1].length > 0
  );

  if (requiredEntries.length === 0) {
    return null;
  }

  for (const [key, value] of requiredEntries) {
    const candidateValue = capability.capabilityIntent[key as keyof CapabilityIntent];
    if (!sameValue(candidateValue, value)) {
      return null;
    }
  }

  return {
    requirementId,
    capabilityId: capability.id,
    label: capability.label,
    source: capability.source,
    score: requiredEntries.length,
  };
}

function createCustomNodeProposal(
  requirement: IntentRequirement,
  policy: EvaluationPolicy
): CustomNodeProposal {
  return {
    id: `custom:${requirement.id}`,
    requirementId: requirement.id,
    kind: policy.capabilityPolicy.fallback.missingCapabilityKind,
    title: policy.capabilityPolicy.fallback.missingCapabilityTitle,
    summary: requirement.summary,
    requestNativeFeatureAction:
      policy.capabilityPolicy.fallback.requestNativeFeatureAction,
    genericHttpRequiresExplicitSelection:
      policy.capabilityPolicy.fallback.genericHttpRequiresExplicitSelection,
  };
}

function sameValue(candidateValue: unknown, requiredValue: string): boolean {
  return (
    typeof candidateValue === "string" &&
    candidateValue.toLowerCase() === requiredValue.toLowerCase()
  );
}

function sourceRank(source: string, policy: EvaluationPolicy): number {
  const index = policy.capabilityPolicy.sourcePriority.indexOf(source);
  return index === -1 ? policy.capabilityPolicy.sourcePriority.length : index;
}
