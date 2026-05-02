import type {
  BuilderOption,
  BuilderProjection,
  CandidateBranchProjection,
  IntentStep,
  OpenQuestion,
} from "@keeperhub/agentic-builder/schemas";
import type { ConditionConfig } from "@/lib/condition-builder-types";
import type { WorkflowEdge, WorkflowNode } from "@/lib/workflow-store";
import { findActionById, flattenConfigFields } from "@/plugins/registry";

export type BuilderCanvasProjection = {
  readonly nodes: WorkflowNode[];
  readonly edges: WorkflowEdge[];
};

type ProjectionOptions = {
  readonly highlightedOptionId?: string | null;
  readonly sourceText?: string;
};

const COMMITTED_X = 0;
const COMMITTED_Y = 120;
const NODE_X_GAP = 360;
const PREVIEW_X_GAP = 320;
const PREVIEW_Y_GAP = 230;
const OPTION_LANE_X_GAP = 380;
const BRANCH_Y_GAP = 240;
const NODE_COLLISION_X_GAP = 220;
const NODE_COLLISION_Y_GAP = 170;

type CanvasPosition = { x: number; y: number };

function workflowTypeForStep(step: IntentStep): "trigger" | "action" {
  return step.kind === "trigger" ? "trigger" : "action";
}

function notificationActionTypeForStep(
  step: IntentStep,
  questions: readonly OpenQuestion[]
): string {
  const channelAnswer = questions.find(
    (question) =>
      question.status === "answered" &&
      (question.stepId === step.id ||
        question.id.toLowerCase().includes("notification-channel"))
  )?.answer;
  const channel = Array.isArray(channelAnswer)
    ? channelAnswer[0]
    : channelAnswer;

  if (typeof channel === "string") {
    const normalizedChannel = channel.toLowerCase();
    if (normalizedChannel.includes("webhook")) {
      return "webhook/send-webhook";
    }
    if (normalizedChannel.includes("slack")) {
      return "slack/send-message";
    }
    if (normalizedChannel.includes("telegram")) {
      return "telegram/send-message";
    }
  }

  if (/\bwebhook\b|\bhttp\s+request\b/i.test(step.label)) {
    return "webhook/send-webhook";
  }

  return "Send Email";
}

