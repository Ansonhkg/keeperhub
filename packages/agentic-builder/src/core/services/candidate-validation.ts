import type {
  CandidateValidation,
  CatalogCandidate,
  CatalogCandidateCapability,
  CatalogValidationResult,
  ContentKind,
  IntentConstraint,
  IntentRequirement,
  IntentResolution,
} from "../schemas/all";
import { catalogValidationResultSchema } from "../schemas/all";

const COMPOSITE_SEPARATOR_PATTERN = /\s*(?:,|;|\b(?:and|then|plus)\b)\s*/;

export function validateCatalogCandidates(
  intentResolution: IntentResolution,
  candidates: readonly CatalogCandidate[]
): CatalogValidationResult {
  const evidence = candidates.map((candidate) =>
    validateCatalogCandidate(intentResolution, candidate)
  );
  const acceptedIds = new Set(
    evidence
      .filter((candidateEvidence) => candidateEvidence.status === "accepted")
      .map((candidateEvidence) => candidateEvidence.candidateId)
  );
  return catalogValidationResultSchema.parse({
    accepted: candidates.filter((candidate) => acceptedIds.has(candidate.id)),
    evidence,
    rejected: candidates.filter((candidate) => !acceptedIds.has(candidate.id)),
  });
}

export function validateCatalogCandidate(
  intentResolution: IntentResolution,
  candidate: CatalogCandidate
): CandidateValidation {
  const capability =
    candidate.capability ?? inferCandidateCapability(candidate);
  const reasons: string[] = [];
  const matchedConstraints: string[] = [];
  const failedConstraints: string[] = [];
  const required = requirementsForValidation(intentResolution);
  const requirementEvaluations: CandidateValidation["requirementEvaluations"] =
    [];
  const actionStates = new Map<
    string,
    {
      failedConstraints: string[];
      hasIdentityRequirement: boolean;
      matchedIdentityRequirement: boolean;
      relevant: boolean;
      reasons: string[];
    }
  >();
  const hasDestructiveIntent = required.some(
    (requirement) =>
      requirement.type === "destructive_intent" &&
      requirement.status === "satisfied" &&
      requirement.value === true
  );
  const matchedAlternativeGroups = matchedRequirementGroups(
    required,
    capability
  );

  if (capability.kind === "unknown" && required.length > 0) {
    const failedDescriptions = required.flatMap(requirementDescriptions);
    return {
      candidateId: candidate.id,
      failedConstraints: failedDescriptions,
      matchedConstraints,
      requirementEvaluations: required.map((requirement) =>
        evaluationForRequirement(requirement, "conflicting", [
          "candidate capability is unknown for explicit requirements",
        ])
      ),
      reasons: ["candidate capability is unknown for explicit constraints"],
      status: "rejected",
    };
  }

  for (const requirement of required) {
    const actionState = getActionState(actionStates, requirement.appliesTo);
    if (isIdentityRequirement(requirement)) {
      actionState.hasIdentityRequirement = true;
    }
    if (requirement.status === "missing") {
      const missingSatisfied = missingRequirementSatisfiedByCandidate(
        requirement,
        capability
      );
      if (isIdentityRequirement(requirement)) {
        actionState.matchedIdentityRequirement = missingSatisfied;
        actionState.relevant = actionState.relevant || missingSatisfied;
      }
      if (
        missingSatisfied &&
        (requirement.type === "asset" ||
          requirement.type === "notification_channel")
      ) {
        actionState.failedConstraints.push(`${requirement.type}:missing`);
        actionState.reasons.push(
          `${requirement.type} requirement is unresolved`
        );
      }
      requirementEvaluations.push(
        evaluationForRequirement(
          requirement,
          missingSatisfied ? "missing" : "not_applicable",
          ["requirement is unresolved"]
        )
      );
      continue;
    }
    if (requirement.status === "conflicting") {
      const descriptions = requirementDescriptions(requirement);
      actionState.failedConstraints.push(...descriptions);
      actionState.reasons.push("requirement is conflicting");
      requirementEvaluations.push(
        evaluationForRequirement(requirement, "conflicting", [
          "requirement is conflicting",
        ])
      );
      continue;
    }

    const results = requirementConstraints(requirement).map((constraint) => ({
      constraint,
      result: evaluateConstraint(constraint, capability),
    }));
    const related = results.filter((item) => item.result !== "unrelated");
    const matched = related.filter((item) => item.result === "matched");
    if (matched.length > 0) {
      matchedConstraints.push(
        ...matched.map((item) => describeConstraint(item.constraint))
      );
      actionState.relevant = true;
      if (isIdentityRequirement(requirement)) {
        actionState.matchedIdentityRequirement = true;
      }
      requirementEvaluations.push(
        evaluationForRequirement(
          requirement,
          requirement.status === "ambiguous" ? "ambiguous" : "satisfied",
          []
        )
      );
      continue;
    }
    const failed = related.filter((item) => item.result === "failed");
    if (failed.length > 0) {
      if (matchedAlternativeGroups.has(requirementGroupKey(requirement))) {
        requirementEvaluations.push(
          evaluationForRequirement(requirement, "not_applicable", [])
        );
        continue;
      }
      const descriptions = failed.map((item) =>
        describeConstraint(item.constraint)
      );
      actionState.failedConstraints.push(...descriptions);
      actionState.reasons.push(`violates ${descriptions.join(" or ")}`);
      actionState.relevant = true;
      requirementEvaluations.push(
        evaluationForRequirement(requirement, "conflicting", [
          `violates ${descriptions.join(" or ")}`,
        ])
      );
      continue;
    }
    requirementEvaluations.push(
      evaluationForRequirement(requirement, "not_applicable", [])
    );
  }

  if (capability.destructive && !hasDestructiveIntent) {
    for (const actionState of actionStates.values()) {
      actionState.failedConstraints.push("destructive_intent:false");
      actionState.reasons.push(
        "candidate is destructive but destructive intent was absent"
      );
    }
  }
  const sourceAllowedOperations = allowedOperationsForCapability(
    intentResolution.sourceText,
    capability
  );
  if (
    sourceAllowedOperations.size > 0 &&
    capability.operation &&
    !sourceAllowedOperations.has(capability.operation)
  ) {
    for (const actionState of actionStates.values()) {
      actionState.failedConstraints.push(
        `source_operation:${[...sourceAllowedOperations].join("|")}`
      );
      actionState.reasons.push(
        "candidate operation does not match its requested step"
      );
    }
  }
  if (
    capability.kind === "price_feed" &&
    !matchesPriceFeedStep(intentResolution.sourceText, capability) &&
    !singleProviderMultiAssetIntent(intentResolution, capability)
  ) {
    for (const actionState of actionStates.values()) {
      actionState.failedConstraints.push("source_price_feed_step");
      actionState.reasons.push(
        "candidate price feed does not match its requested step"
      );
    }
  }

  const passingAction = [...actionStates.values()].find(
    (actionState) =>
      actionState.failedConstraints.length === 0 &&
      actionState.relevant &&
      (!actionState.hasIdentityRequirement ||
        actionState.matchedIdentityRequirement)
  );
  if (!passingAction) {
    failedConstraints.push(
      ...[...actionStates.values()].flatMap(
        (actionState) => actionState.failedConstraints
      )
    );
    reasons.push(
      ...[...actionStates.values()].flatMap(
        (actionState) => actionState.reasons
      )
    );
    if (
      required.some(isIdentityRequirement) &&
      !matchedConstraints.some(isIdentityConstraintDescription)
    ) {
      failedConstraints.push("identity_constraint:none");
      reasons.push("candidate does not satisfy any explicit intent identity");
    }
  }

  return {
    candidateId: candidate.id,
    failedConstraints,
    matchedConstraints,
    requirementEvaluations,
    reasons,
    status: reasons.length > 0 ? "rejected" : "accepted",
  };
}

