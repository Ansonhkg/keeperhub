import { RESOLVED_REQUIREMENT_STATUS } from "@/lib/agentic-builder/intent/contracts";
import type {
  BuilderPreviewBranch,
  BuilderProjection,
} from "@/lib/agentic-builder/projection/contracts";
import type {
  MaterializationIssue,
  MaterializationValidationResult,
  MaterializedWorkflowGraph,
} from "./contracts";

export type ValidateGraphAgainstIntentInput = {
  projection: BuilderProjection;
  selectedBranch: BuilderPreviewBranch;
  graph: MaterializedWorkflowGraph;
};

export function validateGraphAgainstIntent(
  input: ValidateGraphAgainstIntentInput
): MaterializationValidationResult {
  const issues: MaterializationIssue[] = [
    ...validateBlockingQuestions(input.projection),
    ...validateRequirementCoverage(input),
    ...validateOptionGroupSemantics(input),
    ...validateCustomFallbackSemantics(input),
  ];

  return {
    valid: !issues.some((item) => item.severity === "error"),
    issues,
  };
}

function validateBlockingQuestions(
  projection: BuilderProjection
): MaterializationIssue[] {
  return projection.questions
    .filter((question) => question.blocksMaterialization && !question.answer?.trim())
    .map((question) =>
      issue({
        code: "blocking_question_unanswered",
        message: question.question,
        requirementIds: [question.requirementId],
      })
    );
}

function validateRequirementCoverage(
  input: ValidateGraphAgainstIntentInput
): MaterializationIssue[] {
  const issues: MaterializationIssue[] = [];
  const selectedRequirementIds = new Set(input.selectedBranch.requirementIds);
  const coveredRequirementIds = new Set(Object.keys(input.graph.requirementCoverage));

  for (const requirementId of selectedRequirementIds) {
    if (!coveredRequirementIds.has(requirementId)) {
      issues.push(
        issue({
          code: "selected_requirement_not_materialized",
          message: `Requirement "${requirementId}" was selected but not materialized.`,
          requirementIds: [requirementId],
        })
      );
    }
  }

  for (const requirement of input.projection.evaluation.requirements) {
    if (
      requirement.status === RESOLVED_REQUIREMENT_STATUS &&
      selectedRequirementIds.has(requirement.id) &&
      !coveredRequirementIds.has(requirement.id)
    ) {
      issues.push(
        issue({
          code: "satisfied_requirement_not_represented",
          message: `Satisfied requirement "${requirement.summary}" is missing from the graph.`,
          requirementIds: [requirement.id],
        })
      );
    }
  }

  return issues;
}

function validateOptionGroupSemantics(
  input: ValidateGraphAgainstIntentInput
): MaterializationIssue[] {
  const issues: MaterializationIssue[] = [];
  const selectedRequirementIds = new Set(input.selectedBranch.requirementIds);
  const coveredRequirementIds = new Set(Object.keys(input.graph.requirementCoverage));

  for (const coveredRequirementId of coveredRequirementIds) {
    if (!selectedRequirementIds.has(coveredRequirementId)) {
      issues.push(
        issue({
          code: "unselected_requirement_materialized",
          message: `Unselected requirement "${coveredRequirementId}" was materialized.`,
          requirementIds: [coveredRequirementId],
        })
      );
    }
  }

  const selectedOptionGroupId = input.selectedBranch.optionGroupId;
  if (selectedOptionGroupId) {
    const siblingBranches = input.projection.branches.filter(
      (branch) =>
        branch.optionGroupId === selectedOptionGroupId &&
        branch.id !== input.selectedBranch.id
    );
    const siblingRequirementIds = new Set(
      siblingBranches.flatMap((branch) => branch.requirementIds)
    );

    for (const coveredRequirementId of coveredRequirementIds) {
      if (siblingRequirementIds.has(coveredRequirementId)) {
        issues.push(
          issue({
            code: "or_branch_over_materialized",
            message: "Selected option materialized another alternative branch.",
            requirementIds: [coveredRequirementId],
          })
        );
      }
    }
  }

  const requiredTaskIds = input.projection.evaluation.tasks
    .filter((task) => task.requiresAllTasks && !task.optionGroupId)
    .map((task) => task.requirementId);

  for (const requirementId of requiredTaskIds) {
    if (!selectedRequirementIds.has(requirementId)) {
      issues.push(
        issue({
          code: "required_task_missing_from_branch",
          message: `Required task "${requirementId}" is missing from the selected option.`,
          requirementIds: [requirementId],
        })
      );
    }
  }

  return issues;
}

function validateCustomFallbackSemantics(
  input: ValidateGraphAgainstIntentInput
): MaterializationIssue[] {
  const issues: MaterializationIssue[] = [];

  for (const customProposalId of input.selectedBranch.customProposalIds ?? []) {
    const proposal = input.projection.evaluation.customNodeProposals.find(
      (item) => item.id === customProposalId
    );
    if (!proposal?.summary.trim()) {
      issues.push(
        issue({
          code: "custom_proposal_missing_description",
          message: "Custom Node proposal is missing its expected behavior description.",
          requirementIds: proposal ? [proposal.requirementId] : undefined,
        })
      );
      continue;
    }

    if (!input.graph.customProposalCoverage[customProposalId]?.length) {
      issues.push(
        issue({
          code: "custom_proposal_not_materialized",
          message: `Custom Node proposal "${proposal.title}" was not materialized.`,
          requirementIds: [proposal.requirementId],
        })
      );
    }

    const hasNativeMatch = input.projection.evaluation.capabilityMatches.some(
      (match) => match.requirementId === proposal.requirementId && match.source === "native"
    );
    if (hasNativeMatch) {
      issues.push(
        issue({
          code: "custom_selected_despite_native_match",
          message: "Native capability exists; Custom Node fallback should not be selected silently.",
          requirementIds: [proposal.requirementId],
        })
      );
    }
  }

  return issues;
}

function issue(input: {
  code: string;
  message: string;
  requirementIds?: string[];
}): MaterializationIssue {
  return {
    id: `intent:${input.code}:${input.requirementIds?.join(":") ?? "projection"}`,
    severity: "error",
    code: input.code,
    message: input.message,
    requirementIds: input.requirementIds,
  };
}

