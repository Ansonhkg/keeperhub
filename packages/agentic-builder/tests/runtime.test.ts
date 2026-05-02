import { describe, expect, it } from "vitest";
import type { AiTemplateRunInput, BuilderPorts } from "../src/core/ports/all";
import type {
  BuilderAuthContext,
  BuilderEvent,
  BuilderSession,
  CatalogCandidate,
  FeatureRequest,
  IntentPlan,
} from "../src/core/schemas/all";
import { createBuilderRuntime } from "../src/core/services/runtime";
import { createDeterministicTemplateRunner } from "../src/core/templates/ai-sdk-template-runner";

function createPorts(): BuilderPorts {
  let counter = 0;
  const sessions = new Map<string, BuilderSession>();
  const featureRequests: FeatureRequest[] = [];
  return {
    ai: createDeterministicTemplateRunner(),
    catalog: {
      async search() {
        return [
          {
            id: "chainlink",
            provider: "protocol",
            label: "Chainlink ETH/USD",
            description: "Native Chainlink price feed",
            requiredInputs: ["asset"],
            outputFields: ["price"],
            credentialsAvailable: true,
            score: 0.99,
          },
          {
            id: "chronicle",
            provider: "protocol",
            label: "Chronicle ETH/USD",
            description: "Native Chronicle price feed",
            requiredInputs: ["asset"],
            outputFields: ["price"],
            credentialsAvailable: true,
            score: 0.9,
          },
          {
            id: "http",
            provider: "system",
            label: "HTTP fallback",
            description: "HTTP fallback price read",
            requiredInputs: ["url"],
            outputFields: ["body"],
            credentialsAvailable: true,
            score: 0.4,
          },
        ];
      },
    },
    store: {
      async createSession(_auth, session) {
        sessions.set(session.id, session);
      },
      async getSession(_auth, sessionId) {
        return sessions.get(sessionId);
      },
      async saveSession(_auth, session) {
        sessions.set(session.id, session);
      },
      async listEvents(_auth, sessionId) {
        return sessions.get(sessionId)?.events ?? [];
      },
    },
    featureRequests: {
      async create(_auth, sessionId, missingCapability) {
        const request = {
          id: `fr-${featureRequests.length + 1}`,
          sessionId,
          missingCapability,
          createdAt: "2026-01-01T00:00:00.000Z",
        };
        featureRequests.push(request);
        return request;
      },
    },
    workflowMaterializer: {
      async materialize(input) {
        return {
          revision:
            input.expectedRevision === undefined
              ? 1
              : input.expectedRevision + 1,
          workflowId: input.workflowId ?? "workflow-test-1",
        };
      },
    },
    events: { async emit(_auth, _event: BuilderEvent) {} },
    clock: { now: () => "2026-01-01T00:00:00.000Z" },
    ids: { next: (prefix) => `${prefix}-${++counter}` },
  };
}

function createRecordingPorts(): BuilderPorts & {
  readonly templateCalls: string[];
} {
  const basePorts = createPorts();
  const templateCalls: string[] = [];
  return {
    ...basePorts,
    ai: {
      async run<TOutput>(
        input: AiTemplateRunInput,
        validate: (output: unknown) => TOutput
      ) {
        templateCalls.push(input.templateName);
        return basePorts.ai.run(input, validate);
      },
    },
    templateCalls,
  };
}

function createScenarioPorts(
  candidates: readonly CatalogCandidate[],
  options: {
    readonly acceptRejectedCandidates?: boolean;
    readonly bundledOptionCandidateIds?: readonly string[];
    readonly candidatesByCall?: readonly (readonly CatalogCandidate[])[];
    readonly candidateRequirementIds?: Record<string, readonly string[]>;
    readonly intentInputs?: string[];
    readonly intentPlan?: IntentPlan;
    readonly openQuestionIds?: readonly string[];
    readonly rankedCandidateIds?: string[][];
  } = {}
): BuilderPorts {
  const basePorts = createPorts();
  let searchCount = 0;
  return {
    ...basePorts,
    ai: {
      async run<TOutput>(
        input: AiTemplateRunInput,
        validate: (output: unknown) => TOutput
      ) {
        if (input.templateName === "intent-decomposer") {
          options.intentInputs?.push(input.variables.intent ?? "");
        }
        if (input.templateName === "catalog-ranker") {
          const rankedCandidates = JSON.parse(
            input.variables.candidates || "[]"
          ) as CatalogCandidate[];
          options.rankedCandidateIds?.push(
            rankedCandidates.map((candidate) => candidate.id)
          );
        }
        const output = synthesizeScenarioOutput(input, options);
        return {
          durationMs: 0,
          model: "scenario-template-runner",
          output: validate(output),
          repairAttempts: 0,
        };
      },
    },
    catalog: {
      async search() {
        const callCandidates = options.candidatesByCall?.[searchCount];
        searchCount += 1;
        return callCandidates ?? candidates;
      },
    },
  };
}