function getActionState(
  actionStates: Map<
    string,
    {
      failedConstraints: string[];
      hasIdentityRequirement: boolean;
      matchedIdentityRequirement: boolean;
      relevant: boolean;
      reasons: string[];
    }
  >,
  actionId: string
) {
  const existing = actionStates.get(actionId);
  if (existing) {
    return existing;
  }
  const created = {
    failedConstraints: [],
    hasIdentityRequirement: false,
    matchedIdentityRequirement: false,
    relevant: false,
    reasons: [],
  };
  actionStates.set(actionId, created);
  return created;
}

function matchedRequirementGroups(
  requirements: readonly IntentRequirement[],
  capability: CatalogCandidateCapability
): Set<string> {
  const groupCounts = new Map<string, number>();
  for (const requirement of requirements) {
    const key = requirementGroupKey(requirement);
    groupCounts.set(key, (groupCounts.get(key) ?? 0) + 1);
  }
  const matched = new Set<string>();
  for (const requirement of requirements) {
    if ((groupCounts.get(requirementGroupKey(requirement)) ?? 0) <= 1) {
      continue;
    }
    if (
      requirementConstraints(requirement).some(
        (constraint) => evaluateConstraint(constraint, capability) === "matched"
      )
    ) {
      matched.add(requirementGroupKey(requirement));
    }
  }
  return matched;
}

