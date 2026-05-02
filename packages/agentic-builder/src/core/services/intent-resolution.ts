import type {
  BuilderIntentIR,
  ContentKind,
  DynamicRequirement,
  DynamicRequirementKind,
  IntentConstraint,
  IntentPlan,
  IntentRequirement,
  IntentResolution,
} from "../schemas/all";
import { builderIntentIRSchema, intentResolutionSchema } from "../schemas/all";

const COMPOSITE_SEPARATOR_PATTERN = /\s*(?:,|;|\b(?:and|then|plus)\b)\s*/;

const DESTRUCTIVE_OPERATIONS = new Set([
  "delete",
  "publish",
  "swap",
  "transfer",
  "update",
  "write",
]);
const DESTRUCTIVE_WORDS = [...DESTRUCTIVE_OPERATIONS, "edit", "remove"];

export function resolveIntentConstraints(
  intentPlan: IntentPlan
): IntentResolution {
  const promptText = normalizeText(intentPlan.sourceText);
  const promptEvidencedEntities = intentPlan.entities.filter((entity) =>
    entityHasPromptEvidence(entity, promptText)
  );
  const sourceText = [
    intentPlan.sourceText,
    ...promptEvidencedEntities.flatMap((entity) =>
      entity.kind === "channel" && !entity.canonicalValue
        ? []
        : [entity.canonicalValue ?? entity.label]
    ),
  ].join(" ");
  const text = normalizeText(sourceText);
  const requiredEntities: IntentConstraint[] = [];
  const optionalEntities: IntentConstraint[] = [];
  const taskHints = new Set<string>();

  for (const entity of promptEvidencedEntities) {
    if (entity.kind === "schedule") {
      optionalEntities.push({
        interval: entity.canonicalValue ?? entity.label,
        required: true,
        sourceEntityId: entity.id,
        type: "schedule",
      });
      taskHints.add("schedule");
    }
  }

  const explicitAssets = findExplicitAssets(
    { ...intentPlan, entities: promptEvidencedEntities },
    text
  );
  const isPriceIntent = hasAny(promptText, ["price", "usd", "feed", "value"]);
  const explicitAssetPairs = isPriceIntent
    ? findExplicitAssetPairs(promptText)
    : [];
  const pairedAssetSymbols = new Set(
    explicitAssetPairs.flatMap((pair) => [pair.base, pair.quote])
  );
  for (const pair of explicitAssetPairs) {
    requiredEntities.push({
      base: pair.base,
      quote: pair.quote,
      required: true,
      type: "asset_pair",
    });
    taskHints.add("price_feed");
  }
  for (const asset of explicitAssets) {
    if (
      !isPriceIntent ||
      pairedAssetSymbols.has(asset.symbol) ||
      !assetHasPriceContext(promptText, asset.symbol)
    ) {
      continue;
    }
    requiredEntities.push({
      base: asset.symbol,
      quote: findQuoteForAsset(promptText, asset.symbol) ?? "USD",
      required: true,
      sourceEntityId: asset.sourceEntityId,
      type: "asset_pair",
    });
    taskHints.add("price_feed");
  }

  const providers = findProviders(promptText);
  const operations = findOperations(promptText);
  const contentKinds = resolveContentKinds(promptText);
  const notificationChannels = mentionedNotificationProviders(promptText);
  for (const provider of providers) {
    if (notificationChannels.includes(provider)) {
      continue;
    }
    if (!shouldCreateProviderConstraint(provider, text)) {
      continue;
    }
    requiredEntities.push({
      provider,
      required: true,
      type: "provider",
    });
    taskHints.add(`provider:${provider}`);
  }

  const orderedNotificationChannels =
    orderNotificationChannels(notificationChannels);
  if (orderedNotificationChannels.length > 1) {
    for (const channel of orderedNotificationChannels) {
      requiredEntities.push({
        channel,
        required: true,
        type: "notification",
      });
    }
    taskHints.add("notification");
  } else if (orderedNotificationChannels.length === 1) {
    requiredEntities.push({
      channel: orderedNotificationChannels[0],
      required: true,
      type: "notification",
    });
    taskHints.add("notification");
  } else if (hasAny(text, ["alert", "notification", "notify"])) {
    requiredEntities.push({
      required: true,
      type: "notification",
    });
    taskHints.add("notification");
  }

  for (const operation of operations) {
    if (!shouldCreateOperationConstraint(operation, text)) {
      continue;
    }
    requiredEntities.push({
      operation,
      required: true,
      type: "operation",
    });
    taskHints.add(`operation:${operation}`);
  }

  for (const resource of findResources(promptText)) {
    requiredEntities.push({
      required: true,
      resource,
      type: "resource",
    });
    taskHints.add(`resource:${resource}`);
  }

  for (const contentKind of contentKinds) {
    requiredEntities.push({
      contentKind,
      required: true,
      type: "content_kind",
    });
    taskHints.add(`content:${contentKind}`);
  }

  const destructive = DESTRUCTIVE_WORDS.some((word) =>
    containsWord(promptText, word)
  );
  if (destructive) {
    requiredEntities.push({
      destructive: true,
      required: true,
      type: "destructive_intent",
    });
    taskHints.add("destructive");
  }

  const dedupedRequiredEntities = dedupeConstraints(requiredEntities);
  const requirements = buildIntentRequirements(
    intentPlan,
    dedupedRequiredEntities,
    optionalEntities,
    {
      missingAsset:
        isPriceIntent &&
        explicitAssetPairs.length === 0 &&
        explicitAssets.length === 0,
    }
  );
  const intentIR = deriveBuilderIntentIR(
    intentPlan,
    dedupedRequiredEntities,
    promptEvidencedEntities
  );
  const dynamicRequirements = [
    ...dynamicRequirementsFromLegacy(requirements, intentPlan.sourceText),
    ...dynamicWebhookRequirements(intentPlan),
    ...dynamicConditionRequirements(
      intentPlan,
      requirements,
      dedupedRequiredEntities,
      intentIR
    ),
    ...dynamicRequirementsFromIntentIR(intentPlan, intentIR),
  ];
  const dynamicRequirementsByAction = new Map<string, string[]>();
  for (const requirement of dynamicRequirements) {
    dynamicRequirementsByAction.set(requirement.appliesTo, [
      ...(dynamicRequirementsByAction.get(requirement.appliesTo) ?? []),
      requirement.id,
    ]);
  }
  const actions = intentPlan.steps.map((step) => ({
    id: step.id,
    kind: step.kind,
    requirementIds: requirements
      .filter((requirement) => requirement.appliesTo === step.id)
      .map((requirement) => requirement.id)
      .concat(dynamicRequirementsByAction.get(step.id) ?? []),
    title: step.label,
  }));

  return intentResolutionSchema.parse({
    actions,
    dynamicRequirements,
    intentIR,
    intentPlanId: intentPlan.id,
    optionalEntities,
    requiredEntities: dedupedRequiredEntities,
    requirements,
    sourceText: intentPlan.sourceText,
    taskHints: [...taskHints],
  });
}