function synthesizeScenarioOutput(
  input: AiTemplateRunInput,
  options: {
    readonly acceptRejectedCandidates?: boolean;
    readonly bundledOptionCandidateIds?: readonly string[];
    readonly candidateRequirementIds?: Record<string, readonly string[]>;
    readonly intentPlan?: IntentPlan;
    readonly openQuestionIds?: readonly string[];
  } = {}
): unknown {
  if (input.templateName === "entity-extractor") {
    return { entities: options.intentPlan?.entities ?? [] };
  }
  if (input.templateName === "intent-decomposer") {
    if (options.intentPlan) {
      return {
        ...options.intentPlan,
        sourceText: input.variables.intent ?? options.intentPlan.sourceText,
      };
    }
    const intent = input.variables.intent ?? "Do the thing";
    return {
      entities: [],
      id: "intent-scenario",
      openQuestionIds: options?.openQuestionIds ?? [],
      sourceText: intent,
      steps: [
        {
          dependsOn: [],
          id: "step-scenario",
          kind: "notify",
          label: intent,
          requiredEntityIds: [],
          status: "ready",
        },
      ],
    };
  }
  if (input.templateName === "catalog-ranker") {
    return JSON.parse(input.variables.candidates || "[]") as unknown;
  }
  if (input.templateName === "candidate-evaluator") {
    if (options.acceptRejectedCandidates) {
      const fallback = JSON.parse(input.variables.fallbackEvaluation || "{}");
      return {
        ...fallback,
        evidence: (fallback.evidence ?? []).map(
          (item: { candidateId: string; score?: number }) => ({
            decisionGroupId: `decision-${
              options.candidateRequirementIds?.[item.candidateId]?.[0] ??
              "requirement-asset-1"
            }`,
            candidateId: item.candidateId,
            conflictingRequirementIds: [],
            evidence: [],
            missingRequirementIds: [],
            reasons: ["model accepted"],
            relationship: "competing",
            requirementIds: options.candidateRequirementIds?.[
              item.candidateId
            ] ?? ["requirement-asset-1"],
            satisfiedRequirementIds: options.candidateRequirementIds?.[
              item.candidateId
            ] ?? ["requirement-asset-1"],
            score: item.score ?? 0.9,
            status: "accepted",
          })
        ),
      };
    }
    return JSON.parse(input.variables.fallbackEvaluation || "{}") as unknown;
  }
  if (input.templateName === "option-generator") {
    const candidates = JSON.parse(input.variables.candidates || "[]") as Array<{
      description: string;
      id: string;
      label: string;
      provider: string;
      requiredInputs: string[];
      score: number;
    }>;
    if (options.bundledOptionCandidateIds) {
      const bundledCandidates = candidates.filter((candidate) =>
        options.bundledOptionCandidateIds?.includes(candidate.id)
      );
      return [
        {
          candidateIds: bundledCandidates.map((candidate) => candidate.id),
          confidence: 0.94,
          id: "option-bundled-price-source",
          patch: {
            id: "patch-bundled-price-source",
            ops: [
              {
                changes: {
                  label: bundledCandidates[0]?.label ?? "Use bundled source",
                  status: "ready",
                },
                op: "update_step",
                stepId: "step-read-price",
              },
            ],
            summary: "Use bundled price source",
          },
          rationale: "Bundled competing candidates from the model.",
          requiredInputs: [],
          risk: "low",
          stepId: "step-read-price",
          strategy: "native_action",
          title: "Use bundled price source",
        },
      ];
    }
    return candidates.slice(0, 3).map((candidate) => ({
      candidateIds: [candidate.id],
      confidence: candidate.score,
      id: `option-${candidate.id}`,
      patch: {
        id: `patch-${candidate.id}`,
        ops: [
          {
            changes: { label: candidate.label, status: "ready" },
            op: "update_step",
            stepId: "step-scenario",
          },
        ],
        summary: `Use ${candidate.label}`,
      },
      rationale: candidate.description,
      requiredInputs: candidate.requiredInputs,
      risk: "low",
      stepId: "step-scenario",
      strategy:
        candidate.provider === "native" || candidate.provider === "protocol"
          ? "native_action"
          : "fallback_action",
      title: candidate.label,
    }));
  }
  if (input.templateName === "prediction-engine") {
    return { predictions: [] };
  }
  return {};
}

function candidate(
  id: string,
  label: string,
  description = label
): CatalogCandidate {
  return {
    credentialsAvailable: true,
    description,
    id,
    label,
    outputFields: ["result"],
    provider: id.startsWith("protocol-") ? "protocol" : "native",
    requiredInputs: [],
    score: 0.9,
  };
}

const auth: BuilderAuthContext = {
  userId: "user-1",
  organizationId: "org-1",
  actorType: "user",
  scopes: ["builder:write"],
};