function requirementGroupKey(requirement: IntentRequirement): string {
  return `${requirement.appliesTo}:${requirement.type}`;
}

function missingRequirementSatisfiedByCandidate(
  requirement: IntentRequirement,
  capability: CatalogCandidateCapability
): boolean {
  if (requirement.type === "notification_channel") {
    return isNotificationLikeCandidate(capability);
  }
  if (requirement.type === "asset") {
    return capability.kind === "price_feed";
  }
  return true;
}

function requirementsForValidation(
  intentResolution: IntentResolution
): readonly IntentRequirement[] {
  if (intentResolution.requirements.length > 0) {
    return intentResolution.requirements;
  }
  return intentResolution.requiredEntities
    .filter((constraint) => constraint.required)
    .map(requirementFromLegacyConstraint);
}

function requirementFromLegacyConstraint(
  constraint: IntentConstraint
): IntentRequirement {
  return {
    appliesTo: "legacy",
    evidence: [{ source: "prompt" }],
    id: `legacy-${describeConstraint(constraint)}`,
    legacyConstraint: describeConstraint(constraint),
    status: "satisfied",
    type: legacyRequirementType(constraint.type),
    value: legacyRequirementValue(constraint),
  };
}

function legacyRequirementType(
  type: IntentConstraint["type"]
): IntentRequirement["type"] {
  if (type === "asset_pair") return "asset";
  if (type === "notification") return "notification_channel";
  if (type === "destructive_intent") return "destructive_intent";
  return type;
}

function legacyRequirementValue(
  constraint: IntentConstraint
): string | boolean | undefined {
  switch (constraint.type) {
    case "asset_pair":
      return `${constraint.base}/${constraint.quote}`;
    case "content_kind":
      return constraint.contentKind;
    case "destructive_intent":
      return constraint.destructive;
    case "notification":
      return constraint.channel;
    case "operation":
      return constraint.operation;
    case "provider":
      return constraint.provider;
    case "resource":
      return constraint.resource;
    case "schedule":
      return constraint.interval;
    default:
      return undefined;
  }
}

function requirementConstraints(
  requirement: IntentRequirement
): IntentConstraint[] {
  const values =
    requirement.status === "ambiguous"
      ? (requirement.candidates ?? [])
      : requirement.value === undefined
        ? []
        : [requirement.value];
  return values.flatMap((value) =>
    constraintFromRequirementValue(requirement, value)
  );
}