export function normalizeIntentPlanForIntentIR(
  intentPlan: IntentPlan
): IntentPlan {
  const intentIR = deriveBuilderIntentIR(intentPlan, [], intentPlan.entities);
  if (!intentIR) {
    return intentPlan;
  }
  let steps = intentPlan.steps.map((step) => {
    const label = normalizeText(step.label);
    if (
      containsPhrase(label, "repeat every") ||
      containsPhrase(label, "poll fresh") ||
      containsPhrase(label, "every 5 seconds") ||
      containsPhrase(label, "5-second") ||
      containsPhrase(label, "5 second") ||
      containsPhrase(label, "30 seconds") ||
      containsPhrase(label, "interval")
    ) {
      return step.kind === "read" || containsPhrase(step.label, "$0.10")
        ? step
        : { ...step, kind: "transform" as const, status: "blocked" as const };
    }
    if (
      hasAny(label, ["cache", "cached", "baseline", "reference"]) &&
      step.kind !== "condition" &&
      step.kind !== "read"
    ) {
      return {
        ...step,
        kind: "transform" as const,
        status: "blocked" as const,
      };
    }
    if (hasAny(label, ["log", "record"])) {
      return {
        ...step,
        kind: "transform" as const,
        status: "blocked" as const,
      };
    }
    if (hasAny(label, ["telegram"])) {
      return { ...step, kind: "notify" as const };
    }
    if (step.kind !== "condition" && containsPhrase(label, "fresh eth price")) {
      return { ...step, kind: "read" as const };
    }
    return step;
  });

  const baselineStep = steps.find((step) => {
    const label = normalizeText(step.label);
    return (
      step.kind !== "condition" &&
      (hasAny(label, ["cache", "cached", "baseline"]) ||
        containsPhrase(label, "fixed constant"))
    );
  });
  const triggerStep = steps.find((step) => step.kind === "trigger");
  const initialReadStep = steps.find((step) => {
    const label = normalizeText(step.label);
    return (
      step.id !== baselineStep?.id &&
      step.kind === "read" &&
      (containsPhrase(label, "current eth") ||
        containsPhrase(label, "current market") ||
        containsPhrase(label, "current price") ||
        containsPhrase(label, "initial eth") ||
        containsPhrase(label, "initial price")) &&
      !containsPhrase(label, "fresh") &&
      !containsPhrase(label, "every 5 seconds") &&
      !containsPhrase(label, "30 seconds")
    );
  });
  const freshStep =
    steps.find((step) => {
      const label = normalizeText(step.label);
      return (
        step.kind === "read" &&
        (containsPhrase(label, "fresh eth price") ||
          containsPhrase(label, "every 5 seconds") ||
          containsPhrase(label, "30 seconds"))
      );
    }) ??
    steps.find((step) => {
      const label = normalizeText(step.label);
      return (
        step.kind !== "condition" &&
        (containsPhrase(label, "fresh eth price") ||
          containsPhrase(label, "every 5 seconds") ||
          containsPhrase(label, "30 seconds"))
      );
    });
  const conditionCandidates = steps.filter((step) => {
    const label = normalizeText(step.label);
    return (
      step.kind === "condition" &&
      (containsPhrase(step.label, "$0.10") ||
        containsPhrase(label, "cached") ||
        containsPhrase(label, "baseline") ||
        containsPhrase(label, "moved by"))
    );
  });
  const conditionStep = conditionCandidates[0];
  const hasFalseLog = intentIR.branches.some(
    (branch) => branch.when === "false" && branch.action === "log"
  );
  const hasTrueNotify = intentIR.branches.some(
    (branch) => branch.when === "true" && branch.action === "notify"
  );
  const hasLogStep = steps.some((step) =>
    hasAny(normalizeText(step.label), ["log", "record"])
  );
  const hasNotifyStep = steps.some((step) => step.kind === "notify");
  if (conditionStep && hasTrueNotify && !hasNotifyStep) {
    steps = [
      ...steps,
      {
        dependsOn: [conditionStep.id],
        id: `${conditionStep.id}-true-notify`,
        kind: "notify",
        label: "Send Telegram alert when ETH price moves by at least $0.10",
        requiredEntityIds: [],
        status: "ready",
      },
    ];
  }
  if (conditionStep && hasFalseLog && !hasLogStep) {
    steps = [
      ...steps,
      {
        dependsOn: [conditionStep.id],
        id: `${conditionStep.id}-false-log`,
        kind: "transform",
        label: "Log the price when the threshold is not met",
        requiredEntityIds: [],
        status: "blocked",
      },
    ];
  }
  const hasAbsoluteDeltaCondition =
    intentIR.conditions[0]?.kind === "absolute_delta" ||
    Boolean(
      conditionStep &&
        parseAbsoluteDeltaCriteria(
          `${intentPlan.sourceText} ${conditionStep.label}`
        )
    );
  if (conditionStep && hasAbsoluteDeltaCondition) {
    const duplicateConditionIds = new Set(
      conditionCandidates.slice(1).map((step) => step.id)
    );
    const idRedirect = new Map(
      [...duplicateConditionIds].map((id) => [id, conditionStep.id])
    );
    steps = steps
      .filter((step) => !duplicateConditionIds.has(step.id))
      .map((step) => {
        const nextDependsOn = step.dependsOn
          .map((dependencyId) => idRedirect.get(dependencyId) ?? dependencyId)
          .filter(
            (dependencyId, index, all) => all.indexOf(dependencyId) === index
          );
        if (initialReadStep && step.id === initialReadStep.id) {
          return {
            ...step,
            dependsOn:
              nextDependsOn.length > 0
                ? nextDependsOn
                : triggerStep
                  ? [triggerStep.id]
                  : [],
          };
        }
        if (baselineStep && step.id === baselineStep.id) {
          return {
            ...step,
            dependsOn: initialReadStep
              ? [initialReadStep.id]
              : triggerStep
                ? [triggerStep.id]
                : [],
          };
        }
        if (freshStep && step.id === freshStep.id) {
          return {
            ...step,
            dependsOn: baselineStep ? [baselineStep.id] : nextDependsOn,
          };
        }
        if (step.id === conditionStep.id) {
          return {
            ...step,
            dependsOn: freshStep
              ? [freshStep.id]
              : baselineStep
                ? [baselineStep.id]
                : nextDependsOn,
          };
        }
        if (
          step.kind === "notify" ||
          hasAny(normalizeText(step.label), ["log", "record"])
        ) {
          return { ...step, dependsOn: [conditionStep.id] };
        }
        return { ...step, dependsOn: nextDependsOn };
      })
      .sort((left, right) => {
        const rank = (step: IntentPlan["steps"][number]) => {
          const label = normalizeText(step.label);
          if (step.kind === "trigger") {
            return 0;
          }
          if (initialReadStep && step.id === initialReadStep.id) {
            return 1;
          }
          if (baselineStep && step.id === baselineStep.id) {
            return 2;
          }
          if (freshStep && step.id === freshStep.id) {
            return 3;
          }
          if (step.id === conditionStep.id) {
            return 4;
          }
          if (step.kind === "notify") {
            return 5;
          }
          if (hasAny(label, ["log", "record"])) {
            return 6;
          }
          return 7;
        };
        return rank(left) - rank(right);
      });
  }
  return { ...intentPlan, steps };
}

type ParsedConditionCriteria =
  | {
      readonly kind: "price_threshold";
      readonly operator: "<" | "<=" | ">" | ">=";
      readonly threshold: number;
      readonly unit: string;
    }
  | {
      readonly kind: "percent_change";
      readonly operator: ">";
      readonly threshold: number;
      readonly unit: "%";
      readonly baseline: "initial_value" | "previous_run";
    }
  | {
      readonly baselineRef: string;
      readonly freshRef: string;
      readonly kind: "absolute_delta";
      readonly metric: string;
      readonly operator: ">=";
      readonly threshold: number;
      readonly unit: string;
    };

