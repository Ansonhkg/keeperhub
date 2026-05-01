import { describe, expect, it } from "vitest";
import {
  builderAuthContextSchema,
  builderEventSchema,
  builderOptionSchema,
  builderPatchSchema,
  builderProjectionSchema,
  candidateEvaluationSchema,
  catalogCandidateCapabilitySchema,
  catalogCandidateSchema,
  catalogCapabilityManifestSchema,
  catalogEvaluationResultSchema,
  decisionGroupSchema,
  dynamicRequirementSchema,
  entitySchema,
  intentPlanSchema,
  intentResolutionSchema,
  openQuestionSchema,
} from "../src/core/schemas/all";
import { modelOutputJsonSchemaForName } from "../src/core/schemas/model-output";
import { lintTemplate } from "../src/core/templates/lint";
import { listTemplates, loadTemplate } from "../src/core/templates/loader";

describe("schemas and templates", () => {
  it("validates persisted and LLM-facing contracts", () => {
    expect(
      builderAuthContextSchema.safeParse({
        userId: "u",
        organizationId: "o",
        actorType: "user",
        scopes: [],
      }).success
    ).toBe(true);
    expect(
      entitySchema.safeParse({
        id: "e",
        kind: "asset",
        label: "ETH",
        confidence: 0.9,
      }).success
    ).toBe(true);
    expect(
      catalogCandidateSchema.safeParse({
        id: "c",
        provider: "native",
        label: "Native",
        description: "Native action",
        requiredInputs: [],
        outputFields: [],
        credentialsAvailable: true,
        score: 1,
        capability: {
          assetPair: { base: "ETH", quote: "USD" },
          kind: "price_feed",
          provider: "chronicle",
        },
      }).success
    ).toBe(true);
    expect(
      catalogCandidateCapabilitySchema.safeParse({
        contentKind: "email",
        kind: "notification",
        operation: "send",
        provider: "email",
      }).success
    ).toBe(true);
    const dynamicRequirement = {
      appliesTo: "step-read",
      cardinality: "single",
      evidence: [{ source: "prompt", text: "Track ETH price" }],
      id: "dynamic-requirement-asset-1",
      key: "asset_pair",
      label: "Asset Pair",
      source: "planner",
      status: "satisfied",
      value: "ETH/USD",
    };
    expect(dynamicRequirementSchema.safeParse(dynamicRequirement).success).toBe(
      true
    );
    const manifest = {
      credentialRequired: false,
      description: "Read ETH/USD",
      facts: { provider: "chronicle" },
      optionalFields: [],
      outputFields: [{ key: "price", label: "Price", type: "output" }],
      providerTier: "protocol",
      requiredFields: [{ key: "network", required: true, type: "chain" }],
      risk: "low",
      source: "protocol",
      title: "Chronicle ETH/USD",
    };
    expect(catalogCapabilityManifestSchema.safeParse(manifest).success).toBe(
      true
    );
    const candidateEvaluation = {
      candidateId: "protocol-chronicle-eth-usd",
      conflictingRequirementIds: [],
      decisionGroupId: "decision-dynamic-requirement-asset-1",
      evidence: [{ source: "evaluator", text: "Matches ETH/USD" }],
      missingRequirementIds: [],
      reasons: ["Matches ETH/USD"],
      relationship: "competing",
      requirementIds: ["dynamic-requirement-asset-1"],
      satisfiedRequirementIds: ["dynamic-requirement-asset-1"],
      score: 0.95,
      status: "accepted",
    };
    expect(
      candidateEvaluationSchema.safeParse(candidateEvaluation).success
    ).toBe(true);
    const decisionGroup = {
      candidateIds: ["protocol-chronicle-eth-usd"],
      id: "decision-dynamic-requirement-asset-1",
      label: "Asset Pair",
      recommendedCandidateIds: ["protocol-chronicle-eth-usd"],
      relationship: "competing",
      requirementIds: ["dynamic-requirement-asset-1"],
    };
    expect(decisionGroupSchema.safeParse(decisionGroup).success).toBe(true);
    expect(
      catalogEvaluationResultSchema.safeParse({
        accepted: [],
        decisionGroups: [decisionGroup],
        dynamicRequirements: [dynamicRequirement],
        evidence: [candidateEvaluation],
        rejected: [],
      }).success
    ).toBe(true);
    expect(
      intentResolutionSchema.safeParse({
        intentPlanId: "i",
        actions: [
          {
            id: "step-read",
            kind: "read",
            requirementIds: ["requirement-asset-1"],
            title: "Track ETH price",
          },
        ],
        requirements: [
          {
            appliesTo: "step-read",
            evidence: [{ source: "prompt", text: "Track ETH price" }],
            id: "requirement-asset-1",
            status: "satisfied",
            type: "asset",
            value: "ETH/USD",
          },
        ],
        requiredEntities: [
          { base: "ETH", quote: "USD", required: true, type: "asset_pair" },
        ],
        sourceText: "Track ETH price",
        optionalEntities: [],
        taskHints: ["price_feed"],
      }).success
    ).toBe(true);
    expect(
      builderPatchSchema.safeParse({
        id: "p",
        summary: "Patch",
        ops: [{ op: "answer_question", questionId: "q", answer: "Slack" }],
      }).success
    ).toBe(true);
    expect(
      builderOptionSchema.safeParse({
        id: "o",
        stepId: "s",
        strategy: "native_action",
        title: "Use native",
        rationale: "Best fit",
        risk: "low",
        confidence: 1,
        candidateIds: ["c"],
        patch: {
          id: "p",
          summary: "Patch",
          ops: [{ op: "answer_question", questionId: "q", answer: "Slack" }],
        },
        requiredInputs: [],
      }).success
    ).toBe(true);
    expect(
      openQuestionSchema.safeParse({
        id: "q",
        prompt: "Channel?",
        answerType: "text",
        status: "open",
      }).success
    ).toBe(true);
    expect(
      intentPlanSchema.safeParse({
        id: "i",
        sourceText: "Do it",
        entities: [],
        steps: [],
        openQuestionIds: [],
      }).success
    ).toBe(true);
    expect(
      builderEventSchema.safeParse({
        id: "e",
        sessionId: "s",
        eventKind: "audit",
        stage: "option.select",
        outcome: "accepted",
        actor: {
          userId: "u",
          organizationId: "o",
          actorType: "user",
          scopes: [],
        },
        createdAt: "now",
      }).success
    ).toBe(true);
    expect(
      builderProjectionSchema.safeParse({
        sessionId: "s",
        committed: { id: "w", nodes: [], edges: [] },
        candidateBranches: [],
        options: [],
        questions: [],
        timeline: [],
        validation: { valid: true, issues: [] },
      }).success
    ).toBe(true);
  });

  it("rejects invalid schema payloads", () => {
    expect(
      entitySchema.safeParse({
        id: "e",
        kind: "asset",
        label: "ETH",
        confidence: 2,
      }).success
    ).toBe(false);
    expect(
      builderEventSchema.safeParse({
        eventKind: "audit",
        phaseStatus: "completed",
      }).success
    ).toBe(false);
  });

  it("loads and lints all prompt templates", () => {
    expect(loadTemplate("entity-extractor").spec.version).toBe("1.0.0");
    expect(loadTemplate("candidate-evaluator").spec.version).toBe("1.0.0");
    expect(listTemplates()).toHaveLength(8);
    expect(listTemplates().flatMap(lintTemplate)).toEqual([]);
  });

  it("generates real JSON schema for model outputs", () => {
    const schema = modelOutputJsonSchemaForName("IntentPlan");

    expect(schema).toContain('"properties"');
    expect(schema).toContain('"steps"');
    expect(schema).not.toContain("Step kind must be");
    expect(schema).not.toContain("asset|schedule|channel");
  });
});