function constraintFromRequirementValue(
  requirement: IntentRequirement,
  value: string | boolean
): IntentConstraint[] {
  if (requirement.type === "asset" && typeof value === "string") {
    const [base, quote] = value.split("/");
    return base && quote
      ? [{ base, quote, required: true, type: "asset_pair" }]
      : [];
  }
  if (
    requirement.type === "notification_channel" &&
    typeof value === "string"
  ) {
    return [{ channel: value, required: true, type: "notification" }];
  }
  if (requirement.type === "provider" && typeof value === "string") {
    return [{ provider: value, required: true, type: "provider" }];
  }
  if (requirement.type === "operation" && typeof value === "string") {
    return [{ operation: value, required: true, type: "operation" }];
  }
  if (requirement.type === "resource" && typeof value === "string") {
    return [{ required: true, resource: value, type: "resource" }];
  }
  if (requirement.type === "content_kind" && typeof value === "string") {
    return [
      {
        contentKind: value as ContentKind,
        required: true,
        type: "content_kind",
      },
    ];
  }
  if (requirement.type === "destructive_intent" && typeof value === "boolean") {
    return [{ destructive: value, required: true, type: "destructive_intent" }];
  }
  if (requirement.type === "schedule" && typeof value === "string") {
    return [{ interval: value, required: true, type: "schedule" }];
  }
  return [];
}

function requirementDescriptions(requirement: IntentRequirement): string[] {
  return requirementConstraints(requirement).map(describeConstraint);
}

function evaluationForRequirement(
  requirement: IntentRequirement,
  status: CandidateValidation["requirementEvaluations"][number]["status"],
  reasons: readonly string[]
): CandidateValidation["requirementEvaluations"][number] {
  return {
    actionId: requirement.appliesTo,
    evidence: requirement.evidence,
    reasons: [...reasons],
    requirementId: requirement.id,
    status,
  };
}

