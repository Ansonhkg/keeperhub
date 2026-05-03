import type {
  BuilderSession,
  CatalogCandidate,
  IntentPlan,
  IntentResolution,
} from "../schemas/all";
import { inferCandidateCapability } from "../services/candidate-validation";
import type { BuilderProgressEvent } from "./runner";

type BuilderProgressStage = {
  readonly completedLabel: string;
  readonly runningLabel: string;
  readonly stage: BuilderProgressEvent["stage"];
};

export const builderProgressStages = {
  candidateEvaluation: {
    completedLabel: "Filtered candidate matches",
    runningLabel: "Evaluating candidates against the requirements",
    stage: "candidate_evaluation",
  },
  candidateRanking: {
    completedLabel: "Ranked candidate options",
    runningLabel: "Ranking native matches before fallbacks",
    stage: "candidate_ranking",
  },
  catalogSearch: {
    completedLabel: "Found matching node candidates",
    runningLabel: "Searching native and custom node catalogs",
    stage: "catalog_search",
  },
  intentPlanner: {
    completedLabel: "Resolved the initial intent plan",
    runningLabel: "Decomposing the prompt into requirements",
    stage: "intent_planner",
  },
  optionGeneration: {
    completedLabel: "Prepared decision options",
    runningLabel: "Preparing selectable builder decisions",
    stage: "option_generation",
  },
  previewProjection: {
    completedLabel: "Builder decisions are ready",
    runningLabel: "Projecting preview branches onto the canvas",
    stage: "preview_projection",
  },
  requirementResolution: {
    completedLabel: "Evaluated requirement coverage",
    runningLabel: "Checking which requirements are satisfied or unresolved",
    stage: "requirement_resolution",
  },
} satisfies Record<string, BuilderProgressStage>;

export function buildInlineQuestions(
  questionIds: readonly string[],
  plan: IntentPlan,
  intentResolution: IntentResolution,
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

export function buildQuestionIds(
  intentResolution: IntentResolution,
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
  intentResolution: IntentResolution
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
