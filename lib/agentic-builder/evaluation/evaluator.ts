import {
  RESOLVED_REQUIREMENT_STATUS,
  type BuilderIntentDraft,
  type IntentClause,
  type IntentRequirement,
} from "../intent/contracts";
import { BuilderIntentDraftSchema } from "../intent/schema";
import { matchRequirementCapability } from "./capability-matcher";
import type {
  BuilderOptionGroup,
  BuilderTaskCandidate,
  CapabilityDescriptor,
  CapabilityMatch,
  CustomNodeProposal,
  EvaluatedRequirement,
  EvaluationPolicy,
  RequirementEvaluationResult,
} from "./contracts";
import { evaluationPolicy } from "./policy";
import { buildCurrentCapabilityCatalog } from "./runtime-catalog";

export type EvaluateBuilderIntentInput = {
  draft: BuilderIntentDraft;
  capabilities?: CapabilityDescriptor[];
  policy?: EvaluationPolicy;
};

export function evaluateBuilderIntent(
  input: EvaluateBuilderIntentInput
): RequirementEvaluationResult {
  const draft = BuilderIntentDraftSchema.parse(input.draft);
  const policy = input.policy ?? evaluationPolicy;
  const capabilities = input.capabilities ?? buildCurrentCapabilityCatalog(policy);
  const requirements = evaluateRequirements(draft);
  const tasks = deriveTaskCandidates(draft, policy);
  const optionGroups = deriveOptionGroups(tasks);
  const capabilityMatches: CapabilityMatch[] = [];
  const customNodeProposals: CustomNodeProposal[] = [];

  for (const task of tasks) {
    const requirement = findRequirement(draft, task.requirementId);
    if (!requirement) {
      continue;
    }

    const matchResult = matchRequirementCapability(requirement, capabilities, policy);
    capabilityMatches.push(...matchResult.matches);
    if (matchResult.customNodeProposal) {
      customNodeProposals.push(matchResult.customNodeProposal);
    }
  }

  return {
    requirements,
    unresolved: draft.unresolved,
    tasks,
    optionGroups,
    capabilityMatches,
    customNodeProposals,
  };
}

function evaluateRequirements(draft: BuilderIntentDraft): EvaluatedRequirement[] {
  return draft.clauses.flatMap((clause) =>
    clause.requirements.map((requirement) => ({
      id: requirement.id,
      kind: requirement.kind,
      status: requirement.status,
      summary: requirement.summary,
      fields: requirement.fields,
      capabilityIntent: requirement.capabilityIntent,
      question: requirement.question,
      blocksMaterialization: Boolean(requirement.blocksMaterialization),
      sourceClauseId: clause.id,
    }))
  );
}

function deriveTaskCandidates(
  draft: BuilderIntentDraft,
  policy: EvaluationPolicy
): BuilderTaskCandidate[] {
  return draft.clauses.flatMap((clause) =>
    clause.requirements
      .filter(shouldDeriveTaskCandidate)
      .map((requirement) => createTaskCandidate(clause, requirement, policy))
  );
}

function createTaskCandidate(
  clause: IntentClause,
  requirement: IntentRequirement,
  policy: EvaluationPolicy
): BuilderTaskCandidate {
  const semantics = clause.connector
    ? policy.connectorSemantics[clause.connector]
    : undefined;
  const optionGroupId = semantics?.createsOptionGroup
    ? `option-group:${clause.id}`
    : undefined;

  return {
    id: `task:${requirement.id}`,
    clauseId: clause.id,
    requirementId: requirement.id,
    kind: requirement.kind,
    summary: requirement.summary,
    capabilityIntent: requirement.capabilityIntent,
    optionGroupId,
    preservesOrder: Boolean(semantics?.preservesOrder),
    requiresAllTasks: semantics?.requiresAllTasks ?? true,
  };
}

function deriveOptionGroups(tasks: BuilderTaskCandidate[]): BuilderOptionGroup[] {
  const groups = new Map<string, BuilderOptionGroup>();

  for (const task of tasks) {
    if (!task.optionGroupId) {
      continue;
    }

    const group =
      groups.get(task.optionGroupId) ??
      ({
        id: task.optionGroupId,
        clauseId: task.clauseId,
        taskIds: [],
      } satisfies BuilderOptionGroup);
    group.taskIds.push(task.id);
    groups.set(group.id, group);
  }

  return Array.from(groups.values());
}

function shouldDeriveTaskCandidate(requirement: IntentRequirement): boolean {
  return (
    requirement.status === RESOLVED_REQUIREMENT_STATUS ||
    Boolean(requirement.capabilityIntent)
  );
}

function findRequirement(
  draft: BuilderIntentDraft,
  requirementId: string
): IntentRequirement | undefined {
  for (const clause of draft.clauses) {
    const requirement = clause.requirements.find((item) => item.id === requirementId);
    if (requirement) {
      return requirement;
    }
  }

  return undefined;
}