export function inferCandidateCapability(
  candidate: CatalogCandidate
): CatalogCandidateCapability {
  const manifestActionType = catalogFact(candidate, "actionType");
  const provider = providerForCandidate(candidate);
  const operationSource = normalizeText(
    [
      candidate.id.split("/").slice(1).join(" "),
      candidate.manifest?.actionId?.split("/").slice(1).join(" "),
      catalogFact(candidate, "functionName"),
      candidate.description,
    ].join(" ")
  );
  const quoteLikeAction =
    containsWord(operationSource, "quote") ||
    containsPhrase(operationSource, "expected output") ||
    containsPhrase(operationSource, "required input") ||
    candidate.id.includes("/quote-") ||
    candidate.id.includes("/get-amount-out") ||
    candidate.manifest?.actionId?.includes("/quote-") ||
    candidate.manifest?.actionId?.includes("/get-amount-out");
  const raw = `${candidate.id} ${candidate.label} ${candidate.description}`;
  const text = normalizeText(raw);
  if (quoteLikeAction) {
    return {
      contentKind: "transaction",
      kind: "wallet_read",
      operation: "get",
      provider: provider ?? "web3",
      resource: "transaction",
    };
  }
  if (
    manifestActionType === "write" ||
    containsWord(operationSource, "swap") ||
    containsWord(operationSource, "transfer") ||
    containsPhrase(operationSource, "write contract") ||
    containsPhrase(operationSource, "approve erc20")
  ) {
    return {
      contentKind: "transaction",
      destructive: true,
      kind: "wallet_write",
      operation: inferOperation(operationSource) ?? "write",
      provider: provider ?? "web3",
      resource: "transaction",
    };
  }
  const assetPair = inferAssetPair(
    normalizeText(
      [
        candidate.label,
        candidate.description,
        candidate.manifest?.title,
        candidate.manifest?.description,
      ]
        .filter(Boolean)
        .join(" ")
    )
  );
  if (assetPair) {
    return {
      assetPair,
      kind: "price_feed",
      operation: "read",
      provider,
    };
  }
  if (containsWord(text, "price") || containsWord(text, "feed")) {
    return {
      kind: "price_feed",
      operation: "read",
      provider,
    };
  }
  if (looksLikeNotificationAction(text)) {
    return {
      contentKind: containsWord(text, "email") ? "email" : "text",
      kind: "notification",
      operation: "send",
      provider: provider ?? providerForText(text),
    };
  }
  if (containsWord(text, "webhook") || containsPhrase(text, "http request")) {
    return {
      contentKind: "http_request",
      kind: "http_request",
      operation: "send",
      provider: "webhook",
    };
  }
  if (containsWord(text, "code") || containsWord(text, "javascript")) {
    return {
      contentKind: "code",
      kind: "code_execution",
      operation: "run",
      provider: "code",
    };
  }
  if (containsWord(text, "aggregate") || containsWord(text, "math")) {
    return {
      contentKind: "numeric_aggregate",
      kind: "numeric_aggregate",
      operation: "aggregate",
      provider: "math",
    };
  }
  if (containsWord(text, "user")) {
    return {
      contentKind: "user_record",
      destructive: hasAny(text, ["delete", "update"]),
      kind: "user_management",
      operation: inferOperation(text) ?? "get",
      provider,
      resource: "user",
    };
  }
  if (containsWord(text, "site")) {
    return {
      contentKind: "site",
      destructive: hasAny(text, ["publish", "update"]),
      kind: "site_management",
      operation: inferOperation(text) ?? "list",
      provider,
      resource: "site",
    };
  }
  if (containsPhrase(text, "generate image")) {
    return {
      contentKind: "image",
      kind: "ai_generation",
      operation: "generate",
      provider: "ai-gateway",
    };
  }
  if (containsPhrase(text, "generate text")) {
    return {
      contentKind: "text",
      kind: "ai_generation",
      operation: "generate",
      provider: "ai-gateway",
    };
  }
  if (containsWord(text, "v0")) {
    return {
      contentKind: "text",
      kind: "ui_generation",
      operation: inferOperation(text) ?? "create",
      provider: "v0",
    };
  }
  if (containsWord(text, "safe")) {
    return {
      contentKind: "transaction",
      kind: "safe_multisig",
      operation: "get",
      provider: "safe",
      resource: "transaction",
    };
  }
  if (
    containsWord(text, "transfer") ||
    containsPhrase(text, "write contract") ||
    containsPhrase(text, "approve erc20")
  ) {
    return {
      contentKind: "transaction",
      destructive: true,
      kind: "wallet_write",
      operation: inferOperation(text) ?? "write",
      provider: provider ?? "web3",
      resource: "transaction",
    };
  }
  if (manifestActionType === "read" && provider) {
    return {
      contentKind: "transaction",
      kind: "wallet_read",
      operation: "get",
      provider,
      resource: "transaction",
    };
  }
  if (containsWord(text, "transaction") || containsWord(text, "calldata")) {
    return {
      contentKind: "transaction",
      kind: "transaction_analysis",
      operation: inferOperation(text) ?? "get",
      provider: "web3",
      resource: "transaction",
    };
  }
  if (containsWord(text, "balance") || containsPhrase(text, "read contract")) {
    return {
      kind: "wallet_read",
      operation: "get",
      provider: "web3",
    };
  }
  return { kind: "unknown" };
}