describe("agentic builder runtime", () => {
  it("creates session, options, grey preview branches, questions, events, and committed projection", async () => {
    const ports = createRecordingPorts();
    const runtime = createBuilderRuntime(ports);
    const projection = await runtime.startSession(
      auth,
      "Get ETH price every 15 mins and notify me"
    );

    expect(projection.committed.nodes.map((node) => node.id)).toEqual([
      "step-schedule",
      "step-read-price",
      "step-notify",
    ]);
    expect(projection.committed.edges).toEqual([
      { fromStepId: "step-schedule", toStepId: "step-read-price" },
      { fromStepId: "step-read-price", toStepId: "step-notify" },
    ]);
    expect(projection.options[0]?.title).toContain("Chainlink");
    expect(projection.candidateBranches).toHaveLength(2);
    expect(projection.candidateBranches[0]?.greyNodes[0]?.id).toContain(
      "future-"
    );
    expect(projection.candidateBranches[0]?.dashedEdges).toHaveLength(1);
    expect(projection.questions[0]?.status).toBe("open");
    expect(ports.templateCalls).toEqual([
      "entity-extractor",
      "intent-decomposer",
      "candidate-evaluator",
      "catalog-ranker",
      "option-generator",
      "prediction-engine",
    ]);
    expect(
      (await runtime.getEvents(auth, projection.sessionId)).some(
        (event) => event.stage === "candidate_validation"
      )
    ).toBe(true);
  });

  it("ranks only validated candidates", async () => {
    const rankedCandidateIds: string[][] = [];
    const projection = await createBuilderRuntime(
      createScenarioPorts(
        [
          candidate("native-sendgrid/send-email", "Send Email via SendGrid"),
          candidate("native-slack/send-message", "Send Slack Message"),
        ],
        { rankedCandidateIds }
      )
    ).startSession(auth, "Send a Slack message to the team");

    expect(rankedCandidateIds).toEqual([["native-slack/send-message"]]);
    expect(projection.options.map((option) => option.candidateIds[0])).toEqual([
      "native-slack/send-message",
    ]);
  });

  it("splits bundled competing price candidates into separate options", async () => {
    const intentPlan: IntentPlan = {
      entities: [
        {
          canonicalValue: "ETH",
          confidence: 0.99,
          id: "eth",
          kind: "asset",
          label: "ETH",
        },
        {
          canonicalValue: "webhook",
          confidence: 0.99,
          id: "webhook",
          kind: "notification_channel",
          label: "webhook",
        },
      ],
      id: "intent-price-webhook",
      openQuestionIds: [],
      sourceText:
        "Check the price of ETH every 15 seconds and use a webhook to notify me. Do this three times before finishing the workflow.",
      steps: [
        {
          dependsOn: [],
          id: "step-trigger",
          kind: "trigger",
          label: "Start every 15 seconds",
          requiredEntityIds: [],
          status: "ready",
        },
        {
          dependsOn: ["step-trigger"],
          id: "step-read-price",
          kind: "read",
          label: "Read the current ETH price",
          requiredEntityIds: ["eth"],
          status: "ready",
        },
        {
          dependsOn: ["step-read-price"],
          id: "step-notify",
          kind: "notify",
          label: "Send the price update to the webhook",
          requiredEntityIds: ["webhook"],
          status: "ready",
        },
      ],
    };
    const projection = await createBuilderRuntime(
      createScenarioPorts(
        [
          candidate(
            "protocol-chronicle-eth-usd-read-with-age",
            "Chronicle: Read ETH/USD Value with Age"
          ),
          candidate(
            "protocol-chainlink-eth-usd-latest-round-data",
            "Chainlink: Get ETH/USD Latest Round Data"
          ),
          candidate("native-webhook/send-webhook", "Send Webhook"),
        ],
        {
          bundledOptionCandidateIds: [
            "protocol-chronicle-eth-usd-read-with-age",
            "protocol-chainlink-eth-usd-latest-round-data",
          ],
          intentPlan,
        }
      )
    ).startSession(auth, intentPlan.sourceText);

    expect(projection.options.map((option) => option.candidateIds)).toEqual([
      ["protocol-chronicle-eth-usd-read-with-age"],
      ["protocol-chainlink-eth-usd-latest-round-data"],
    ]);
    expect(projection.options.map((option) => option.title)).toEqual([
      "Chronicle: Read ETH/USD Value with Age",
      "Chainlink: Get ETH/USD Latest Round Data",
    ]);
  });

  it("selects exactly one option into committed state and rejects without moving head", async () => {
    const runtime = createBuilderRuntime(createPorts());
    const projection = await runtime.startSession(
      auth,
      "Get ETH price every 15 mins and notify me"
    );
    const optionId = projection.options[0]?.id;
    if (!optionId) throw new Error("expected option");

    const rejected = await runtime.rejectOption(
      auth,
      projection.sessionId,
      projection.options[1]?.id ?? "missing"
    );
    expect(rejected.headCommitId).toBe(projection.headCommitId);
    const selected = await runtime.selectOption(
      auth,
      projection.sessionId,
      optionId
    );
    expect(selected.headCommitId).not.toBe(projection.headCommitId);
    expect(
      selected.committed.nodes.some((node) => node.id.startsWith("future-"))
    ).toBe(false);
    expect(
      selected.committed.nodes.some((node) =>
        node.label.startsWith("Future follow-up")
      )
    ).toBe(false);
    expect(selected.committed.edges).toContainEqual({
      fromStepId: "step-schedule",
      toStepId: "step-read-price",
    });
    expect(selected.committed.edges).toContainEqual({
      fromStepId: "step-read-price",
      toStepId: "step-notify",
    });
    expect(
      selected.candidateBranches.filter((branch) => branch.status === "open")
    ).toHaveLength(0);
  });

  it("keeps non-competing options selectable after one option is committed", async () => {
    const runtime = createBuilderRuntime(
      createScenarioPorts(
        [
          candidate("native-alpha/do-thing", "Alpha Native Step"),
          candidate("native-beta/do-thing", "Beta Native Step"),
        ],
        {
          acceptRejectedCandidates: true,
          candidateRequirementIds: {
            "native-alpha/do-thing": ["requirement-alpha"],
            "native-beta/do-thing": ["requirement-beta"],
          },
        }
      )
    );
    const projection = await runtime.startSession(
      auth,
      "Use alpha and beta native actions"
    );
    const firstOptionId = projection.options[0]?.id;
    const secondOptionId = projection.options[1]?.id;
    if (!(firstOptionId && secondOptionId)) {
      throw new Error("expected two options");
    }

    const afterFirstSelection = await runtime.selectOption(
      auth,
      projection.sessionId,
      firstOptionId
    );
    const remainingBranch = afterFirstSelection.candidateBranches.find(
      (branch) => branch.optionId === secondOptionId
    );

    expect(remainingBranch).toMatchObject({
      baseCommitId: afterFirstSelection.headCommitId,
      status: "open",
    });

    const afterSecondSelection = await runtime.selectOption(
      auth,
      projection.sessionId,
      secondOptionId
    );
    expect(
      afterSecondSelection.candidateBranches.filter(
        (branch) => branch.status === "open"
      )
    ).toHaveLength(0);
  });

  it("resolves missing capability steps with native or generated-code options", async () => {
    const intentPlan: IntentPlan = {
      entities: [],
      id: "intent-missing-swap",
      openQuestionIds: [],
      sourceText: "Swap ETH back to USDC",
      steps: [
        {
          dependsOn: [],
          id: "step-missing-swap",
          kind: "missing_capability",
          label: "Execute asset swap if required",
          requiredEntityIds: [],
          status: "blocked",
        },
      ],
    };
    const runtime = createBuilderRuntime(
      createScenarioPorts(
        [
          candidate(
            "native-aerodrome/swap-exact-tokens",
            "Aerodrome: Swap Exact Tokens"
          ),
        ],
        { intentPlan }
      )
    );
    const projection = await runtime.startSession(
      auth,
      "Swap ETH back to USDC"
    );

    expect(projection.options[0]).toMatchObject({
      stepId: "step-missing-swap",
      title: "Aerodrome: Swap Exact Tokens",
    });

    const selected = await runtime.selectOption(
      auth,
      projection.sessionId,
      projection.options[0]?.id ?? "missing"
    );

    expect(selected.committed.nodes).toContainEqual(
      expect.objectContaining({
        id: "step-missing-swap",
        kind: "write",
        label: "Aerodrome: Swap Exact Tokens",
        status: "ready",
      })
    );

    const fallbackOnly = await createBuilderRuntime(
      createScenarioPorts([], { intentPlan })
    ).startSession(auth, "Swap ETH back to USDC");

    expect(fallbackOnly.options[0]).toMatchObject({
      stepId: "step-missing-swap",
      strategy: "generated_code",
      title: "Custom code: Execute asset swap if required",
    });
  });

  it("answers questions, regenerates from commit, creates feature requests, materializes committed state, and streams events", async () => {
    const runtime = createBuilderRuntime(createPorts());
    let projection = await runtime.startSession(
      auth,
      "Get ETH price every 15 mins and notify me"
    );
    projection = await runtime.answerQuestion(auth, projection.sessionId, {
      questionId: "question-notification-channel",
      answer: "Slack",
    });
    expect(projection.questions[0]?.status).toBe("answered");
    expect(projection.questions[0]).toMatchObject({
      answer: "Slack",
      stepId: "step-notify",
    });

    projection = await runtime.regenerateFromNode(auth, projection.sessionId, {
      kind: "from_commit",
      commitId: projection.headCommitId ?? "",
    });
    expect(
      projection.candidateBranches.some(
        (branch) => branch.optionId === "regenerated-downstream"
      )
    ).toBe(true);
    await expect(
      runtime.regenerateFromNode(auth, projection.sessionId, {
        kind: "after_node",
        nodeId: "missing-node",
      })
    ).rejects.toThrow("Cannot regenerate without a commit");
    projection = await runtime.requestNativeCapability(
      auth,
      projection.sessionId,
      {
        id: "missing-1",
        originalIntent: "custom risk",
        expectedInputs: ["wallet"],
        expectedOutputs: ["risk"],
        context: { source: "test" },
      }
    );
    projection = await runtime.materializeWorkflow(auth, projection.sessionId, {
      mode: "create",
      idempotencyKey: "idem-1",
      name: "ETH alert",
    });
    const idempotent = await runtime.materializeWorkflow(
      auth,
      projection.sessionId,
      {
        mode: "create",
        idempotencyKey: "idem-1",
        name: "ETH alert",
      }
    );

    expect(projection.validation.valid).toBe(true);
    expect(idempotent.headCommitId).toBe(projection.headCommitId);
    expect(
      (await runtime.getEvents(auth, projection.sessionId)).some(
        (event) => event.stage === "workflow.materialize"
      )
    ).toBe(true);
  });

  it("reruns options after notification-channel question is answered", async () => {
    const runtime = createBuilderRuntime(
      createScenarioPorts([
        candidate("native-sendgrid/send-email", "Send Email via SendGrid"),
        candidate("native-slack/send-message", "Send Slack Message"),
      ])
    );
    const projection = await runtime.startSession(auth, "Notify the team");

    expect(projection.questions).toContainEqual(
      expect.objectContaining({
        id: "question-notification-channel",
        status: "open",
      })
    );
    expect(projection.options).toEqual([]);

    const answered = await runtime.answerQuestion(auth, projection.sessionId, {
      answer: "Slack",
      questionId: "question-notification-channel",
    });

    expect(answered.options.map((option) => option.candidateIds[0])).toEqual([
      "native-slack/send-message",
    ]);
    expect(
      answered.questions.find(
        (question) => question.id === "question-notification-channel"
      )
    ).toMatchObject({ answer: "Slack", status: "answered" });
  });

  it("asks an inline clarification instead of exposing wrong candidates", async () => {
    const ports = createPorts();
    const runtime = createBuilderRuntime({
      ...ports,
      catalog: {
        async search() {
          return [
            {
              credentialsAvailable: true,
              description: "BTC price feed",
              id: "protocol-chainlink-btc-usd-latest-round-data",
              label: "Chainlink BTC/USD",
              outputFields: ["price"],
              provider: "protocol",
              requiredInputs: ["asset"],
              score: 0.99,
            },
          ];
        },
      },
    });

    const projection = await runtime.startSession(
      auth,
      "Track ETH price every 15 minutes"
    );

    expect(projection.options).toHaveLength(0);
    expect(projection.questions).toContainEqual(
      expect.objectContaining({
        answerType: "text",
        id: "question-candidate-clarification",
        prompt: "Which provider, resource, or action should be used?",
        status: "open",
      })
    );
  });

  it("asks for clarification when requirements conflict", async () => {
    const projection = await createBuilderRuntime(
      createScenarioPorts([
        candidate("native-clerk/create-user", "Create User in Clerk"),
        candidate("native-clerk/delete-user", "Delete User from Clerk"),
      ])
    ).startSession(auth, "Create and delete a Clerk user");

    expect(projection.options).toHaveLength(0);
    expect(projection.questions).toContainEqual(
      expect.objectContaining({
        id: "question-candidate-clarification",
        status: "open",
      })
    );
  });

  it("filters explicit native-node prompts at runtime before options are generated", async () => {
    const cases = [
      {
        expected: ["native-slack/send-message"],
        prompt: "Send a Slack message to the team",
        candidates: [
          candidate("native-slack/send-message", "Send Slack Message"),
          candidate("native-sendgrid/send-email", "Send Email via SendGrid"),
          candidate("native-telegram/send-message", "Send Telegram Message"),
          candidate("native-generic/action", "Generic Action"),
        ],
      },
      {
        expected: ["native-sendgrid/send-email", "native-resend/send-email"],
        prompt: "Send an email to the team",
        candidates: [
          candidate("native-slack/send-message", "Send Slack Message"),
          candidate("native-sendgrid/send-email", "Send Email via SendGrid"),
          candidate("native-resend/send-email", "Send Email via Resend"),
        ],
      },
      {
        expected: ["native-sendgrid/send-email"],
        prompt: "Send an email via SendGrid to the team",
        candidates: [
          candidate("native-sendgrid/send-email", "Send Email via SendGrid"),
          candidate("native-resend/send-email", "Send Email via Resend"),
        ],
      },
      {
        expected: ["native-ai-gateway/generate-image"],
        prompt: "Generate an image of a dashboard",
        candidates: [
          candidate("native-ai-gateway/generate-image", "Generate Image"),
          candidate("native-ai-gateway/generate-text", "Generate Text"),
        ],
      },
      {
        expected: ["native-clerk/create-user"],
        prompt: "Create a Clerk user",
        candidates: [
          candidate("native-clerk/create-user", "Create User in Clerk"),
          candidate("native-clerk/delete-user", "Delete User from Clerk"),
          candidate("native-clerk/get-user", "Get User from Clerk"),
        ],
      },
      {
        expected: ["native-webflow/publish-site"],
        prompt: "Publish the Webflow site",
        candidates: [
          candidate("native-webflow/list-sites", "List Sites in Webflow"),
          candidate("native-webflow/get-site", "Get Site in Webflow"),
          candidate("native-webflow/publish-site", "Publish Site in Webflow"),
        ],
      },
    ];

    for (const testCase of cases) {
      const projection = await createBuilderRuntime(
        createScenarioPorts(testCase.candidates)
      ).startSession(auth, testCase.prompt);

      expect(
        projection.options.map((option) => option.candidateIds[0])
      ).toEqual(testCase.expected);
      if (testCase.prompt.toLowerCase().includes("send")) {
        expect(
          projection.questions.some(
            (question) => question.id === "question-notification-channel"
          )
        ).toBe(false);
      }
    }
  });

  it("asks an inline clarification when catalog search returns no candidates", async () => {
    const projection = await createBuilderRuntime(
      createScenarioPorts([])
    ).startSession(auth, "Create a Clerk user");

    expect(projection.options).toHaveLength(0);
    expect(projection.questions).toContainEqual(
      expect.objectContaining({
        answerType: "text",
        id: "question-candidate-clarification",
      })
    );
  });

  it("asks only the unresolved channel question for notify prompts", async () => {
    const projection = await createBuilderRuntime(
      createScenarioPorts([])
    ).startSession(auth, "Notify me when ETH moves");

    expect(projection.options).toHaveLength(0);
    expect(projection.questions.map((question) => question.id)).toEqual([
      "question-notification-channel",
    ]);
  });

  it("asks a condition-criteria question for vague condition language", async () => {
    const prompt = "Notify me when ETH moves significantly";
    const intentPlan: IntentPlan = {
      entities: [
        {
          canonicalValue: "ETH",
          confidence: 1,
          id: "eth",
          kind: "asset",
          label: "ETH",
        },
      ],
      id: "intent-vague-condition",
      openQuestionIds: [],
      sourceText: prompt,
      steps: [
        {
          dependsOn: [],
          id: "step-price",
          kind: "read",
          label: "Read ETH/USD price",
          requiredEntityIds: ["eth"],
          status: "ready",
        },
        {
          dependsOn: ["step-price"],
          id: "step-condition",
          kind: "condition",
          label: "Determine whether the ETH move is significant",
          requiredEntityIds: [],
          status: "ready",
        },
        {
          dependsOn: ["step-condition"],
          id: "step-notify",
          kind: "notify",
          label: "Notify me about the move",
          requiredEntityIds: [],
          status: "ready",
        },
      ],
    };

    const projection = await createBuilderRuntime(
      createScenarioPorts([], { intentPlan })
    ).startSession(auth, prompt);

    expect(projection.questions).toContainEqual(
      expect.objectContaining({
        id: "question-condition-criteria-step-condition",
        prompt: "What counts as a significant move for ETH?",
        status: "open",
        stepId: "step-condition",
      })
    );
  });

  it("keeps explicit cached absolute-delta prompts resolved and routes true and false branches", async () => {
    const prompt =
      "Check the current ETH price and cache it, use the cached ETH price as a fixed constant value, then get the fresh eth price every 5 seconds, it if moves by $0.10, notify me via Telegram. If not, just log it. Do this for 30 seconds.";
    const intentPlan: IntentPlan = {
      entities: [
        {
          canonicalValue: "ETH",
          confidence: 1,
          id: "eth",
          kind: "asset",
          label: "ETH",
        },
      ],
      id: "intent-cached-delta",
      openQuestionIds: [],
      sourceText: prompt,
      steps: [
        {
          dependsOn: [],
          id: "step-baseline",
          kind: "read",
          label: "Read and cache the current ETH/USD price as baseline",
          requiredEntityIds: ["eth"],
          status: "ready",
        },
        {
          dependsOn: ["step-baseline"],
          id: "step-fresh",
          kind: "read",
          label: "Get the fresh ETH/USD price every 5 seconds for 30 seconds",
          requiredEntityIds: ["eth"],
          status: "ready",
        },
        {
          dependsOn: ["step-fresh"],
          id: "step-condition",
          kind: "condition",
          label:
            "Determine whether fresh ETH price moved by $0.10 from cached baseline",
          requiredEntityIds: [],
          status: "ready",
        },
        {
          dependsOn: ["step-condition"],
          id: "step-route",
          kind: "condition",
          label: "If price moved by at least $0.10, route to notification",
          requiredEntityIds: [],
          status: "ready",
        },
        {
          dependsOn: ["step-route"],
          id: "step-telegram",
          kind: "notify",
          label: "Notify me via Telegram",
          requiredEntityIds: [],
          status: "ready",
        },
      ],
    };

    const projection = await createBuilderRuntime(
      createScenarioPorts([], { intentPlan })
    ).startSession(auth, prompt);

    expect(
      projection.questions.some((question) =>
        question.id.startsWith("question-condition-criteria")
      )
    ).toBe(false);
    expect(
      projection.questions.some(
        (question) => question.id === "question-notification-channel"
      )
    ).toBe(false);
    expect(projection.committed.nodes).toContainEqual(
      expect.objectContaining({
        id: "step-condition-false-log",
        label: "Log the price when the threshold is not met",
      })
    );
    expect(
      projection.committed.nodes.some((node) => node.id === "step-route")
    ).toBe(false);
    expect(projection.committed.nodes).toContainEqual(
      expect.objectContaining({
        dependsOn: ["step-fresh"],
        id: "step-condition",
      })
    );
    expect(projection.committed.nodes).toContainEqual(
      expect.objectContaining({
        dependsOn: ["step-condition"],
        id: "step-telegram",
      })
    );
    expect(projection.committed.edges).toContainEqual(
      expect.objectContaining({
        fromStepId: "step-condition",
        sourceHandle: "true",
        toStepId: "step-telegram",
      })
    );
    expect(projection.committed.edges).toContainEqual(
      expect.objectContaining({
        fromStepId: "step-condition",
        sourceHandle: "false",
        toStepId: "step-condition-false-log",
      })
    );
  });

  it("connects current-price reads into cache steps for stateful baseline prompts", async () => {
    const prompt =
      "Check the current ETH price and cache it, use the cached ETH price as a fixed constant value, then get the fresh eth price every 5 seconds, it if moves by $0.10, notify me via Telegram. If not, just log it. Do this for 30 seconds.";
    const intentPlan: IntentPlan = {
      entities: [
        {
          canonicalValue: "ETH",
          confidence: 1,
          id: "eth",
          kind: "asset",
          label: "ETH",
        },
      ],
      id: "intent-cached-delta-split",
      openQuestionIds: [],
      sourceText: prompt,
      steps: [
        {
          dependsOn: [],
          id: "step-trigger",
          kind: "trigger",
          label: "Start workflow manually",
          requiredEntityIds: [],
          status: "ready",
        },
        {
          dependsOn: [],
          id: "step-current",
          kind: "read",
          label: "Read current ETH market price",
          requiredEntityIds: ["eth"],
          status: "ready",
        },
        {
          dependsOn: [],
          id: "step-cache",
          kind: "transform",
          label: "Cache the current ETH price as reference value",
          requiredEntityIds: ["eth"],
          status: "ready",
        },
        {
          dependsOn: ["step-cache"],
          id: "step-fresh",
          kind: "read",
          label: "Read fresh ETH price every 5 seconds for 30 seconds",
          requiredEntityIds: ["eth"],
          status: "ready",
        },
        {
          dependsOn: ["step-fresh"],
          id: "step-condition",
          kind: "condition",
          label:
            "Check whether ETH price moved by at least $0.10 from cached reference",
          requiredEntityIds: [],
          status: "ready",
        },
      ],
    };

    const projection = await createBuilderRuntime(
      createScenarioPorts([], { intentPlan })
    ).startSession(auth, prompt);

    expect(projection.committed.nodes).toContainEqual(
      expect.objectContaining({
        dependsOn: ["step-trigger"],
        id: "step-current",
      })
    );
    expect(projection.committed.nodes).toContainEqual(
      expect.objectContaining({
        dependsOn: ["step-current"],
        id: "step-cache",
      })
    );
    expect(projection.committed.edges).toContainEqual(
      expect.objectContaining({
        fromStepId: "step-current",
        toStepId: "step-cache",
      })
    );
    expect(projection.committed.nodes).toContainEqual(
      expect.objectContaining({
        dependsOn: ["step-fresh"],
        id: "step-condition",
      })
    );
    expect(projection.committed.nodes).toContainEqual(
      expect.objectContaining({
        dependsOn: ["step-condition"],
        id: "step-condition-true-notify",
        kind: "notify",
      })
    );
    expect(projection.committed.edges).toContainEqual(
      expect.objectContaining({
        fromStepId: "step-fresh",
        toStepId: "step-condition",
      })
    );
    expect(projection.committed.edges).toContainEqual(
      expect.objectContaining({
        fromStepId: "step-condition",
        sourceHandle: "true",
        toStepId: "step-condition-true-notify",
      })
    );
  });

  it("reruns planning after condition criteria is answered", async () => {
    const prompt = "Notify me when ETH moves significantly";
    const intentInputs: string[] = [];
    const intentPlan: IntentPlan = {
      entities: [
        {
          canonicalValue: "ETH",
          confidence: 1,
          id: "eth",
          kind: "asset",
          label: "ETH",
        },
      ],
      id: "intent-condition-answer",
      openQuestionIds: [],
      sourceText: prompt,
      steps: [
        {
          dependsOn: [],
          id: "step-price",
          kind: "read",
          label: "Read ETH/USD price",
          requiredEntityIds: ["eth"],
          status: "ready",
        },
        {
          dependsOn: ["step-price"],
          id: "step-condition",
          kind: "condition",
          label: "Determine whether the ETH move is significant",
          requiredEntityIds: [],
          status: "ready",
        },
      ],
    };
    const runtime = createBuilderRuntime(
      createScenarioPorts([], { intentInputs, intentPlan })
    );
    const firstProjection = await runtime.startSession(auth, prompt);

    const clarifiedProjection = await runtime.answerQuestion(
      auth,
      firstProjection.sessionId,
      {
        answer: "More than 5% since the previous check",
        questionId: "question-condition-criteria-step-condition",
      }
    );

    expect(intentInputs.at(-1)).toContain(
      "Condition clarification: More than 5% since the previous check"
    );
    expect(
      clarifiedProjection.questions.find(
        (question) =>
          question.id === "question-condition-criteria-step-condition"
      )?.status
    ).toBe("answered");
  });

  it("filters stale planner notification questions when the prompt names the channel", async () => {
    const projection = await createBuilderRuntime(
      createScenarioPorts(
        [candidate("native-slack/send-message", "Send Slack Message")],
        { openQuestionIds: ["question-notification-channel"] }
      )
    ).startSession(auth, "Send a Slack message to the team");

    expect(projection.options.map((option) => option.candidateIds[0])).toEqual([
      "native-slack/send-message",
    ]);
    expect(
      projection.questions.some(
        (question) => question.id === "question-notification-channel"
      )
    ).toBe(false);
  });

  it("does not ask for a notification channel when webhook is explicit", async () => {
    const projection = await createBuilderRuntime(
      createScenarioPorts([
        candidate("native-webhook/send-webhook", "Send Webhook"),
        candidate("native-slack/send-message", "Send Slack Message"),
      ])
    ).startSession(auth, "Notify the team via webhook");

    expect(projection.options.map((option) => option.candidateIds[0])).toEqual([
      "native-webhook/send-webhook",
    ]);
    expect(
      projection.questions.some(
        (question) => question.id === "question-notification-channel"
      )
    ).toBe(false);
    expect(
      projection.questions.some(
        (question) => question.id === "question-webhook-url"
      )
    ).toBe(true);
  });

  it("replans with a webhook URL answer instead of treating webhook as a channel question", async () => {
    const intentInputs: string[] = [];
    const runtime = createBuilderRuntime(
      createScenarioPorts(
        [candidate("native-webhook/send-webhook", "Send Webhook")],
        { intentInputs }
      )
    );
    const projection = await runtime.startSession(
      auth,
      "Use webhook to notify me"
    );

    await runtime.answerQuestion(auth, projection.sessionId, {
      answer: "http://127.0.0.1:4318/api/webhook/notify",
      questionId: "question-webhook-url",
    });

    expect(intentInputs.at(-1)).toContain(
      "Webhook URL: http://127.0.0.1:4318/api/webhook/notify"
    );
  });

  it("does not ask generic channel questions for explicit notification alternatives", async () => {
    const cases = [
      {
        candidates: [
          candidate("native-slack/send-message", "Send Slack Message"),
          candidate("native-sendgrid/send-email", "Send Email via SendGrid"),
          candidate("native-telegram/send-message", "Send Telegram Message"),
        ],
        expected: ["native-slack/send-message", "native-sendgrid/send-email"],
        prompt: "Notify me via SendGrid or Slack",
      },
      {
        candidates: [
          candidate("native-slack/send-message", "Send Slack Message"),
          candidate("native-webhook/send-webhook", "Send Webhook"),
          candidate("native-telegram/send-message", "Send Telegram Message"),
        ],
        expected: ["native-slack/send-message", "native-webhook/send-webhook"],
        prompt: "Notify me via webhook or Slack",
      },
      {
        candidates: [
          candidate("native-discord/send-message", "Send Discord Message"),
          candidate("native-resend/send-email", "Send Email via Resend"),
          candidate("native-telegram/send-message", "Send Telegram Message"),
        ],
        expected: ["native-discord/send-message", "native-resend/send-email"],
        prompt: "Notify me via Resend or Discord",
      },
    ];

    for (const testCase of cases) {
      const projection = await createBuilderRuntime(
        createScenarioPorts(testCase.candidates)
      ).startSession(auth, testCase.prompt);

      expect(
        projection.options.map((option) => option.candidateIds[0])
      ).toEqual(testCase.expected);
      expect(
        projection.questions.some(
          (question) => question.id === "question-notification-channel"
        )
      ).toBe(false);
    }
  });

  it("spreads generated options across satisfied workflow requirements", async () => {
    const prompt =
      "Track ETH price every 15 minutes and notify me, if it drops below 2000 USD then swap it back to USDC.";
    const intentPlan: IntentPlan = {
      entities: [
        {
          confidence: 1,
          id: "eth",
          kind: "asset",
          label: "ETH",
          canonicalValue: "ETH",
        },
        {
          confidence: 1,
          id: "usdc",
          kind: "asset",
          label: "USDC",
          canonicalValue: "USDC",
        },
      ],
      id: "intent-swap-runtime",
      openQuestionIds: ["question-notification-channel"],
      sourceText: prompt,
      steps: [
        {
          dependsOn: [],
          id: "step-schedule",
          kind: "trigger",
          label: "Run every 15 minutes",
          requiredEntityIds: [],
          status: "ready",
        },
        {
          dependsOn: ["step-schedule"],
          id: "step-read-price",
          kind: "read",
          label: "Read ETH/USD price",
          requiredEntityIds: ["eth"],
          status: "ready",
        },
        {
          dependsOn: ["step-read-price"],
          id: "step-threshold",
          kind: "condition",
          label: "If ETH price drops below 2000 USD",
          requiredEntityIds: [],
          status: "ready",
        },
        {
          dependsOn: ["step-threshold"],
          id: "step-notify",
          kind: "notify",
          label: "Notify me about the ETH price drop",
          requiredEntityIds: [],
          status: "needs_answer",
        },
        {
          dependsOn: ["step-threshold"],
          id: "step-swap",
          kind: "write",
          label: "Swap ETH back to USDC",
          requiredEntityIds: ["eth", "usdc"],
          status: "ready",
        },
      ],
    };

    const projection = await createBuilderRuntime(
      createScenarioPorts(
        [
          candidate(
            "protocol-chainlink-eth-usd-latest-round-data",
            "Chainlink: Get ETH/USD Latest Round Data"
          ),
          candidate(
            "protocol-chainlink-eth-usd-decimals",
            "Chainlink: Get ETH/USD Decimals"
          ),
          candidate(
            "protocol-chainlink-usdc-usd-latest-round-data",
            "Chainlink: Get USDC/USD Latest Round Data"
          ),
          candidate(
            "native-uniswap/swap-exact-input",
            "Uniswap V3: Swap Exact Input",
            "Swap exact input tokens through Uniswap"
          ),
        ],
        { acceptRejectedCandidates: true, intentPlan }
      )
    ).startSession(auth, prompt);

    expect(projection.options.map((option) => option.candidateIds[0])).toEqual([
      "protocol-chainlink-eth-usd-latest-round-data",
      "native-uniswap/swap-exact-input",
      "protocol-chainlink-eth-usd-decimals",
    ]);
    expect(projection.options.map((option) => option.stepId)).toEqual([
      "step-read-price",
      "step-swap",
      "step-read-price",
    ]);
    expect(
      projection.options.some((option) =>
        option.candidateIds.includes(
          "protocol-chainlink-usdc-usd-latest-round-data"
        )
      )
    ).toBe(false);
  });

  it("offers native channels in the ambiguous notification-channel question", async () => {
    const projection = await createBuilderRuntime(
      createScenarioPorts([
        candidate("native-slack/send-message", "Send Slack Message"),
        candidate("native-discord/send-message", "Send Discord Message"),
      ])
    ).startSession(auth, "Notify the team");

    expect(
      projection.questions.find(
        (question) => question.id === "question-notification-channel"
      )?.choices
    ).toEqual(["Discord", "Slack"]);
  });

  it("reruns planning and options after no-safe-candidate clarification is answered", async () => {
    const runtime = createBuilderRuntime(
      createScenarioPorts([], {
        candidatesByCall: [
          [],
          [candidate("native-slack/send-message", "Send Slack Message")],
        ],
      })
    );
    const firstProjection = await runtime.startSession(auth, "Notify the team");

    expect(firstProjection.options).toHaveLength(0);
    expect(firstProjection.questions).toContainEqual(
      expect.objectContaining({ id: "question-notification-channel" })
    );

    const clarifiedProjection = await runtime.answerQuestion(
      auth,
      firstProjection.sessionId,
      {
        answer: "Slack",
        questionId: "question-notification-channel",
      }
    );

    expect(
      clarifiedProjection.options.map((option) => option.candidateIds[0])
    ).toEqual(["native-slack/send-message"]);
    expect(
      clarifiedProjection.questions.find(
        (question) => question.id === "question-notification-channel"
      )?.status
    ).toBe("answered");
    expect(
      clarifiedProjection.questions.some(
        (question) => question.id === "question-candidate-clarification"
      )
    ).toBe(false);
  });

  it("keeps clarification actionable when the rerun still has no safe candidates", async () => {
    const runtime = createBuilderRuntime(
      createScenarioPorts([], {
        candidatesByCall: [[], []],
      })
    );
    const firstProjection = await runtime.startSession(
      auth,
      "Create a Clerk user"
    );
    const clarifiedProjection = await runtime.answerQuestion(
      auth,
      firstProjection.sessionId,
      {
        answer: "Use Clerk",
        questionId: "question-candidate-clarification",
      }
    );

    expect(clarifiedProjection.options).toHaveLength(0);
    expect(
      clarifiedProjection.questions.find(
        (question) => question.id === "question-candidate-clarification"
      )?.status
    ).toBe("open");
  });

  it("accumulates repeated clarification answers across reruns", async () => {
    const intentInputs: string[] = [];
    const runtime = createBuilderRuntime(
      createScenarioPorts([], {
        candidatesByCall: [[], [], []],
        intentInputs,
      })
    );
    const firstProjection = await runtime.startSession(auth, "Notify the team");
    const secondProjection = await runtime.answerQuestion(
      auth,
      firstProjection.sessionId,
      {
        answer: "Use Clerk",
        questionId: "question-candidate-clarification",
      }
    );
    await runtime.answerQuestion(auth, secondProjection.sessionId, {
      answer: "Create user",
      questionId: "question-candidate-clarification",
    });

    expect(
      intentInputs.some(
        (input) => input.includes("Use Clerk") && input.includes("Create user")
      )
    ).toBe(true);
  });
});