function dynamicConditionRequirements(
  intentPlan: IntentPlan,
  requirements: readonly IntentRequirement[],
  requiredEntities: readonly IntentConstraint[],
  intentIR: BuilderIntentIR | undefined
): DynamicRequirement[] {
  const explicitConditionSteps = intentPlan.steps.filter(
    (step) =>
      step.kind === "condition" &&
      !isTemporalCountCondition(step.label) &&
      !isOperationalGuardCondition(step.label)
  );
  const conditionSteps =
    explicitConditionSteps.length > 0
      ? explicitConditionSteps
      : intentPlan.steps.filter((step) => conditionLikeText(step.label));
  if (conditionSteps.length === 0) {
    return [];
  }

  const assetLabel = assetLabelForQuestion(
    requirements,
    requiredEntities,
    intentPlan
  );
  const seenQuestionPrompts = new Set<string>();
  const conditionRequirements: DynamicRequirement[] = [];
  for (const step of conditionSteps) {
    const evidenceText = `${intentPlan.sourceText} ${step.label}`;
    const parsed =
      conditionCriteriaFromIntentIR(intentIR) ??
      parseConditionCriteria(evidenceText);
    const questionId = `question-condition-criteria-${step.id}`;
    const base = {
      appliesTo: step.id,
      cardinality: "single" as const,
      evidence: [
        {
          source: "prompt" as const,
          text: intentPlan.sourceText,
        },
      ],
      id: `dynamic-condition-criteria-${step.id}`,
      key: "condition.criteria",
      label: "Condition Criteria",
      requirementKind:
        parsed?.kind === "absolute_delta"
          ? ("condition.delta" as const)
          : ("condition.compare" as const),
      source: "planner" as const,
    };

    if (parsed) {
      conditionRequirements.push({
        ...base,
        status: "satisfied" as const,
        value: parsed,
      });
      continue;
    }

    const prompt = assetLabel
      ? `What counts as a significant move for ${assetLabel}?`
      : "What condition should be used?";
    const questionKey = normalizeText(prompt);
    if (seenQuestionPrompts.has(questionKey)) {
      continue;
    }
    seenQuestionPrompts.add(questionKey);
    conditionRequirements.push({
      ...base,
      question: {
        answerType: "text" as const,
        cardinality: "single" as const,
        choices: [
          "More than 5%",
          "More than $100",
          "Above a price",
          "Below a price",
        ],
        id: questionId,
        prompt,
      },
      status: "missing" as const,
    });
  }
  return conditionRequirements;
}

function conditionLikeText(text: string): boolean {
  const normalized = normalizeText(text);
  return (
    hasAny(normalized, ["if", "when", "condition", "threshold"]) &&
    (hasVagueConditionText(text) || Boolean(parseConditionCriteria(text)))
  );
}

function isTemporalCountCondition(text: string): boolean {
  const normalized = normalizeText(text);
  return (
    (hasAny(normalized, ["run", "repeat", "count", "times", "finish"]) &&
      /\b\d+\s+times?\b/i.test(text)) ||
    (hasAny(normalized, [
      "count",
      "loop",
      "looping",
      "notification",
      "notifications",
      "reached",
    ]) &&
      /\b\d+\b/.test(text)) ||
    containsPhrase(normalized, "run 3 times")
  );
}

function isOperationalGuardCondition(text: string): boolean {
  const normalized = normalizeText(text);
  return hasAny(normalized, [
    "available",
    "completed",
    "failed",
    "failure",
    "fetched",
    "read succeeded",
    "succeeded",
    "success",
  ]);
}

function hasVagueConditionText(text: string): boolean {
  const normalized = normalizeText(text);
  return (
    hasAny(normalized, [
      "abnormal",
      "interesting",
      "large",
      "significant",
      "significantly",
      "spike",
      "spikes",
      "unusual",
    ]) ||
    containsPhrase(normalized, "a lot") ||
    containsPhrase(normalized, "large move") ||
    containsPhrase(normalized, "moves a lot") ||
    containsPhrase(normalized, "drops a lot")
  );
}