function evaluateConstraint(
  constraint: IntentConstraint,
  capability: CatalogCandidateCapability
): "failed" | "matched" | "unrelated" {
  if (constraint.type === "asset_pair") {
    if (capability.kind === "unknown") return "failed";
    if (capability.kind !== "price_feed") return "unrelated";
    if (!capability.assetPair) return "failed";
    return sameText(capability.assetPair.base, constraint.base) &&
      sameText(capability.assetPair.quote, constraint.quote)
      ? "matched"
      : "failed";
  }
  if (constraint.type === "notification") {
    if (!isNotificationLikeCandidate(capability)) return "unrelated";
    if (!constraint.channel) return "matched";
    if (
      sameText(constraint.channel, "email") &&
      sameText(capability.contentKind, "email")
    ) {
      return "matched";
    }
    return providerMatchesConstraint(capability.provider, constraint.channel)
      ? "matched"
      : "failed";
  }
  if (constraint.type === "provider") {
    if (!capability.provider) return "failed";
    if (!providerAppliesToCapability(constraint.provider, capability)) {
      return "unrelated";
    }
    return providerMatchesConstraint(capability.provider, constraint.provider)
      ? "matched"
      : "failed";
  }
  if (constraint.type === "operation") {
    if (!capability.operation) return "failed";
    if (!operationAppliesToCapability(constraint.operation, capability)) {
      return "unrelated";
    }
    return sameText(capability.operation, constraint.operation)
      ? "matched"
      : "failed";
  }
  if (constraint.type === "resource") {
    if (!capability.resource) return "unrelated";
    return sameText(capability.resource, constraint.resource)
      ? "matched"
      : "failed";
  }
  if (constraint.type === "content_kind") {
    if (!capability.contentKind) return "unrelated";
    return sameText(capability.contentKind, constraint.contentKind)
      ? "matched"
      : "failed";
  }
  return "unrelated";
}

function describeConstraint(constraint: IntentConstraint): string {
  if (constraint.type === "asset_pair") {
    return `asset_pair:${constraint.base}/${constraint.quote}`;
  }
  if (constraint.type === "notification") {
    return `notification:${constraint.channel ?? "any"}`;
  }
  if (constraint.type === "provider") return `provider:${constraint.provider}`;
  if (constraint.type === "operation")
    return `operation:${constraint.operation}`;
  if (constraint.type === "resource") return `resource:${constraint.resource}`;
  if (constraint.type === "content_kind") {
    return `content_kind:${constraint.contentKind}`;
  }
  if (constraint.type === "destructive_intent") {
    return `destructive_intent:${constraint.destructive}`;
  }
  if (constraint.type === "schedule") return `schedule:${constraint.interval}`;
  return "unknown";
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

function inferAssetPair(
  text: string
): { base: string; quote: string } | undefined {
  const slashPair = /\b([a-z0-9]{2,12})\s*\/\s*([a-z0-9]{2,12})\b/.exec(text);
  if (slashPair?.[1] && slashPair[2]) {
    return {
      base: slashPair[1].toUpperCase(),
      quote: slashPair[2].toUpperCase(),
    };
  }
  if (!hasAny(text, ["feed", "price", "round", "value"])) {
    return undefined;
  }
  const looseUsdPair =
    /\b([a-z0-9]{2,12})[\s-]+usd\b/.exec(text) ??
    /\busd[\s-]+([a-z0-9]{2,12})\b/.exec(text);
  if (looseUsdPair?.[1]) {
    return { base: looseUsdPair[1].toUpperCase(), quote: "USD" };
  }
  return undefined;
}

function inferProvider(text: string): string | undefined {
  return providerForText(text);
}

function providerForCandidate(candidate: CatalogCandidate): string | undefined {
  const manifestProvider =
    catalogFact(candidate, "provider") ??
    catalogFact(candidate, "protocolSlug") ??
    catalogFact(candidate, "protocolName");
  const idProvider =
    /^native-([^/]+)/.exec(candidate.id)?.[1] ??
    /^protocol-([a-z0-9]+)-/.exec(candidate.id)?.[1];
  return normalizeProvider(
    manifestProvider ?? idProvider ?? inferProvider(normalizeText(candidate.id))
  );
}

function catalogFact(
  candidate: CatalogCandidate,
  key: string
): string | undefined {
  const value = candidate.manifest?.facts[key];
  return typeof value === "string" ? value : undefined;
}

function normalizeProvider(value: string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }
  const normalized = value.toLowerCase().replace(/[^a-z0-9]+/g, "");
  return normalized || undefined;
}