function extractFirstUrl(text: string): string | undefined {
  return /\bhttps?:\/\/[^\s"'<>),]+/i.exec(text)?.[0];
}

function extractHttpMethod(text: string): string | undefined {
  return /\b(GET|POST|PUT|PATCH|DELETE)\b/i.exec(text)?.[1]?.toUpperCase();
}

function extractJsonObjectAfterKeyword(text: string): string | undefined {
  const keywordMatch = /\b(?:json\s+body|body|payload)\b/i.exec(text);
  if (!keywordMatch) {
    return undefined;
  }

  const start = text.indexOf("{", keywordMatch.index);
  if (start === -1) {
    return undefined;
  }

  let depth = 0;
  let escaped = false;
  let inString = false;
  for (let index = start; index < text.length; index += 1) {
    const char = text[index];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (char === "\\") {
      escaped = true;
      continue;
    }
    if (char === '"') {
      inString = !inString;
      continue;
    }
    if (inString) {
      continue;
    }
    if (char === "{") {
      depth += 1;
    } else if (char === "}") {
      depth -= 1;
      if (depth === 0) {
        const candidate = text.slice(start, index + 1);
        try {
          JSON.parse(candidate);
          return candidate;
        } catch {
          return undefined;
        }
      }
    }
  }

  return undefined;
}

function webhookConfigFromText(text: string): Record<string, unknown> {
  const webhookPayload = extractJsonObjectAfterKeyword(text);
  return {
    ...(extractFirstUrl(text) ? { webhookUrl: extractFirstUrl(text) } : {}),
    webhookMethod: extractHttpMethod(text) ?? "POST",
    ...(webhookPayload
      ? {
          webhookHeaders: JSON.stringify({
            "Content-Type": "application/json",
          }),
          webhookPayload,
        }
      : {}),
  };
}

function nativeActionConfigForOption(
  option: BuilderOption | undefined,
  contextText = ""
): Record<string, unknown> | null {
  if (!option) {
    return null;
  }

  const directActionId = option.candidateIds
    .map((candidateId) =>
      candidateId.startsWith("native-")
        ? candidateId.slice("native-".length)
        : candidateId
    )
    .find((candidateId) => findActionById(candidateId));
  const action = findActionById(directActionId) ?? findActionById(option.title);
  if (!action) {
    return null;
  }

  const config: Record<string, unknown> = { actionType: action.id };
  for (const field of flattenConfigFields(action.configFields)) {
    if (field.defaultValue !== undefined) {
      config[field.key] = field.defaultValue;
    }
  }
  if (action.id === "webhook/send-webhook") {
    Object.assign(config, webhookConfigFromText(contextText));
  }
  return config;
}

function nativeOptionForStep(
  step: IntentStep,
  options: readonly BuilderOption[]
): BuilderOption | undefined {
  return options.find((option) =>
    option.patch.ops.some((op) => {
      if (op.op === "update_step") {
        return (
          op.stepId === step.id &&
          (op.changes.label === step.label || op.changes.status === step.status)
        );
      }
      if (op.op === "add_step") {
        return op.step.id === step.id || op.step.label === step.label;
      }
      return false;
    })
  );
}

type ParsedConditionCriteria = {
  readonly leftOperand: string;
  readonly operator: "<" | "<=" | ">" | ">=";
  readonly rightOperand: string;
} | null;

function openConditionQuestionForStep(
  step: IntentStep,
  questions: readonly OpenQuestion[]
): OpenQuestion | undefined {
  return questions.find(
    (question) =>
      question.status === "open" &&
      question.id.startsWith("question-condition-criteria-") &&
      (question.stepId === step.id || question.id.endsWith(step.id))
  );
}

function answeredConditionQuestionForStep(
  step: IntentStep,
  questions: readonly OpenQuestion[]
): OpenQuestion | undefined {
  return questions.find(
    (question) =>
      question.status === "answered" &&
      question.id.startsWith("question-condition-criteria-") &&
      (question.stepId === step.id || question.id.endsWith(step.id))
  );
}

function parseConditionCriteriaText(text: string): ParsedConditionCriteria {
  const absoluteDeltaMatch =
    /\b(?:moves?|changes?|differs?|delta|difference)\s+(?:by\s+)?(?:at\s+least\s+|more\s+than\s+|over\s+)?\$?(\d+(?:\.\d+)?)\s*(usd|usdc|dollars?)?\b/i.exec(
      text
    ) ??
    /\$?(\d+(?:\.\d+)?)\s*(usd|usdc|dollars?)?\s+(?:from|against|compared\s+to)\s+(?:the\s+)?(?:cached|baseline|reference|initial|constant)/i.exec(
      text
    );
  if (
    absoluteDeltaMatch?.[1] &&
    /\b(?:cached|baseline|reference|initial|constant)\b/i.test(text)
  ) {
    return {
      leftOperand: "abs({{freshEthPrice}} - {{baselineEthPrice}})",
      operator: ">=",
      rightOperand: absoluteDeltaMatch[1],
    };
  }

  const percentMatch =
    /\b(?:moves?|changes?|change|drops?|rises?|spikes?)\s+(?:by\s+)?(?:more\s+than|over|above|greater\s+than)\s+(\d+(?:\.\d+)?)\s*(?:%|percent)/i.exec(
      text
    ) ??
    /\b(?:more\s+than|over|above|greater\s+than)\s+(\d+(?:\.\d+)?)\s*(?:%|percent)/i.exec(
      text
    );
  if (percentMatch?.[1]) {
    return {
      leftOperand: "{{price_change_percent}}",
      operator: ">",
      rightOperand: percentMatch[1],
    };
  }

  const priceThresholdMatch =
    /\b(?:drops?|falls?|below|under|less\s+than)\s+(?:below|under|than)?\s*\$?(\d+(?:\.\d+)?)\s*(usd|usdc|dollars?)?\b/i.exec(
      text
    ) ??
    /\b(?:rises?|goes?|above|over|greater\s+than)\s+(?:above|over|than)?\s*\$?(\d+(?:\.\d+)?)\s*(usd|usdc|dollars?)?\b/i.exec(
      text
    );
  if (priceThresholdMatch?.[1]) {
    const matchedText = priceThresholdMatch[0].toLowerCase();
    return {
      leftOperand: "{{price_usd}}",
      operator:
        matchedText.includes("above") ||
        matchedText.includes("over") ||
        matchedText.includes("greater") ||
        matchedText.includes("rises") ||
        matchedText.includes("goes")
          ? ">"
          : "<",
      rightOperand: priceThresholdMatch[1],
    };
  }

  return null;
}

function conditionConfigFromCriteria(
  criteria: NonNullable<ParsedConditionCriteria>,
  stepId: string
): ConditionConfig {
  return {
    group: {
      id: `${stepId}-condition-group`,
      logic: "AND",
      rules: [
        {
          id: `${stepId}-condition-rule`,
          leftOperand: criteria.leftOperand,
          operator: criteria.operator,
          rightOperand: criteria.rightOperand,
        },
      ],
    },
  };
}

function conditionActionConfigForStep(
  step: IntentStep,
  questions: readonly OpenQuestion[]
): Record<string, unknown> {
  const openQuestion = openConditionQuestionForStep(step, questions);
  if (openQuestion) {
    return {
      actionType: "Condition",
      builderConditionNeedsAnswer: true,
      builderStepKind: step.kind,
    };
  }

  const answeredQuestion = answeredConditionQuestionForStep(step, questions);
  const answerText = Array.isArray(answeredQuestion?.answer)
    ? answeredQuestion.answer.join(", ")
    : answeredQuestion?.answer;
  const criteria = parseConditionCriteriaText(
    typeof answerText === "string" ? `${step.label} ${answerText}` : step.label
  );
  if (!criteria) {
    return {
      actionType: "Condition",
      builderStepKind: step.kind,
    };
  }

  return {
    actionType: "Condition",
    builderStepKind: step.kind,
    condition: `${criteria.leftOperand} ${criteria.operator} ${criteria.rightOperand}`,
    conditionConfig: conditionConfigFromCriteria(criteria, step.id),
  };
}

function configForStep(
  step: IntentStep,
  options: readonly BuilderOption[],
  questions: readonly OpenQuestion[],
  sourceText?: string
): Record<string, unknown> {
  if (step.kind === "trigger") {
    return {
      triggerType: step.label.toLowerCase().includes("every")
        ? "Schedule"
        : "Manual",
    };
  }

  const nativeOption = nativeOptionForStep(step, options);
  const stepContextText = [
    sourceText,
    step.label,
    nativeOption?.title,
    nativeOption?.rationale,
  ]
    .filter(Boolean)
    .join("\n");
  const nativeConfig = nativeActionConfigForOption(
    nativeOption,
    stepContextText
  );
  if (nativeConfig) {
    return {
      ...nativeConfig,
      builderStepKind: step.kind,
    };
  }

  if (step.kind === "condition") {
    return conditionActionConfigForStep(step, questions);
  }

  const actionTypeByKind: Record<IntentStep["kind"], string> = {
    condition: "Condition",
    missing_capability: "HTTP Request",
    notify: notificationActionTypeForStep(step, questions),
    read: "HTTP Request",
    transform: "code/run-code",
    trigger: "Manual",
    write: "HTTP Request",
  };

  const actionType = actionTypeByKind[step.kind];
  return {
    actionType,
    ...(actionType === "webhook/send-webhook"
      ? webhookConfigFromText(stepContextText)
      : {}),
    builderStepKind: step.kind,
  };
}

function nodeForStep({
  className,
  isHighlighted,
  isOptionLane,
  isPreview,
  optionId,
  optionIndex,
  options,
  previewDescription,
  questions,
  sourceText,
  step,
  x,
  y,
}: {
  readonly step: IntentStep;
  readonly x: number;
  readonly y: number;
  readonly isPreview: boolean;
  readonly isHighlighted: boolean;
  readonly isOptionLane?: boolean;
  readonly optionId?: string;
  readonly optionIndex?: number;
  readonly options: readonly BuilderOption[];
  readonly previewDescription?: string;
  readonly questions: readonly OpenQuestion[];
  readonly sourceText?: string;
  readonly className?: string;
}): WorkflowNode {
  const nodeType = workflowTypeForStep(step);
  const conditionNeedsAnswer =
    step.kind === "condition" &&
    Boolean(openConditionQuestionForStep(step, questions));
  const previewClassName = [
    "builder-preview-node",
    isOptionLane ? "builder-option-lane-node" : null,
    isHighlighted
      ? "builder-preview-node-highlighted builder-option-lane-node-highlighted"
      : null,
    className,
  ]
    .filter(Boolean)
    .join(" ");

  return {
    id: step.id,
    connectable: !isPreview,
    data: {
      config: {
        ...configForStep(step, options, questions, sourceText),
        ...(isPreview
          ? {
              builderPreview: true,
              builderPreviewOptionId: optionId,
              builderHighlighted: isHighlighted,
              builderOptionIndex: optionIndex,
              builderOptionLane: isOptionLane === true,
            }
          : {}),
      },
      description: isPreview ? previewDescription : undefined,
      enabled: !isPreview,
      label: step.label,
      status:
        step.status === "blocked" || conditionNeedsAnswer ? "error" : "idle",
      type: nodeType,
    },
    deletable: !isPreview,
    draggable: !isPreview,
    position: { x, y },
    selectable: !isPreview,
    type: nodeType,
    zIndex: isPreview ? 0 : 1,
    ...(isPreview
      ? {
          className: previewClassName,
        }
      : {}),
  };
}

function edgeId(
  source: string,
  target: string,
  variant: "accepted" | "preview",
  optionId?: string
): string {
  return [variant, optionId, source, target].filter(Boolean).join("-");
}

function overlapsAnyNode(
  position: CanvasPosition,
  occupiedPositions: readonly CanvasPosition[]
): boolean {
  return occupiedPositions.some(
    (occupied) =>
      Math.abs(occupied.x - position.x) < NODE_COLLISION_X_GAP &&
      Math.abs(occupied.y - position.y) < NODE_COLLISION_Y_GAP
  );
}

function nearestOpenLane(
  desiredPosition: CanvasPosition,
  occupiedPositions: readonly CanvasPosition[]
): CanvasPosition {
  if (!overlapsAnyNode(desiredPosition, occupiedPositions)) {
    return desiredPosition;
  }

  for (let distance = 1; distance <= 12; distance += 1) {
    const candidates = [
      {
        x: desiredPosition.x,
        y: desiredPosition.y - distance * PREVIEW_Y_GAP,
      },
      {
        x: desiredPosition.x,
        y: desiredPosition.y + distance * PREVIEW_Y_GAP,
      },
    ];
    const openCandidate = candidates.find(
      (candidate) => !overlapsAnyNode(candidate, occupiedPositions)
    );
    if (openCandidate) {
      return openCandidate;
    }
  }

  return {
    x: desiredPosition.x,
    y: desiredPosition.y + (occupiedPositions.length + 1) * PREVIEW_Y_GAP,
  };
}

function previewNodesForBranch(
  branch: CandidateBranchProjection,
  options: ProjectionOptions,
  builderOptions: readonly BuilderOption[],
  optionLanePositions: ReadonlyMap<string, { x: number; y: number }>,
  questions: readonly OpenQuestion[]
): WorkflowNode[] {
  const isHighlighted = options.highlightedOptionId === branch.optionId;
  const basePosition =
    optionLanePositions.get(branch.optionId) ??
    optionLanePositions.get(branch.dashedEdges[0]?.fromStepId ?? "");

  return branch.greyNodes.map((step, index) =>
    nodeForStep({
      isHighlighted,
      isPreview: true,
      optionId: branch.optionId,
      options: builderOptions,
      questions,
      sourceText: options.sourceText,
      step,
      x:
        (basePosition?.x ?? COMMITTED_X + OPTION_LANE_X_GAP) +
        (index + 1) * NODE_X_GAP,
      y: basePosition?.y ?? COMMITTED_Y,
    })
  );
}

function optionStep(
  option: BuilderOption,
  committedSteps: ReadonlyMap<string, IntentStep>,
  upstreamStepId: string | undefined
): IntentStep {
  const sourceStep = committedSteps.get(option.stepId);
  const updateOp = option.patch.ops.find(
    (op) => op.op === "update_step" && op.stepId === option.stepId
  );
  const addedStep = option.patch.ops.find((op) => op.op === "add_step")?.step;
  return {
    dependsOn: upstreamStepId
      ? [upstreamStepId]
      : (sourceStep?.dependsOn ?? []),
    id: `builder-option-${option.id}`,
    kind: sourceStep?.kind ?? addedStep?.kind ?? "read",
    label:
      (updateOp && updateOp.op === "update_step" && updateOp.changes.label) ||
      addedStep?.label ||
      option.title,
    requiredEntityIds:
      sourceStep?.requiredEntityIds ?? addedStep?.requiredEntityIds ?? [],
    status:
      (updateOp && updateOp.op === "update_step" && updateOp.changes.status) ||
      addedStep?.status ||
      "planned",
  };
}

function optionSourceStepId(
  option: BuilderOption,
  committedSteps: ReadonlyMap<string, IntentStep>
): string | undefined {
  return committedSteps.get(option.stepId)?.dependsOn[0];
}

type CommittedEdge = BuilderProjection["committed"]["edges"][number];

function layoutEdgesFor(
  steps: readonly IntentStep[],
  edges: readonly CommittedEdge[]
): readonly CommittedEdge[] {
  const seen = new Set(
    edges.map((edge) => `${edge.fromStepId}->${edge.toStepId}`)
  );
  const inferredEdges = steps.flatMap((step) =>
    step.dependsOn
      .filter((dependencyId) => !seen.has(`${dependencyId}->${step.id}`))
      .map((dependencyId) => ({
        fromStepId: dependencyId,
        toStepId: step.id,
      }))
  );
  const layoutEdges = [...edges, ...inferredEdges];
  const incoming = new Set(layoutEdges.map((edge) => edge.toStepId));
  const sequenceEdges: CommittedEdge[] = [];
  for (let index = 1; index < steps.length; index += 1) {
    const step = steps[index];
    const previous = steps[index - 1];
    if (incoming.has(step.id)) {
      continue;
    }
    sequenceEdges.push({
      fromStepId: previous.id,
      toStepId: step.id,
    });
    incoming.add(step.id);
  }
  return [...layoutEdges, ...sequenceEdges];
}

function cleanCommittedEdges(
  edges: readonly CommittedEdge[]
): readonly CommittedEdge[] {
  const handledPairs = new Set(
    edges
      .filter((edge) => edge.sourceHandle || edge.targetHandle)
      .map((edge) => `${edge.fromStepId}->${edge.toStepId}`)
  );
  const seen = new Set<string>();
  const cleaned: CommittedEdge[] = [];
  for (const edge of edges) {
    const pairKey = `${edge.fromStepId}->${edge.toStepId}`;
    if (
      !(edge.sourceHandle || edge.targetHandle) &&
      handledPairs.has(pairKey)
    ) {
      continue;
    }
    const key = [
      edge.fromStepId,
      edge.sourceHandle ?? "",
      edge.toStepId,
      edge.targetHandle ?? "",
    ].join("->");
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    cleaned.push(edge);
  }
  return cleaned;
}

function committedLayoutPositions(
  steps: readonly IntentStep[],
  edges: readonly CommittedEdge[]
): ReadonlyMap<string, { x: number; y: number }> {
  const stepIds = new Set(steps.map((step) => step.id));
  const incoming = new Map<string, CommittedEdge[]>();
  const outgoing = new Map<string, CommittedEdge[]>();
  for (const edge of edges) {
    if (!(stepIds.has(edge.fromStepId) && stepIds.has(edge.toStepId))) {
      continue;
    }
    incoming.set(edge.toStepId, [...(incoming.get(edge.toStepId) ?? []), edge]);
    outgoing.set(edge.fromStepId, [
      ...(outgoing.get(edge.fromStepId) ?? []),
      edge,
    ]);
  }

  const rankCache = new Map<string, number>();
  const rankForStep = (
    stepId: string,
    visiting = new Set<string>()
  ): number => {
    if (rankCache.has(stepId)) {
      return rankCache.get(stepId) ?? 0;
    }
    if (visiting.has(stepId)) {
      return 0;
    }
    visiting.add(stepId);
    const rank =
      Math.max(
        -1,
        ...(incoming.get(stepId) ?? []).map((edge) =>
          rankForStep(edge.fromStepId, visiting)
        )
      ) + 1;
    visiting.delete(stepId);
    rankCache.set(stepId, rank);
    return rank;
  };

  for (const step of steps) {
    rankForStep(step.id);
  }

  const byRank = new Map<number, IntentStep[]>();
  for (const step of steps) {
    const rank = rankCache.get(step.id) ?? 0;
    byRank.set(rank, [...(byRank.get(rank) ?? []), step]);
  }

  const positions = new Map<string, { x: number; y: number }>();
  for (const [rank, rankedSteps] of byRank) {
    rankedSteps.forEach((step, index) => {
      const offset = (index - (rankedSteps.length - 1) / 2) * BRANCH_Y_GAP;
      positions.set(step.id, {
        x: COMMITTED_X + rank * NODE_X_GAP,
        y: COMMITTED_Y + offset,
      });
    });
  }

  for (const step of steps) {
    const branchEdges = (outgoing.get(step.id) ?? []).filter((edge) =>
      ["false", "true"].includes(edge.sourceHandle ?? "")
    );
    if (branchEdges.length < 2) {
      continue;
    }
    const sourcePosition = positions.get(step.id);
    if (!sourcePosition) {
      continue;
    }
    for (const edge of branchEdges) {
      const targetPosition = positions.get(edge.toStepId);
      if (!targetPosition) {
        continue;
      }
      positions.set(edge.toStepId, {
        ...targetPosition,
        y:
          sourcePosition.y +
          (edge.sourceHandle === "true" ? -BRANCH_Y_GAP : BRANCH_Y_GAP),
      });
    }
  }

  return positions;
}

export function projectBuilderToCanvas(
  projection: BuilderProjection,
  options: ProjectionOptions = {}
): BuilderCanvasProjection {
  const allOpenBranches = projection.candidateBranches.filter(
    (branch) => branch.status === "open"
  );
  const hasSelectedBranch = projection.candidateBranches.some(
    (branch) => branch.status === "selected"
  );
  const allOpenOptionIds = new Set(
    allOpenBranches.map((branch) => branch.optionId)
  );
  const allOpenOptions = projection.options.filter((option) =>
    allOpenOptionIds.has(option.id)
  );
  const defaultHighlightedOptionId = hasSelectedBranch
    ? null
    : allOpenOptions.reduce<string | null>((recommendedId, option) => {
        if (recommendedId === null) {
          return option.id;
        }
        const recommendedOption = allOpenOptions.find(
          (candidate) => candidate.id === recommendedId
        );
        return option.confidence > (recommendedOption?.confidence ?? 0)
          ? option.id
          : recommendedId;
      }, null);
  const highlightedOptionId =
    options.highlightedOptionId ?? defaultHighlightedOptionId;
  const openBranches = allOpenBranches;
  const openOptionIds = new Set(openBranches.map((branch) => branch.optionId));
  const openOptions = allOpenOptions.filter((option) =>
    openOptionIds.has(option.id)
  );
  const projectionOptions = {
    highlightedOptionId,
    sourceText: options.sourceText,
  };
  const committedSteps = new Map(
    projection.committed.nodes.map((step) => [step.id, step])
  );
  const optionStepIds = new Set(openOptions.map((option) => option.stepId));
  const committedEdges = cleanCommittedEdges(projection.committed.edges);
  const layoutPositions = committedLayoutPositions(
    projection.committed.nodes,
    layoutEdgesFor(projection.committed.nodes, committedEdges)
  );

  const committedNodes = projection.committed.nodes.flatMap((step) => {
    if (optionStepIds.has(step.id) && step.kind !== "trigger") {
      return [];
    }
    const position = layoutPositions.get(step.id) ?? {
      x: COMMITTED_X,
      y: COMMITTED_Y,
    };
    return [
      nodeForStep({
        isHighlighted: false,
        isPreview: false,
        options: projection.options,
        questions: projection.questions,
        sourceText: options.sourceText,
        step,
        x: position.x,
        y: position.y,
      }),
    ];
  });
  const committedPositions = new Map(
    committedNodes.map((node) => [node.id, node.position])
  );
  const occupiedPositions: CanvasPosition[] = committedNodes.map(
    (node) => node.position
  );
  const optionLanePositions = new Map<string, { x: number; y: number }>();
  const optionNodes = openOptions.map((option, index) => {
    const upstreamStepId = optionSourceStepId(option, committedSteps);
    const sourcePosition =
      upstreamStepId === undefined
        ? undefined
        : committedPositions.get(upstreamStepId);
    const branchOffset =
      (index - Math.max(0, openOptions.length - 1) / 2) * PREVIEW_Y_GAP;
    const position = {
      x: (sourcePosition?.x ?? COMMITTED_X) + OPTION_LANE_X_GAP,
      y: (sourcePosition?.y ?? COMMITTED_Y) + branchOffset,
    };
    const resolvedPosition = nearestOpenLane(position, occupiedPositions);
    occupiedPositions.push(resolvedPosition);
    optionLanePositions.set(option.id, resolvedPosition);
    const step = optionStep(option, committedSteps, upstreamStepId);
    return nodeForStep({
      className: `builder-option-lane-${index + 1}`,
      isHighlighted: highlightedOptionId === option.id,
      isOptionLane: true,
      isPreview: true,
      optionId: option.id,
      optionIndex: index + 1,
      options: [option],
      questions: projection.questions,
      sourceText: options.sourceText,
      step,
      x: resolvedPosition.x,
      y: resolvedPosition.y,
    });
  });

  const previewNodes = openBranches.flatMap((branch) => {
    const branchPreviewNodes = previewNodesForBranch(
      branch,
      projectionOptions,
      projection.options,
      optionLanePositions,
      projection.questions
    );
    return branchPreviewNodes.map((node) => {
      const position = nearestOpenLane(node.position, occupiedPositions);
      occupiedPositions.push(position);
      return { ...node, position };
    });
  });

  const acceptedEdges = committedEdges
    .filter(
      (edge) =>
        !(
          optionStepIds.has(edge.fromStepId) || optionStepIds.has(edge.toStepId)
        )
    )
    .map((edge) => ({
      id: edgeId(edge.fromStepId, edge.toStepId, "accepted"),
      source: edge.fromStepId,
      sourceHandle: edge.sourceHandle,
      target: edge.toStepId,
      targetHandle: edge.targetHandle,
      type: "animated",
    }));

  const optionEdges = openOptions.flatMap((option, index) => {
    const source = optionSourceStepId(option, committedSteps);
    if (!source) {
      return [];
    }
    const isHighlighted = highlightedOptionId === option.id;
    return [
      {
        id: edgeId(source, `builder-option-${option.id}`, "preview", option.id),
        data: {
          builderHighlighted: isHighlighted,
          builderPreview: true,
          builderPreviewOptionId: option.id,
          builderOptionIndex: index + 1,
          builderOptionLane: true,
        },
        source,
        style: {
          opacity: isHighlighted ? 1 : 0.35,
          stroke: isHighlighted ? "var(--primary)" : "var(--border)",
          strokeWidth: isHighlighted ? 2.5 : 1.5,
        },
        target: `builder-option-${option.id}`,
        type: "temporary",
      },
    ];
  });

  const visibleNodeIds = new Set(
    [...committedNodes, ...optionNodes, ...previewNodes].map((node) => node.id)
  );
  const previewEdges = openBranches.flatMap((branch) =>
    branch.dashedEdges.flatMap((edge) => {
      const source =
        edge.fromStepId ===
        projection.options.find((option) => option.id === branch.optionId)
          ?.stepId
          ? `builder-option-${branch.optionId}`
          : edge.fromStepId;
      if (!(visibleNodeIds.has(source) && visibleNodeIds.has(edge.toStepId))) {
        return [];
      }
      return [
        {
          id: edgeId(
            edge.fromStepId,
            edge.toStepId,
            "preview",
            branch.optionId
          ),
          data: {
            builderHighlighted: highlightedOptionId === branch.optionId,
            builderPreview: true,
            builderPreviewOptionId: branch.optionId,
            builderOptionLane: true,
          },
          source,
          sourceHandle: edge.sourceHandle,
          style: {
            opacity: highlightedOptionId === branch.optionId ? 0.9 : 0.3,
            stroke:
              highlightedOptionId === branch.optionId
                ? "var(--primary)"
                : "var(--border)",
          },
          target: edge.toStepId,
          targetHandle: edge.targetHandle,
          type: "temporary",
        },
      ];
    })
  );

  return {
    edges: [...acceptedEdges, ...optionEdges, ...previewEdges],
    nodes: [...committedNodes, ...optionNodes, ...previewNodes],
  };
}

export function isBuilderPreviewNode(node: WorkflowNode): boolean {
  return node.data.config?.builderPreview === true;
}

export function isBuilderPreviewEdge(edge: WorkflowEdge): boolean {
  const data = edge.data as Record<string, unknown> | undefined;
  return (
    data?.builderPreview === true ||
    edge.type === "temporary" ||
    edge.id.startsWith("preview-")
  );
}

export function filterBuilderPreviewGraph({
  edges,
  nodes,
}: BuilderCanvasProjection): BuilderCanvasProjection {
  return {
    edges: edges.filter((edge) => !isBuilderPreviewEdge(edge)),
    nodes: nodes.filter((node) => !isBuilderPreviewNode(node)),
  };
}