function parseConditionCriteria(text: string): ParsedConditionCriteria | null {
  const absoluteDelta = parseAbsoluteDeltaCriteria(text);
  if (absoluteDelta) {
    return absoluteDelta;
  }
  const normalized = normalizeText(text);
  const percentMatch =
    /\b(?:moves?|changes?|change|drops?|rises?|spikes?)\s+(?:by\s+)?(?:more\s+than|over|above|greater\s+than)\s+(\d+(?:\.\d+)?)\s*(?:%|percent)/i.exec(
      text
    ) ??
    /\b(?:more\s+than|over|above|greater\s+than)\s+(\d+(?:\.\d+)?)\s*(?:%|percent)/i.exec(
      text
    );
  if (percentMatch?.[1]) {
    return {
      baseline: "previous_run",
      kind: "percent_change",
      operator: ">",
      threshold: Number(percentMatch[1]),
      unit: "%",
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
    const directionText = priceThresholdMatch[0].toLowerCase();
    const operator =
      hasAny(normalized, ["above", "over", "greater", "rises", "goes"]) &&
      !hasAny(normalized, ["below", "under", "less", "drops", "falls"])
        ? ">"
        : "<";
    return {
      kind: "price_threshold",
      operator,
      threshold: Number(priceThresholdMatch[1]),
      unit:
        priceThresholdMatch[2]?.toUpperCase().replace("DOLLARS", "USD") ??
        (directionText.includes("$") ? "USD" : "USD"),
    };
  }

  return null;
}

function parseAbsoluteDeltaCriteria(
  text: string,
  assetPair?: { readonly base: string; readonly quote: string }
): Extract<ParsedConditionCriteria, { kind: "absolute_delta" }> | null {
  if (!/\b(?:cached|baseline|reference|initial|constant)\b/i.test(text)) {
    return null;
  }
  const match =
    /\b(?:moves?|changes?|differs?|delta|difference)\s+(?:by\s+)?(?:at\s+least\s+|more\s+than\s+|over\s+)?\$?(\d+(?:\.\d+)?)\s*(usd|usdc|dollars?)?\b/i.exec(
      text
    ) ??
    /\$?(\d+(?:\.\d+)?)\s*(usd|usdc|dollars?)?\s+(?:from|against|compared\s+to)\s+(?:the\s+)?(?:cached|baseline|reference|initial|constant)/i.exec(
      text
    );
  if (!match?.[1]) {
    return null;
  }
  const pair = assetPair ?? assetPairFromText(text);
  const base = pair?.base ?? "VALUE";
  const quote = pair?.quote ?? "USD";
  return {
    baselineRef: valueRefForAsset("baseline", base, quote),
    freshRef: valueRefForAsset("fresh", base, quote),
    kind: "absolute_delta",
    metric: `${base}/${quote}`,
    operator: ">=",
    threshold: Number(match[1]),
    unit: match[2]?.toUpperCase().replace("DOLLARS", "USD") ?? "USD",
  };
}

function conditionCriteriaFromIntentIR(
  intentIR: BuilderIntentIR | undefined
): ParsedConditionCriteria | null {
  const condition = intentIR?.conditions[0];
  if (!condition) {
    return null;
  }
  if (condition.kind === "price_threshold") {
    return {
      kind: "price_threshold",
      operator: condition.operator,
      threshold: condition.threshold,
      unit: condition.unit,
    };
  }
  if (condition.kind === "percent_delta") {
    return {
      baseline: condition.baseline,
      kind: "percent_change",
      operator: ">",
      threshold: condition.threshold,
      unit: "%",
    };
  }
  return {
    baselineRef: condition.baselineRef,
    freshRef: condition.freshRef,
    kind: "absolute_delta",
    metric: condition.metric,
    operator: condition.operator === ">" ? ">=" : condition.operator,
    threshold: condition.threshold,
    unit: condition.unit,
  };
}

function deriveBuilderIntentIR(
  intentPlan: IntentPlan,
  requiredEntities: readonly IntentConstraint[],
  entities: readonly IntentPlan["entities"][number][]
): BuilderIntentIR | undefined {
  const sourceText = intentPlan.sourceText;
  const normalized = normalizeText(sourceText);
  const assetPairs = requiredEntities.flatMap((constraint) =>
    constraint.type === "asset_pair"
      ? [{ base: constraint.base, quote: constraint.quote }]
      : []
  );
  const explicitAssets = assetPairs.length
    ? assetPairs
    : entities.flatMap((entity) =>
        entity.kind === "asset"
          ? [
              {
                base:
                  normalizeAssetSymbol(entity.canonicalValue ?? entity.label) ??
                  entity.label,
                quote: "USD",
              },
            ]
          : []
      );
  const primaryAssetPair = explicitAssets[0];
  const usesCachedBaseline =
    hasAny(normalized, ["cache", "cached", "baseline", "reference"]) ||
    containsPhrase(normalized, "fixed constant");
  const absoluteDelta = parseAbsoluteDeltaCriteria(
    sourceText,
    primaryAssetPair
  );
  const intervalSeconds = extractSeconds(
    sourceText,
    /\bevery\s+(\d+)\s+seconds?\b/i
  );
  const durationSeconds = extractSeconds(
    sourceText,
    /\bfor\s+(\d+)\s+seconds?\b/i
  );
  const hasFalseLog =
    /\bif\s+not\b/i.test(sourceText) && hasAny(normalized, ["log", "record"]);
  const hasTelegram = hasAny(normalized, ["telegram"]);
  if (
    !(usesCachedBaseline || absoluteDelta) &&
    intervalSeconds === undefined &&
    durationSeconds === undefined &&
    !hasFalseLog
  ) {
    return undefined;
  }
  return builderIntentIRSchema.parse({
    assetPairs: explicitAssets,
    branches: [
      ...(absoluteDelta && hasTelegram
        ? [
            {
              action: "notify" as const,
              conditionId: "condition-price-delta",
              id: "branch-price-delta-true",
              target: "telegram",
              when: "true" as const,
            },
          ]
        : []),
      ...(absoluteDelta && hasFalseLog
        ? [
            {
              action: "log" as const,
              conditionId: "condition-price-delta",
              id: "branch-price-delta-false",
              when: "false" as const,
            },
          ]
        : []),
    ],
    conditions: absoluteDelta
      ? [
          {
            baselineRef: absoluteDelta.baselineRef,
            freshRef: absoluteDelta.freshRef,
            id: "condition-price-delta",
            kind: "absolute_delta",
            metric: absoluteDelta.metric,
            operator: absoluteDelta.operator,
            threshold: absoluteDelta.threshold,
            unit: absoluteDelta.unit,
          },
        ]
      : [],
    id: `intent-ir-${intentPlan.id}`,
    state: usesCachedBaseline
      ? [
          {
            id: valueRefForAsset(
              "baseline",
              primaryAssetPair?.base ?? "VALUE",
              primaryAssetPair?.quote ?? "USD"
            ),
            mutability: "constant",
            source: primaryAssetPair
              ? `current ${primaryAssetPair.base}/${primaryAssetPair.quote} price`
              : "current price",
            timing: "before_loop",
          },
          {
            id: valueRefForAsset(
              "fresh",
              primaryAssetPair?.base ?? "VALUE",
              primaryAssetPair?.quote ?? "USD"
            ),
            mutability: "mutable",
            source: primaryAssetPair
              ? `fresh ${primaryAssetPair.base}/${primaryAssetPair.quote} price`
              : "fresh price",
            timing: "inside_loop",
          },
        ]
      : [],
    temporal:
      intervalSeconds || durationSeconds
        ? [
            {
              durationSeconds,
              id: "bounded-price-poll",
              intervalSeconds,
              mode: durationSeconds ? "bounded_loop" : "unbounded_loop",
            },
          ]
        : [],
  });
}

function dynamicRequirementsFromIntentIR(
  intentPlan: IntentPlan,
  intentIR: BuilderIntentIR | undefined
): DynamicRequirement[] {
  if (!intentIR) {
    return [];
  }
  const evidence = [{ source: "prompt" as const, text: intentPlan.sourceText }];
  const firstStepId = intentPlan.steps[0]?.id ?? intentPlan.id;
  return [
    ...intentIR.state.map((item) => ({
      appliesTo: findStepIdByLabel(intentPlan, [
        item.id,
        item.source,
        "cache",
        "cached",
        "baseline",
      ]),
      cardinality: "single" as const,
      evidence,
      id: `dynamic-state-${item.id}`,
      key: `state.${item.id}`,
      label: labelForStateRequirement(item),
      requirementKind:
        item.timing === "before_loop"
          ? ("state.capture" as const)
          : ("state.reference" as const),
      source: "planner" as const,
      status: "satisfied" as const,
      value: jsonSafeValue(item),
    })),
    ...intentIR.temporal.map((item) => ({
      appliesTo: findStepIdByLabel(intentPlan, [
        "every",
        "seconds",
        "poll",
        "repeat",
      ]),
      cardinality: "single" as const,
      evidence,
      id: `dynamic-temporal-${item.id}`,
      key: "temporal.bounded_loop",
      label: "Bounded Polling Window",
      requirementKind: item.durationSeconds
        ? ("temporal.duration" as const)
        : ("temporal.repeat" as const),
      source: "planner" as const,
      status: "unsupported" as const,
      value: jsonSafeValue(item),
    })),
    ...intentIR.branches.map((item) => ({
      appliesTo:
        findStepIdByLabel(intentPlan, [item.action, item.target ?? ""]) ??
        firstStepId,
      cardinality: "single" as const,
      evidence,
      id: `dynamic-branch-${item.id}`,
      key: `branch.${item.when}`,
      label: item.when === "true" ? "True Branch" : "False Branch",
      requirementKind:
        item.when === "true"
          ? ("branch.true" as const)
          : ("branch.false" as const),
      source: "planner" as const,
      status:
        item.action === "log"
          ? ("unsupported" as const)
          : ("satisfied" as const),
      value: jsonSafeValue(item),
    })),
  ];
}

function jsonSafeValue<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map(jsonSafeValue) as T;
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).flatMap(([key, item]) =>
        item === undefined ? [] : [[key, jsonSafeValue(item)]]
      )
    ) as T;
  }
  return value;
}

function dynamicWebhookRequirements(
  intentPlan: IntentPlan
): DynamicRequirement[] {
  const normalized = normalizeText(intentPlan.sourceText);
  if (
    !hasAny(normalized, ["webhook"]) ||
    /\bhttps?:\/\//i.test(intentPlan.sourceText)
  ) {
    return [];
  }
  const appliesTo = findStepIdByLabel(intentPlan, [
    "webhook",
    "notify",
    "notification",
    "alert",
  ]);
  return [
    {
      appliesTo,
      cardinality: "single",
      evidence: [{ source: "prompt", text: intentPlan.sourceText }],
      id: "dynamic-webhook-url",
      key: "notification.webhook.url",
      label: "Webhook URL",
      question: {
        answerType: "text",
        cardinality: "single",
        id: "question-webhook-url",
        prompt: "What webhook URL should receive the notification?",
      },
      requirementKind: "notification.send",
      source: "planner",
      status: "missing",
    },
  ];
}

function labelForStateRequirement(
  item: NonNullable<BuilderIntentIR>["state"][number]
): string {
  const prefix = item.timing === "before_loop" ? "Baseline" : "Fresh";
  return `${prefix} ${item.source.replace(/^current\s+/i, "").replace(/^fresh\s+/i, "")}`;
}

function findStepIdByLabel(
  intentPlan: IntentPlan,
  terms: readonly string[]
): string {
  const normalizedTerms = terms
    .map((term) => normalizeText(term).trim())
    .filter(Boolean);
  const step = intentPlan.steps.find((item) => {
    const label = normalizeText(item.label);
    return normalizedTerms.some((term) => label.includes(term));
  });
  return step?.id ?? intentPlan.steps[0]?.id ?? intentPlan.id;
}