function providerForText(text: string): string | undefined {
  const explicit = /\b(?:via|with|using|on)\s+([a-z][a-z0-9-]{1,30})\b/.exec(
    text
  );
  if (explicit?.[1]) {
    return normalizeProvider(explicit[1]);
  }
  const actionProvider =
    /\b(?:send|post)\s+(?:a\s+|an\s+)?([a-z][a-z0-9-]{2,30})\s+(?:alert|message|notification)\b/.exec(
      text
    );
  if (actionProvider?.[1]) {
    return normalizeProvider(actionProvider[1]);
  }
  return undefined;
}

function looksLikeNotificationAction(text: string): boolean {
  return (
    hasAny(text, ["alert", "email", "message", "notification", "notify"]) ||
    containsPhrase(text, "send message")
  );
}

function inferOperation(text: string): string | undefined {
  for (const operation of [
    "delete",
    "publish",
    "create",
    "update",
    "list",
    "send",
    "decode",
    "assess",
    "swap",
    "transfer",
    "write",
    "read",
    "get",
    "run",
    "generate",
    "aggregate",
  ]) {
    if (containsWord(text, operation))
      return operation === "read" ? "get" : operation;
  }
  return undefined;
}

function isNotificationCandidate(
  capability: CatalogCandidateCapability
): boolean {
  return capability.kind === "notification";
}

function isNotificationLikeCandidate(
  capability: CatalogCandidateCapability
): boolean {
  return (
    isNotificationCandidate(capability) || capability.kind === "http_request"
  );
}

function providerAppliesToCapability(
  provider: string,
  capability: CatalogCandidateCapability
): boolean {
  if (
    capability.provider &&
    providerMatchesConstraint(capability.provider, provider)
  ) {
    return true;
  }
  if (isNotificationLikeCandidate(capability)) {
    return isNotificationLikeCandidate(capability);
  }
  return Boolean(capability.provider);
}

function isIdentityConstraint(constraint: IntentConstraint): boolean {
  return [
    "asset_pair",
    "content_kind",
    "notification",
    "provider",
    "resource",
  ].includes(constraint.type);
}

function isIdentityRequirement(requirement: IntentRequirement): boolean {
  return [
    "asset",
    "content_kind",
    "notification_channel",
    "provider",
    "resource",
  ].includes(requirement.type);
}

function isIdentityConstraintDescription(description: string): boolean {
  return /^(asset_pair|content_kind|notification|provider|resource):/.test(
    description
  );
}

function operationAppliesToCapability(
  operation: string,
  capability: CatalogCandidateCapability
): boolean {
  if (operation === "send") {
    return (
      capability.kind === "notification" || capability.kind === "http_request"
    );
  }
  if (operation === "generate") {
    return (
      capability.kind === "ai_generation" || capability.kind === "ui_generation"
    );
  }
  if (["aggregate", "calculate"].includes(operation)) {
    return capability.kind === "numeric_aggregate";
  }
  if (
    ["create", "delete", "get", "list", "publish", "update"].includes(operation)
  ) {
    return Boolean(capability.resource) || capability.kind === "ui_generation";
  }
  if (["run", "transform"].includes(operation)) {
    return (
      capability.kind === "code_execution" || capability.kind === "transform"
    );
  }
  if (["swap", "transfer", "write"].includes(operation)) {
    return capability.kind === "wallet_write";
  }
  return true;
}

function sameText(
  left: string | undefined,
  right: string | undefined
): boolean {
  return Boolean(left && right && left.toLowerCase() === right.toLowerCase());
}

function providerMatchesConstraint(
  candidateProvider: string | undefined,
  requiredProvider: string | undefined
): boolean {
  if (sameText(candidateProvider, requiredProvider)) {
    return true;
  }
  return (
    requiredProvider === "email" &&
    candidateProvider !== undefined &&
    candidateProvider.toLowerCase().includes("email")
  );
}

function allowedOperationsForCapability(
  sourceText: string,
  capability: CatalogCandidateCapability
): Set<string> {
  const terms = operationContextTerms(capability);
  if (terms.length === 0) {
    return new Set();
  }
  const operations: Array<{
    aliases: readonly string[];
    operation: string;
  }> = [
    { aliases: ["add", "create"], operation: "create" },
    { aliases: ["delete", "remove"], operation: "delete" },
    { aliases: ["fetch", "get", "read"], operation: "get" },
    { aliases: ["list"], operation: "list" },
    { aliases: ["publish"], operation: "publish" },
    { aliases: ["edit", "update"], operation: "update" },
    { aliases: ["swap"], operation: "swap" },
    { aliases: ["transfer"], operation: "transfer" },
    { aliases: ["write"], operation: "write" },
  ];
  const allowed = new Set<string>();
  for (const rawSegment of sourceText
    .toLowerCase()
    .split(COMPOSITE_SEPARATOR_PATTERN)) {
    const segment = normalizeText(rawSegment);
    if (!terms.some((term) => containsWord(segment, term))) {
      continue;
    }
    for (const { aliases, operation } of operations) {
      if (aliases.some((alias) => containsWord(segment, alias))) {
        allowed.add(operation);
      }
    }
  }
  return allowed;
}

function matchesPriceFeedStep(
  sourceText: string,
  capability: CatalogCandidateCapability
): boolean {
  if (!capability.assetPair) {
    return true;
  }
  const assetPair = capability.assetPair;
  const source = normalizeText(sourceText);
  if (!(capability.provider && containsWord(source, capability.provider))) {
    return true;
  }
  return sourceText
    .toLowerCase()
    .split(COMPOSITE_SEPARATOR_PATTERN)
    .some((rawSegment) => {
      const segment = normalizeText(rawSegment);
      if (!containsWord(segment, capability.provider ?? "")) return false;
      return segmentMatchesAssetPair(segment, assetPair);
    });
}

function singleProviderMultiAssetIntent(
  intentResolution: IntentResolution,
  capability: CatalogCandidateCapability
): boolean {
  if (!(capability.provider && capability.assetPair)) {
    return false;
  }
  const providerRequirements = intentResolution.requirements.filter(
    (requirement) =>
      requirement.type === "provider" && typeof requirement.value === "string"
  );
  const providers = new Set(providerRequirements.map((item) => item.value));
  const assetRequirementCount = intentResolution.requirements.filter(
    (requirement) => requirement.type === "asset"
  ).length;
  const source = normalizeText(intentResolution.sourceText);
  return (
    providers.size === 1 &&
    providers.has(capability.provider) &&
    assetRequirementCount > 1 &&
    containsWord(source, capability.assetPair.base.toLowerCase()) &&
    hasAny(source, ["feed", "price", "prices", "value"])
  );
}

function segmentMatchesAssetPair(
  segment: string,
  assetPair: NonNullable<CatalogCandidateCapability["assetPair"]>
): boolean {
  const base = assetPair.base.toLowerCase();
  const quote = assetPair.quote.toLowerCase();
  if (new RegExp(`\\b${base}\\s*/\\s*${quote}\\b`).test(segment.trim())) {
    return true;
  }
  if (!containsWord(segment, base)) {
    return false;
  }
  const mentionedAssets = [...segment.matchAll(/\b[a-z0-9]{2,12}\b/g)].flatMap(
    (match) => match[0] ?? []
  );
  const likelyAssetMentions = mentionedAssets.filter(
    (word) => word === base || word === quote || word === "usd"
  );
  return !likelyAssetMentions.some(
    (word) => word !== base && word !== quote && word !== "usd"
  );
}

function operationContextTerms(
  capability: CatalogCandidateCapability
): string[] {
  if (capability.kind === "wallet_write") {
    return [
      capability.provider,
      "transaction",
      "token",
      "swap",
      "transfer",
      "write",
    ].filter((term): term is string => Boolean(term));
  }
  if (capability.kind === "user_management") {
    return ["user", "users"];
  }
  if (capability.kind === "site_management") {
    return ["site", "sites"];
  }
  return [];
}