function extractSeconds(text: string, pattern: RegExp): number | undefined {
  const match = pattern.exec(text);
  return match?.[1] ? Number(match[1]) : undefined;
}

function assetPairFromText(
  text: string
): { readonly base: string; readonly quote: string } | undefined {
  const explicitPair = findExplicitAssetPairs(text)[0];
  if (explicitPair) {
    return explicitPair;
  }
  const asset = findExplicitAssets(
    {
      entities: [],
      id: "asset-pair-from-text",
      openQuestionIds: [],
      sourceText: text,
      steps: [],
    },
    normalizeText(text)
  )[0];
  if (!asset) {
    return undefined;
  }
  return {
    base: asset.symbol,
    quote: findQuoteForAsset(text, asset.symbol) ?? "USD",
  };
}

function valueRefForAsset(prefix: string, base: string, quote: string): string {
  return `${prefix}${toPascalIdentifier(base)}${toPascalIdentifier(quote)}Price`;
}

function toPascalIdentifier(value: string): string {
  return value
    .split(/[^a-z0-9]+/i)
    .filter(Boolean)
    .map(
      (part) => `${part.charAt(0).toUpperCase()}${part.slice(1).toLowerCase()}`
    )
    .join("");
}

function assetLabelForQuestion(
  requirements: readonly IntentRequirement[],
  requiredEntities: readonly IntentConstraint[],
  intentPlan?: IntentPlan
): string | undefined {
  const assets = new Set<string>();
  for (const requirement of requirements) {
    if (requirement.type === "asset" && typeof requirement.value === "string") {
      assets.add(requirement.value.split("/")[0] ?? requirement.value);
    }
  }
  for (const entity of requiredEntities) {
    if (entity.type === "asset_pair") {
      assets.add(entity.base);
    }
  }
  for (const entity of intentPlan?.entities ?? []) {
    if (entity.kind === "asset") {
      assets.add(
        normalizeAssetSymbol(entity.canonicalValue ?? entity.label) ??
          entity.label
      );
    }
  }
  return assets.size > 0 ? [...assets].join("/") : undefined;
}

function dynamicRequirementsFromLegacy(
  requirements: readonly IntentRequirement[],
  sourceText: string
): DynamicRequirement[] {
  return requirements.map((requirement) => {
    const key = dynamicKeyForLegacyRequirement(requirement);
    const values =
      requirement.status === "ambiguous"
        ? requirement.candidates
        : requirement.value === undefined
          ? undefined
          : [requirement.value];
    const notificationMultiTarget =
      requirement.type === "notification_channel" &&
      values !== undefined &&
      values.length > 1 &&
      hasCompositeJoiner(sourceText);
    const cardinality: DynamicRequirement["cardinality"] =
      notificationMultiTarget && !hasAlternativeJoiner(sourceText)
        ? "multiple"
        : requirement.status === "ambiguous"
          ? "single_or_multiple"
          : "single";
    return {
      appliesTo: requirement.appliesTo,
      candidates:
        requirement.status === "ambiguous"
          ? (requirement.candidates ?? [])
          : undefined,
      cardinality,
      evidence: requirement.evidence,
      id: `dynamic-${requirement.id}`,
      key,
      label: labelForDynamicKey(key),
      legacyConstraint: requirement.legacyConstraint,
      legacyType: requirement.type,
      question: questionForDynamicRequirement(requirement, cardinality),
      source: "planner",
      requirementKind: dynamicRequirementKindForLegacy(requirement),
      status:
        notificationMultiTarget && !hasAlternativeJoiner(sourceText)
          ? "satisfied"
          : requirement.status,
      value:
        notificationMultiTarget && !hasAlternativeJoiner(sourceText)
          ? values
          : requirement.value,
    };
  });
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

function dynamicKeyForLegacyRequirement(
  requirement: IntentRequirement
): string {
  const typeToKey: Record<IntentRequirement["type"], string> = {
    asset: "asset_pair",
    content_kind: "content.kind",
    destructive_intent: "safety.destructive_intent",
    notification_channel: "notification.channel",
    operation: "operation",
    provider: "provider",
    resource: "resource",
    schedule: "schedule.interval",
  };
  return typeToKey[requirement.type];
}

function labelForDynamicKey(key: string): string {
  return key
    .split(/[._]/)
    .filter(Boolean)
    .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
    .join(" ");
}

function questionForDynamicRequirement(
  requirement: IntentRequirement,
  cardinality: DynamicRequirement["cardinality"]
): DynamicRequirement["question"] {
  if (requirement.status !== "missing" && requirement.status !== "ambiguous") {
    return undefined;
  }
  if (requirement.type === "notification_channel") {
    return {
      answerType:
        cardinality === "multiple" || cardinality === "single_or_multiple"
          ? "multi_choice"
          : "single_choice",
      cardinality,
      id: "question-notification-channel",
      prompt:
        cardinality === "multiple"
          ? "Which notification channels should be used?"
          : "Which notification channel should be used?",
    };
  }
  return {
    answerType: "text",
    cardinality,
    id: "question-candidate-clarification",
    prompt: "Which provider, resource, or action should be used?",
  };
}

function hasCompositeJoiner(sourceText: string): boolean {
  return /\b(?:and|plus|,)\b/i.test(sourceText);
}

function hasAlternativeJoiner(sourceText: string): boolean {
  return /\b(?:or|either)\b/i.test(sourceText);
}

function normalizeText(value: string): string {
  return ` ${value.toLowerCase().replace(/[^a-z0-9/]+/g, " ")} `;
}

function containsWord(text: string, word: string): boolean {
  return text.includes(` ${word.toLowerCase()} `);
}

function hasAny(text: string, words: readonly string[]): boolean {
  return words.some((word) => containsWord(text, word));
}

function containsPhrase(text: string, phrase: string): boolean {
  return normalizeText(phrase)
    .trim()
    .split(/\s+/)
    .every((part) => containsWord(text, part));
}

function entityHasPromptEvidence(
  entity: IntentPlan["entities"][number],
  promptText: string
): boolean {
  return [entity.label, entity.canonicalValue]
    .filter((value): value is string => Boolean(value))
    .some((value) => {
      const normalized = normalizeText(value).trim();
      if (!normalized) {
        return false;
      }
      return normalized
        .split(/\s+/)
        .every((part) => containsWord(promptText, part));
    });
}

function findOperations(text: string): string[] {
  const operations = new Set<string>();
  const verbMap: Array<{ operation: string; terms: readonly string[] }> = [
    {
      operation: "aggregate",
      terms: ["aggregate", "average", "count", "median", "sum"],
    },
    { operation: "assess", terms: ["assess", "risk"] },
    { operation: "calculate", terms: ["calculate", "compute"] },
    { operation: "create", terms: ["add", "create"] },
    { operation: "decode", terms: ["decode"] },
    { operation: "delete", terms: ["delete", "remove"] },
    { operation: "generate", terms: ["generate"] },
    { operation: "get", terms: ["fetch", "get", "read"] },
    { operation: "list", terms: ["list"] },
    { operation: "publish", terms: ["publish"] },
    { operation: "run", terms: ["execute", "run"] },
    { operation: "send", terms: ["message", "send"] },
    { operation: "swap", terms: ["swap"] },
    { operation: "transfer", terms: ["transfer"] },
    { operation: "transform", terms: ["convert", "format", "transform"] },
    { operation: "update", terms: ["edit", "update"] },
    { operation: "write", terms: ["write"] },
  ];
  for (const { operation, terms } of verbMap) {
    if (terms.some((term) => containsWord(text, term))) {
      operations.add(operation);
    }
  }
  return [...operations];
}

function findResources(text: string): string[] {
  const resources = new Set<string>();
  if (hasAny(text, ["calldata", "transaction", "transactions", "tx"])) {
    resources.add("transaction");
  }
  if (hasAny(text, ["user", "users"])) {
    resources.add("user");
  }
  if (hasAny(text, ["site", "sites"])) {
    resources.add("site");
  }
  return [...resources];
}

function findExplicitAssets(
  intentPlan: IntentPlan,
  text: string
): Array<{ symbol: string; sourceEntityId?: string }> {
  const assets = new Map<string, { symbol: string; sourceEntityId?: string }>();
  for (const entity of intentPlan.entities) {
    if (entity.kind !== "asset") {
      continue;
    }
    const symbol = normalizeAssetSymbol(entity.canonicalValue ?? entity.label);
    if (symbol) {
      assets.set(symbol, { symbol, sourceEntityId: entity.id });
    }
  }
  for (const symbol of findSymbolLikeTokens(text)) {
    if (!assets.has(symbol)) {
      assets.set(symbol, { symbol });
    }
  }
  return [...assets.values()];
}

function findSymbolLikeTokens(text: string): string[] {
  const ignored = new Set(["api", "http", "https", "token", "usd"]);
  const matches = [
    ...text.matchAll(
      /\b([a-z0-9]{2,12})\s+(?:balance|feed|price|prices|value)\b/g
    ),
    ...text.matchAll(/\b([a-z0-9]{2,12})\s*\/\s*[a-z0-9]{2,12}\b/g),
  ];
  return matches
    .flatMap((match) => (match[1] ? [match[1].toUpperCase()] : []))
    .filter((token) => !ignored.has(token.toLowerCase()));
}

function findExplicitAssetPairs(
  text: string
): Array<{ base: string; quote: string }> {
  return [
    ...text.matchAll(/\b([a-z0-9]{2,12})\s*\/\s*([a-z0-9]{2,12})\b/g),
  ].flatMap((match) =>
    match[1] && match[2]
      ? [{ base: match[1].toUpperCase(), quote: match[2].toUpperCase() }]
      : []
  );
}

function normalizeAssetSymbol(value: string): string | undefined {
  const upper = value.toUpperCase();
  const normalized = upper.replace(/[^A-Z0-9]/g, "");
  return normalized.length > 0 ? normalized : undefined;
}

function findQuoteForAsset(text: string, asset: string): string | undefined {
  const match = new RegExp(`${asset.toLowerCase()}\\s*/\\s*([a-z0-9]+)`).exec(
    text
  );
  return match?.[1]?.toUpperCase();
}

function assetHasPriceContext(text: string, asset: string): boolean {
  const normalizedAsset = asset.toLowerCase();
  return text.split(COMPOSITE_SEPARATOR_PATTERN).some((rawSegment) => {
    const segment = normalizeText(rawSegment);
    if (!containsWord(segment, normalizedAsset)) {
      return false;
    }
    return (
      hasAny(segment, ["feed", "price", "prices", "value"]) ||
      (containsWord(text, "prices") && containsWord(text, normalizedAsset)) ||
      new RegExp(`\\b${normalizedAsset}\\s*/\\s*[a-z0-9]+\\b`).test(
        segment.trim()
      )
    );
  });
}

function resolveContentKind(text: string): ContentKind | undefined {
  if (
    containsWord(text, "generate") &&
    (containsPhrase(text, "image") ||
      containsPhrase(text, "picture") ||
      containsPhrase(text, "photo"))
  ) {
    return "image";
  }
  if (containsWord(text, "generate") && containsPhrase(text, "email")) {
    return "text";
  }
  if (
    containsWord(text, "generate") &&
    (containsWord(text, "javascript") || containsWord(text, "code"))
  ) {
    return "text";
  }
  if (
    containsWord(text, "generate") &&
    (containsWord(text, "copy") || containsWord(text, "text")) &&
    (containsWord(text, "site") || containsWord(text, "page"))
  ) {
    return "text";
  }
  if (
    containsWord(text, "v0") &&
    (containsWord(text, "page") ||
      containsWord(text, "site") ||
      containsWord(text, "component") ||
      containsWord(text, "ui"))
  ) {
    return "text";
  }
  if (
    isEmailActionIntent(text) &&
    mentionedNotificationChannels(text).length <= 1
  ) {
    return "email";
  }
  if (
    mentionedNotificationProviders(text).length > 1 &&
    (containsPhrase(text, "webhook") || containsPhrase(text, "http request"))
  ) {
    return undefined;
  }
  if (containsPhrase(text, "webhook") || containsPhrase(text, "http request")) {
    return "http_request";
  }
  if (
    (containsWord(text, "run") || containsWord(text, "execute")) &&
    (containsPhrase(text, "code") || containsPhrase(text, "javascript"))
  ) {
    return "code";
  }
  if (hasAny(text, ["aggregate", "average", "sum", "count", "median"])) {
    return "numeric_aggregate";
  }
  if (containsWord(text, "user")) return "user_record";
  if (containsWord(text, "site")) return "site";
  if (hasAny(text, ["transaction", "calldata"])) return "transaction";
  if (containsWord(text, "generate")) return "text";
  if (containsPhrase(text, "text")) return "text";
  return undefined;
}

function resolveContentKinds(text: string): ContentKind[] {
  const primaryKind = resolveContentKind(text);
  if (!primaryKind) {
    return [];
  }
  if (
    primaryKind === "text" ||
    primaryKind === "image" ||
    primaryKind === "email" ||
    primaryKind === "http_request" ||
    primaryKind === "code" ||
    primaryKind === "numeric_aggregate"
  ) {
    return [primaryKind];
  }
  const kinds = new Set<ContentKind>([primaryKind]);
  if (containsWord(text, "user")) kinds.add("user_record");
  if (containsWord(text, "site")) kinds.add("site");
  if (hasAny(text, ["transaction", "calldata"])) kinds.add("transaction");
  return [...kinds];
}

function shouldCreateOperationConstraint(
  operation: string,
  text: string
): boolean {
  if (operation === "get" && containsWord(text, "price")) {
    return false;
  }
  if (
    operation === "send" &&
    !hasAny(text, ["message", "notify", "post", "send"])
  ) {
    return false;
  }
  return true;
}

function shouldCreateProviderConstraint(
  provider: string,
  text: string
): boolean {
  if (isNotificationIntent(text)) {
    if (text.trim() === provider) {
      return true;
    }
    return hasAny(text, [
      "alert",
      "me",
      "message",
      "notification",
      "notify",
      "post",
      "send",
    ]);
  }
  return true;
}

function findProviders(text: string): string[] {
  return [
    ...new Set([...explicitViaProviders(text), ...serviceLikeMentions(text)]),
  ];
}

function mentionedNotificationProviders(text: string): string[] {
  if (!(isNotificationIntent(text) || hasDirectMessageTarget(text))) {
    return [];
  }
  const explicit = explicitViaProviders(text);
  const explicitLooksLikeChannelChoice =
    !containsWord(text, "email") ||
    /\b(?:in|on|using|via|with)\s+[a-z][a-z0-9-]{1,30}\s+(?:and|or)\s+[a-z][a-z0-9-]{1,30}\b/.test(
      text
    );
  return [
    ...new Set([
      ...(explicitLooksLikeChannelChoice ? explicit : []),
      ...serviceLikeMentions(text),
    ]),
  ];
}

function mentionedNotificationChannels(text: string): string[] {
  return mentionedNotificationProviders(text);
}

function orderNotificationChannels(channels: readonly string[]): string[] {
  return [...channels].sort((left, right) => {
    if (left === "webhook" && right !== "webhook") return 1;
    if (right === "webhook" && left !== "webhook") return -1;
    return 0;
  });
}

function explicitViaProviders(text: string): string[] {
  const direct = [
    ...text.matchAll(/\b(?:in|on|using|via|with)\s+([a-z][a-z0-9-]{1,30})\b/g),
    ...text.matchAll(
      /\buse\s+([a-z][a-z0-9-]{1,30})\s+to\s+(?:notify|alert|message|post|send)\b/g
    ),
  ].flatMap((match) =>
    match[1] && !/^(?:a|an|the)$/.test(match[1])
      ? [normalizeProviderToken(match[1])]
      : []
  );
  const joined = [
    ...text.matchAll(
      /\b(?:in|on|using|via|with)\s+[a-z][a-z0-9-]{1,30}\s+(?:and|or)\s+([a-z][a-z0-9-]{1,30})\b/g
    ),
  ].flatMap((match) => (match[1] ? [normalizeProviderToken(match[1])] : []));
  if (direct.length === 0) {
    return direct;
  }
  if (direct.length !== 1 || joined.length > 0) {
    return [...direct, ...joined];
  }
  const phrase =
    /\b(?:in|on|using|via|with)\s+([a-z][a-z0-9-]{1,30})\s+([a-z][a-z0-9-]{1,30})\b/.exec(
      text
    );
  const combined =
    phrase?.[1] &&
    phrase[2] &&
    !/^(?:and|or|when|then|if|to|a|an|the)$/.test(phrase[2])
      ? [normalizeProviderToken(`${phrase[1]} ${phrase[2]}`)]
      : [];
  return [...direct, ...combined];
}

function serviceLikeMentions(text: string): string[] {
  const patterns = [
    /\bnotification\s+channel\s*:?\s+([a-z][a-z0-9-]{2,30})\b/g,
    /\bclarification\s*:?\s+([a-z][a-z0-9-]{2,30})\b/g,
    /\b(?:create|build|generate)\s+(?:a\s+|an\s+|the\s+)?([a-z0-9-]*\d[a-z0-9-]*)(?:\s+[a-z][a-z0-9-]*){0,3}\s+(?:app|component|page|site|ui)\b/g,
    /\b(email)\s+(?:the\s+)?[a-z][a-z0-9-]*\b/g,
    /\b([a-z][a-z0-9-]{2,30})\s+email\b/g,
    /\b([a-z][a-z0-9-]{2,30})\s+me\b/g,
    /\bsend(?:\s+a|\s+an)?\s+([a-z][a-z0-9-]{2,30})\s+(?:alert|message|notification)\b/g,
    /\bpost\s+(?:to\s+)?([a-z][a-z0-9-]{2,30})\b/g,
    /\b([a-z][a-z0-9-]{2,30})\s+(?:alert|message|notification)\b/g,
  ];
  const ignored = new Set([
    "alert",
    "and",
    "message",
    "notification",
    "notify",
    "or",
  ]);
  const matches = patterns.flatMap((pattern) =>
    [...text.matchAll(pattern)]
      .flatMap((match) => (match[1] ? [normalizeProviderToken(match[1])] : []))
      .filter((token) => !ignored.has(token))
  );
  const trimmed = text.trim();
  if (/^[a-z][a-z0-9-]{1,30}$/.test(trimmed) && !ignored.has(trimmed)) {
    matches.push(normalizeProviderToken(trimmed));
  }
  return matches;
}

function normalizeProviderToken(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function isNotificationIntent(text: string): boolean {
  return hasAny(text, [
    "alert",
    "email",
    "message",
    "notification",
    "notify",
    "post",
    "send",
  ]);
}

function hasDirectMessageTarget(text: string): boolean {
  const match = /\b([a-z][a-z0-9-]{2,30})\s+me\b/.exec(text);
  return Boolean(match?.[1] && match[1] !== "notify");
}

function isEmailActionIntent(text: string): boolean {
  return (
    containsWord(text, "email") &&
    (text.trim() === "email" ||
      text.trim().startsWith("email ") ||
      hasAny(text, ["alert", "generate", "me", "notify", "post", "send"]))
  );
}

function dedupeConstraints(
  constraints: readonly IntentConstraint[]
): readonly IntentConstraint[] {
  const seen = new Set<string>();
  return constraints.filter((constraint) => {
    const key = JSON.stringify(constraint);
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function buildIntentRequirements(
  intentPlan: IntentPlan,
  requiredEntities: readonly IntentConstraint[],
  optionalEntities: readonly IntentConstraint[],
  options: { missingAsset: boolean }
): IntentRequirement[] {
  const requirements: IntentRequirement[] = [];
  const nextId = (type: IntentRequirement["type"]) =>
    `requirement-${type}-${requirements.length + 1}`;
  const appliesTo = (
    type: IntentRequirement["type"],
    constraint?: IntentConstraint
  ) => findStepForRequirement(intentPlan, type, constraint);
  const evidence = (constraint?: IntentConstraint) => [
    {
      entityId: constraint?.sourceEntityId,
      source: constraint?.sourceEntityId ? "entity" : "prompt",
      text: intentPlan.sourceText,
    } as const,
  ];
  const addRequirement = (
    requirement: Omit<IntentRequirement, "id" | "evidence"> & {
      evidence?: IntentRequirement["evidence"];
    }
  ) => {
    requirements.push({
      ...requirement,
      evidence: requirement.evidence ?? evidence(),
      id: nextId(requirement.type),
    });
  };

  const grouped = groupConstraints(requiredEntities);
  const assetConstraints = grouped.get("asset_pair") ?? [];
  for (const constraint of assetConstraints) {
    if (constraint.type !== "asset_pair") {
      continue;
    }
    addRequirement({
      appliesTo: appliesTo("asset", constraint),
      evidence: evidence(constraint),
      legacyConstraint: describeConstraint(constraint),
      status: "satisfied",
      type: "asset",
      value: `${constraint.base}/${constraint.quote}`,
    });
  }
  if (options.missingAsset) {
    addRequirement({
      appliesTo: appliesTo("asset"),
      legacyConstraint: "asset",
      status: "missing",
      type: "asset",
    });
  }

  const notificationConstraints = grouped.get("notification") ?? [];
  const notificationChannels = notificationConstraints.flatMap((constraint) =>
    constraint.type === "notification" && constraint.channel
      ? [constraint.channel]
      : []
  );
  if (notificationChannels.length > 1) {
    addRequirement({
      appliesTo: appliesTo("notification_channel", notificationConstraints[0]),
      candidates: notificationChannels,
      legacyConstraint: "notification",
      status: "ambiguous",
      type: "notification_channel",
    });
  } else if (notificationChannels.length === 1) {
    const constraint = notificationConstraints.find(
      (item) => item.type === "notification" && item.channel
    );
    addRequirement({
      appliesTo: appliesTo("notification_channel", constraint),
      evidence: evidence(constraint),
      legacyConstraint: constraint ? describeConstraint(constraint) : undefined,
      status: "satisfied",
      type: "notification_channel",
      value: notificationChannels[0],
    });
  } else if (notificationConstraints.length > 0) {
    addRequirement({
      appliesTo: appliesTo("notification_channel", notificationConstraints[0]),
      legacyConstraint: "notification",
      status: "missing",
      type: "notification_channel",
    });
  }

  for (const constraint of requiredEntities) {
    if (
      constraint.type === "asset_pair" ||
      constraint.type === "notification"
    ) {
      continue;
    }
    addRequirement(requirementFromConstraint(constraint, appliesTo, evidence));
  }

  for (const constraint of optionalEntities) {
    if (constraint.type !== "schedule") {
      continue;
    }
    addRequirement({
      appliesTo: appliesTo("schedule", constraint),
      evidence: evidence(constraint),
      legacyConstraint: describeConstraint(constraint),
      status: "satisfied",
      type: "schedule",
      value: constraint.interval,
    });
  }

  return markConflictingRequirements(requirements);
}

function requirementFromConstraint(
  constraint: IntentConstraint,
  appliesTo: (
    type: IntentRequirement["type"],
    constraint?: IntentConstraint
  ) => string,
  evidence: (constraint?: IntentConstraint) => IntentRequirement["evidence"]
): Omit<IntentRequirement, "id" | "evidence"> & {
  evidence?: IntentRequirement["evidence"];
} {
  switch (constraint.type) {
    case "provider":
      return {
        appliesTo: appliesTo("provider", constraint),
        evidence: evidence(constraint),
        legacyConstraint: describeConstraint(constraint),
        status: "satisfied",
        type: "provider",
        value: constraint.provider,
      };
    case "operation":
      return {
        appliesTo: appliesTo("operation", constraint),
        evidence: evidence(constraint),
        legacyConstraint: describeConstraint(constraint),
        status: "satisfied",
        type: "operation",
        value: constraint.operation,
      };
    case "resource":
      return {
        appliesTo: appliesTo("resource", constraint),
        evidence: evidence(constraint),
        legacyConstraint: describeConstraint(constraint),
        status: "satisfied",
        type: "resource",
        value: constraint.resource,
      };
    case "content_kind":
      return {
        appliesTo: appliesTo("content_kind", constraint),
        evidence: evidence(constraint),
        legacyConstraint: describeConstraint(constraint),
        status: "satisfied",
        type: "content_kind",
        value: constraint.contentKind,
      };
    case "destructive_intent":
      return {
        appliesTo: appliesTo("destructive_intent", constraint),
        evidence: evidence(constraint),
        legacyConstraint: describeConstraint(constraint),
        status: "satisfied",
        type: "destructive_intent",
        value: constraint.destructive,
      };
    case "schedule":
      return {
        appliesTo: appliesTo("schedule", constraint),
        evidence: evidence(constraint),
        legacyConstraint: describeConstraint(constraint),
        status: "satisfied",
        type: "schedule",
        value: constraint.interval,
      };
    default:
      return {
        appliesTo: appliesTo("resource", constraint),
        evidence: evidence(constraint),
        legacyConstraint: describeConstraint(constraint),
        status: "satisfied",
        type: "resource",
      };
  }
}

function findStepForRequirement(
  intentPlan: IntentPlan,
  type: IntentRequirement["type"],
  constraint?: IntentConstraint
): string {
  const sourceEntityStep = constraint?.sourceEntityId
    ? intentPlan.steps.find((step) =>
        step.requiredEntityIds.includes(constraint.sourceEntityId ?? "")
      )
    : undefined;
  if (sourceEntityStep) {
    return sourceEntityStep.id;
  }

  if (constraint?.type === "operation" && constraint.operation === "swap") {
    const writeStep = intentPlan.steps.find((step) => step.kind === "write");
    if (writeStep) {
      return writeStep.id;
    }
  }

  const matchingTextStep = intentPlan.steps.find((step) =>
    stepMatchesConstraint(step.label, constraint)
  );
  if (matchingTextStep) {
    return matchingTextStep.id;
  }

  const preferredKind = preferredStepKindForRequirement(type, constraint);
  return (
    intentPlan.steps.find((step) => step.kind === preferredKind)?.id ??
    intentPlan.steps[0]?.id ??
    intentPlan.id
  );
}

function preferredStepKindForRequirement(
  type: IntentRequirement["type"],
  constraint: IntentConstraint | undefined
): IntentPlan["steps"][number]["kind"] | undefined {
  if (type === "notification_channel") return "notify";
  if (type === "asset") return "read";
  if (type === "schedule") return "trigger";
  if (constraint?.type === "operation" && constraint.operation === "send") {
    return "notify";
  }
  if (constraint?.type === "operation" && constraint.operation === "swap") {
    return "write";
  }
  if (
    constraint?.type === "provider" &&
    isLikelyNotificationProvider(constraint.provider)
  ) {
    return "notify";
  }
  return undefined;
}

function isLikelyNotificationProvider(provider: string): boolean {
  return ["email", "message", "notification", "webhook"].some((term) =>
    provider.includes(term)
  );
}

function stepMatchesConstraint(
  label: string,
  constraint: IntentConstraint | undefined
): boolean {
  if (!constraint) {
    return false;
  }
  const text = normalizeText(label);
  switch (constraint.type) {
    case "asset_pair":
      return (
        containsWord(text, constraint.base.toLowerCase()) ||
        containsPhrase(text, `${constraint.base}/${constraint.quote}`)
      );
    case "content_kind":
      return containsWord(text, constraint.contentKind);
    case "destructive_intent":
      return (
        constraint.destructive &&
        DESTRUCTIVE_WORDS.some((word) => containsWord(text, word))
      );
    case "notification":
      return constraint.channel
        ? containsWord(text, constraint.channel)
        : hasAny(text, ["notify", "notification", "alert"]);
    case "operation":
      return containsWord(text, constraint.operation);
    case "provider":
      return containsWord(text, constraint.provider);
    case "resource":
      return containsWord(text, constraint.resource);
    case "schedule":
      return containsPhrase(text, constraint.interval);
    default:
      return false;
  }
}

function groupConstraints(constraints: readonly IntentConstraint[]) {
  const grouped = new Map<IntentConstraint["type"], IntentConstraint[]>();
  for (const constraint of constraints) {
    grouped.set(constraint.type, [
      ...(grouped.get(constraint.type) ?? []),
      constraint,
    ]);
  }
  return grouped;
}

function markConflictingRequirements(
  requirements: readonly IntentRequirement[]
): IntentRequirement[] {
  const hasMultipleProvidersOrResources = new Set(
    [
      ...new Set(requirements.map((requirement) => requirement.appliesTo)),
    ].filter((actionId) => {
      const actionRequirements = requirements.filter(
        (requirement) => requirement.appliesTo === actionId
      );
      return (
        new Set(
          actionRequirements
            .filter((requirement) => requirement.type === "provider")
            .map((requirement) => requirement.value)
        ).size > 1 ||
        new Set(
          actionRequirements
            .filter((requirement) => requirement.type === "resource")
            .map((requirement) => requirement.value)
        ).size > 1
      );
    })
  );
  const operationGroups = new Map<string, IntentRequirement[]>();
  for (const requirement of requirements) {
    if (
      requirement.type !== "operation" ||
      requirement.status !== "satisfied" ||
      requirement.value === undefined
    ) {
      continue;
    }
    if (hasMultipleProvidersOrResources.has(requirement.appliesTo)) {
      continue;
    }
    const key = `${requirement.appliesTo}:${requirement.type}`;
    operationGroups.set(key, [
      ...(operationGroups.get(key) ?? []),
      requirement,
    ]);
  }
  const conflictingIds = new Set(
    [...operationGroups.values()]
      .filter((group) => new Set(group.map((item) => item.value)).size > 1)
      .flatMap((group) => group.map((item) => item.id))
  );
  return requirements.map((requirement) =>
    conflictingIds.has(requirement.id)
      ? { ...requirement, status: "conflicting" }
      : requirement
  );
}

function describeConstraint(constraint: IntentConstraint): string {
  switch (constraint.type) {
    case "asset_pair":
      return `asset_pair:${constraint.base}/${constraint.quote}`;
    case "content_kind":
      return `content_kind:${constraint.contentKind}`;
    case "destructive_intent":
      return `destructive_intent:${constraint.destructive}`;
    case "notification":
      return constraint.channel
        ? `notification:${constraint.channel}`
        : "notification";
    case "operation":
      return `operation:${constraint.operation}`;
    case "provider":
      return `provider:${constraint.provider}`;
    case "resource":
      return `resource:${constraint.resource}`;
    case "schedule":
      return `schedule:${constraint.interval}`;
    default:
      return "constraint:unknown";
  }
}
