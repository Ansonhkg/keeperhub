import { describe, expect, it } from "vitest";
import type {
  CatalogCandidate,
  IntentPlan,
  IntentResolution,
} from "../src/core/schemas/all";
import { evaluateCatalogCandidates } from "../src/core/services/candidate-evaluation";
import { validateCatalogCandidates } from "../src/core/services/candidate-validation";
import {
  inferCandidateCapability,
  resolveIntentConstraints,
} from "../src/core/services/runtime";

function plan(sourceText: string): IntentPlan {
  const entities = sourceText.includes("ETH")
    ? [
        {
          canonicalValue: "ETH",
          confidence: 0.95,
          id: "entity-eth",
          kind: "asset" as const,
          label: "ETH",
        },
      ]
    : [];
  return {
    entities,
    id: "intent-test",
    openQuestionIds: [],
    sourceText,
    steps: [
      {
        dependsOn: [],
        id: "step-1",
        kind: "read",
        label: sourceText,
        requiredEntityIds: entities.map((entity) => entity.id),
        status: "ready",
      },
    ],
  };
}

function planWithAsset(sourceText: string, asset: string): IntentPlan {
  return {
    ...plan(sourceText),
    entities: [
      {
        canonicalValue: asset,
        confidence: 0.95,
        id: `entity-${asset.toLowerCase()}`,
        kind: "asset",
        label: asset,
      },
    ],
  };
}

function conditionPlan(sourceText: string, label: string): IntentPlan {
  const base = plan(sourceText);
  return {
    ...base,
    steps: [
      {
        dependsOn: [],
        id: "step-read",
        kind: "read",
        label: "Read ETH/USD price",
        requiredEntityIds: base.entities.map((entity) => entity.id),
        status: "ready",
      },
      {
        dependsOn: ["step-read"],
        id: "step-condition",
        kind: "condition",
        label,
        requiredEntityIds: [],
        status: "ready",
      },
    ],
  };
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

describe("intent resolution and candidate validation", () => {
  it("asks for condition criteria when the prompt uses vague threshold language", () => {
    const resolution = resolveIntentConstraints(
      conditionPlan(
        "Notify me when ETH moves significantly",
        "Determine whether the ETH move is significant"
      )
    );

    expect(resolution.dynamicRequirements).toContainEqual(
      expect.objectContaining({
        appliesTo: "step-condition",
        key: "condition.criteria",
        question: expect.objectContaining({
          id: "question-condition-criteria-step-condition",
          prompt: "What counts as a significant move for ETH?",
        }),
        status: "missing",
      })
    );
  });

  it("dedupes identical vague condition questions from repeated condition steps", () => {
    const base = conditionPlan(
      "Notify me when ETH moves significantly",
      "Determine whether the ETH move is significant"
    );
    const resolution = resolveIntentConstraints({
      ...base,
      steps: [
        ...base.steps,
        {
          dependsOn: ["step-condition"],
          id: "step-condition-duplicate",
          kind: "condition",
          label: "Check whether ETH movement is significant enough to notify",
          requiredEntityIds: [],
          status: "ready",
        },
      ],
    });

    expect(
      (resolution.dynamicRequirements ?? []).filter(
        (requirement) =>
          requirement.key === "condition.criteria" &&
          requirement.status === "missing"
      )
    ).toHaveLength(1);
  });

  it("does not ask market-threshold questions for operational success guards", () => {
    const resolution = resolveIntentConstraints(
      conditionPlan(
        "Check the price of ETH every 15 seconds and notify me by webhook 3 times",
        "Check whether the price read succeeded"
      )
    );

    expect(
      (resolution.dynamicRequirements ?? []).some(
        (requirement) => requirement.key === "condition.criteria"
      )
    ).toBe(false);
  });

  it("satisfies condition criteria when the prompt includes a measurable threshold", () => {
    const priceResolution = resolveIntentConstraints(
      conditionPlan(
        "Notify me when ETH drops below 2000 USD",
        "If ETH price drops below 2000 USD"
      )
    );
    expect(priceResolution.dynamicRequirements).toContainEqual(
      expect.objectContaining({
        key: "condition.criteria",
        status: "satisfied",
        value: expect.objectContaining({
          kind: "price_threshold",
          operator: "<",
          threshold: 2000,
          unit: "USD",
        }),
      })
    );

    const percentResolution = resolveIntentConstraints(
      conditionPlan(
        "Notify me when ETH moves more than 5%",
        "If ETH price moves more than 5%"
      )
    );
    expect(percentResolution.dynamicRequirements).toContainEqual(
      expect.objectContaining({
        key: "condition.criteria",
        status: "satisfied",
        value: expect.objectContaining({
          baseline: "previous_run",
          kind: "percent_change",
          operator: ">",
          threshold: 5,
          unit: "%",
        }),
      })
    );
  });

  it("derives stateful absolute-delta intent without asking for condition criteria", () => {
    const prompt =
      "Check the current ETH price and cache it, use the cached ETH price as a fixed constant value, then get the fresh eth price every 5 seconds, it if moves by $0.10, notify me via Telegram. If not, just log it. Do this for 30 seconds.";
    const resolution = resolveIntentConstraints(
      conditionPlan(
        prompt,
        "Determine whether fresh ETH price moved by $0.10 from cached baseline"
      )
    );

    expect(resolution.intentIR).toMatchObject({
      conditions: [
        {
          baselineRef: "baselineEthUsdPrice",
          freshRef: "freshEthUsdPrice",
          kind: "absolute_delta",
          metric: "ETH/USD",
          operator: ">=",
          threshold: 0.1,
          unit: "USD",
        },
      ],
      state: [
        {
          id: "baselineEthUsdPrice",
          mutability: "constant",
          timing: "before_loop",
        },
        {
          id: "freshEthUsdPrice",
          mutability: "mutable",
          timing: "inside_loop",
        },
      ],
      temporal: [
        {
          durationSeconds: 30,
          intervalSeconds: 5,
          mode: "bounded_loop",
        },
      ],
    });
    expect(resolution.dynamicRequirements).toContainEqual(
      expect.objectContaining({
        key: "condition.criteria",
        requirementKind: "condition.delta",
        status: "satisfied",
        value: expect.objectContaining({
          baselineRef: "baselineEthUsdPrice",
          freshRef: "freshEthUsdPrice",
          kind: "absolute_delta",
          operator: ">=",
          threshold: 0.1,
          unit: "USD",
        }),
      })
    );
    expect(
      (resolution.dynamicRequirements ?? []).some(
        (requirement) =>
          requirement.key === "condition.criteria" &&
          requirement.status === "missing"
      )
    ).toBe(false);
    expect(resolution.dynamicRequirements).toContainEqual(
      expect.objectContaining({
        key: "temporal.bounded_loop",
        requirementKind: "temporal.duration",
        status: "unsupported",
        value: expect.objectContaining({
          durationSeconds: 30,
          intervalSeconds: 5,
        }),
      })
    );
    expect(resolution.dynamicRequirements).toContainEqual(
      expect.objectContaining({
        key: "branch.false",
        requirementKind: "branch.false",
        status: "unsupported",
        value: expect.objectContaining({
          action: "log",
          when: "false",
        }),
      })
    );
  });

  it("derives stateful absolute-delta refs from the dynamic asset pair", () => {
    const sourceText =
      "Check the current SOL price and cache it, use the cached SOL price as a fixed constant value, then get the fresh SOL price every 5 seconds, if it moves by $0.10, notify me via Telegram. If not, just log it. Do this for 30 seconds.";
    const base = planWithAsset(sourceText, "SOL");
    const resolution = resolveIntentConstraints({
      ...base,
      steps: [
        {
          dependsOn: [],
          id: "step-read",
          kind: "read",
          label: "Read SOL/USD price",
          requiredEntityIds: base.entities.map((entity) => entity.id),
          status: "ready",
        },
        {
          dependsOn: ["step-read"],
          id: "step-condition",
          kind: "condition",
          label:
            "Determine whether fresh SOL price moved by $0.10 from cached baseline",
          requiredEntityIds: [],
          status: "ready",
        },
      ],
    });

    expect(resolution.intentIR).toMatchObject({
      conditions: [
        {
          baselineRef: "baselineSolUsdPrice",
          freshRef: "freshSolUsdPrice",
          kind: "absolute_delta",
          metric: "SOL/USD",
        },
      ],
      state: [{ id: "baselineSolUsdPrice" }, { id: "freshSolUsdPrice" }],
    });
    expect(resolution.dynamicRequirements).toContainEqual(
      expect.objectContaining({
        key: "condition.criteria",
        requirementKind: "condition.delta",
        value: expect.objectContaining({
          baselineRef: "baselineSolUsdPrice",
          freshRef: "freshSolUsdPrice",
          metric: "SOL/USD",
        }),
      })
    );
  });

  it("creates required ETH/USD constraints without inventing assets", () => {
    const ethResolution = resolveIntentConstraints(
      plan("Track ETH price every 15 minutes")
    );
    expect(ethResolution.requiredEntities).toContainEqual({
      base: "ETH",
      quote: "USD",
      required: true,
      sourceEntityId: "entity-eth",
      type: "asset_pair",
    });
    expect(ethResolution.requirements).toContainEqual(
      expect.objectContaining({
        status: "satisfied",
        type: "asset",
        value: "ETH/USD",
      })
    );

    const ambiguousResolution = resolveIntentConstraints(
      plan("Track token price")
    );
    expect(
      ambiguousResolution.requiredEntities.some(
        (constraint) => constraint.type === "asset_pair"
      )
    ).toBe(false);
    expect(ambiguousResolution.requirements).toContainEqual(
      expect.objectContaining({
        status: "missing",
        type: "asset",
      })
    );

    const missingAssetResult = validateCatalogCandidates(ambiguousResolution, [
      candidate(
        "protocol-chainlink-eth-usd-latest-round-data",
        "Chainlink ETH/USD"
      ),
      candidate(
        "protocol-chainlink-btc-usd-latest-round-data",
        "Chainlink BTC/USD"
      ),
    ]);
    expect(missingAssetResult.accepted.map((item) => item.id)).toEqual([]);

    const explicitPairResolution = resolveIntentConstraints(
      plan("Track SOL/BTC price")
    );
    expect(explicitPairResolution.requiredEntities).toContainEqual({
      base: "SOL",
      quote: "BTC",
      required: true,
      type: "asset_pair",
    });
    const arbitraryPairResolution = resolveIntentConstraints(
      plan("Track SOL/JPY price")
    );
    const arbitraryPairResult = validateCatalogCandidates(
      arbitraryPairResolution,
      [
        candidate(
          "protocol-chainlink-sol-jpy-latest-round-data",
          "Chainlink SOL/JPY"
        ),
        candidate(
          "protocol-chainlink-sol-usd-latest-round-data",
          "Chainlink SOL/USD"
        ),
      ]
    );
    expect(arbitraryPairResult.accepted.map((item) => item.id)).toEqual([
      "protocol-chainlink-sol-jpy-latest-round-data",
    ]);

    const solResolution = resolveIntentConstraints(
      planWithAsset("Track SOL price", "SOL")
    );
    expect(solResolution.requiredEntities).toContainEqual({
      base: "SOL",
      quote: "USD",
      required: true,
      sourceEntityId: "entity-sol",
      type: "asset_pair",
    });
    const solResult = validateCatalogCandidates(solResolution, [
      candidate(
        "protocol-chainlink-sol-usd-latest-round-data",
        "Chainlink SOL/USD"
      ),
      candidate(
        "protocol-chainlink-btc-usd-latest-round-data",
        "Chainlink BTC/USD"
      ),
    ]);
    expect(solResult.accepted.map((item) => item.id)).toEqual([
      "protocol-chainlink-sol-usd-latest-round-data",
    ]);
  });

  it("does not let hallucinated entities satisfy missing notification channels", () => {
    const resolution = resolveIntentConstraints({
      entities: [
        {
          canonicalValue: "Chronicle",
          confidence: 0.8,
          id: "entity-hallucinated-channel",
          kind: "channel",
          label: "Chronicle",
        },
      ],
      id: "intent-notify-me",
      openQuestionIds: [],
      sourceText: "Track ETH price every 15 minutes and notify me.",
      steps: [
        {
          dependsOn: [],
          id: "step-read",
          kind: "read",
          label: "Read ETH price",
          requiredEntityIds: [],
          status: "planned",
        },
        {
          dependsOn: ["step-read"],
          id: "step-notify",
          kind: "notify",
          label: "Notify me",
          requiredEntityIds: ["entity-hallucinated-channel"],
          status: "needs_answer",
        },
      ],
    });

    expect(resolution.requirements).toContainEqual(
      expect.objectContaining({
        appliesTo: "step-notify",
        status: "missing",
        type: "notification_channel",
      })
    );
    expect(resolution.dynamicRequirements).toContainEqual(
      expect.objectContaining({
        question: expect.objectContaining({
          id: "question-notification-channel",
        }),
        status: "missing",
      })
    );
  });

  it("does not turn swap output tokens into price feed requirements", () => {
    const resolution = resolveIntentConstraints({
      entities: [
        {
          canonicalValue: "Ethereum",
          confidence: 0.99,
          id: "eth",
          kind: "asset",
          label: "ETH",
        },
        {
          canonicalValue: "USD Coin",
          confidence: 0.98,
          id: "usdc",
          kind: "asset",
          label: "USDC",
        },
        {
          canonicalValue: "token swap",
          confidence: 0.83,
          id: "swap",
          kind: "protocol",
          label: "swap it back to USDC",
        },
      ],
      id: "intent-swap-test",
      openQuestionIds: [],
      sourceText:
        "Track ETH price every 15 minutes and notify me, if it drops below 2000 USD then swap it back to USDC.",
      steps: [
        {
          dependsOn: [],
          id: "step-read",
          kind: "read",
          label: "Read the current ETH price.",
          requiredEntityIds: ["eth"],
          status: "planned",
        },
        {
          dependsOn: ["step-read"],
          id: "step-write",
          kind: "write",
          label: "Execute the swap to convert ETH back to USDC.",
          requiredEntityIds: ["eth", "usdc", "swap"],
          status: "planned",
        },
      ],
    });

    expect(
      resolution.requirements
        .filter((requirement) => requirement.type === "asset")
        .map((requirement) => requirement.value)
    ).toEqual(["ETH/USD"]);
    expect(resolution.requirements).toContainEqual(
      expect.objectContaining({
        appliesTo: "step-write",
        status: "satisfied",
        type: "operation",
        value: "swap",
      })
    );

    const result = validateCatalogCandidates(resolution, [
      candidate(
        "protocol-chainlink-eth-usd-latest-round-data",
        "Chainlink: Get ETH/USD Latest Round Data"
      ),
      candidate(
        "protocol-chainlink-usdc-usd-latest-round-data",
        "Chainlink: Get USDC/USD Latest Round Data"
      ),
      candidate(
        "protocol-uniswap-swap-exact-input",
        "Uniswap V3: Swap Exact Input",
        "Swap an exact amount of input tokens for as many output tokens as possible"
      ),
      candidate(
        "native-aave-v4/get-user-debt",
        "Aave V4: Get User Debt",
        "Get user debt"
      ),
    ]);

    expect(result.accepted.map((item) => item.id)).toEqual([
      "protocol-chainlink-eth-usd-latest-round-data",
      "protocol-uniswap-swap-exact-input",
    ]);
  });

  it("models notification channel requirement satisfaction states", () => {
    const slackResolution = resolveIntentConstraints(
      plan("Slack me when ETH moves")
    );
    expect(slackResolution.requirements).toContainEqual(
      expect.objectContaining({
        status: "satisfied",
        type: "notification_channel",
        value: "slack",
      })
    );

    const missingResolution = resolveIntentConstraints(
      plan("Notify me when ETH moves")
    );
    expect(missingResolution.requirements).toContainEqual(
      expect.objectContaining({
        status: "missing",
        type: "notification_channel",
      })
    );

    const ambiguousResolution = resolveIntentConstraints(
      plan("Notify me via Slack or Email")
    );
    expect(ambiguousResolution.requirements).toContainEqual(
      expect.objectContaining({
        candidates: ["slack", "email"],
        status: "ambiguous",
        type: "notification_channel",
      })
    );
  });

  it("derives dynamic multi-target notification requirements without hardcoded single-choice behavior", () => {
    const multiTargetResolution = resolveIntentConstraints(
      plan("Notify me via Slack and Email")
    );
    expect(multiTargetResolution.dynamicRequirements).toContainEqual(
      expect.objectContaining({
        cardinality: "multiple",
        key: "notification.channel",
        status: "satisfied",
        value: ["slack", "email"],
      })
    );

    const alternativeResolution = resolveIntentConstraints(
      plan("Notify me via Slack or Email")
    );
    expect(alternativeResolution.dynamicRequirements).toContainEqual(
      expect.objectContaining({
        cardinality: "single_or_multiple",
        candidates: ["slack", "email"],
        key: "notification.channel",
        status: "ambiguous",
      })
    );
  });

  it("marks same-action incompatible operations as conflicting requirements", () => {
    const resolution = resolveIntentConstraints(
      plan("Create and delete a Clerk user")
    );

    expect(resolution.requirements).toContainEqual(
      expect.objectContaining({
        status: "conflicting",
        type: "operation",
        value: "create",
      })
    );
    expect(resolution.requirements).toContainEqual(
      expect.objectContaining({
        status: "conflicting",
        type: "operation",
        value: "delete",
      })
    );
  });

  it("attaches requirements to the action that owns their entity or channel", () => {
    const resolution = resolveIntentConstraints({
      entities: [
        {
          canonicalValue: "ETH",
          confidence: 0.95,
          id: "entity-eth",
          kind: "asset",
          label: "ETH",
        },
        {
          canonicalValue: "BTC",
          confidence: 0.95,
          id: "entity-btc",
          kind: "asset",
          label: "BTC",
        },
      ],
      id: "intent-composite",
      openQuestionIds: [],
      sourceText: "Track ETH price, track BTC price, Slack me",
      steps: [
        {
          dependsOn: [],
          id: "read-eth",
          kind: "read",
          label: "Track ETH price",
          requiredEntityIds: ["entity-eth"],
          status: "ready",
        },
        {
          dependsOn: [],
          id: "read-btc",
          kind: "read",
          label: "Track BTC price",
          requiredEntityIds: ["entity-btc"],
          status: "ready",
        },
        {
          dependsOn: [],
          id: "notify-slack",
          kind: "notify",
          label: "Slack me",
          requiredEntityIds: [],
          status: "ready",
        },
      ],
    });

    expect(resolution.requirements).toContainEqual(
      expect.objectContaining({
        appliesTo: "read-eth",
        type: "asset",
        value: "ETH/USD",
      })
    );
    expect(resolution.requirements).toContainEqual(
      expect.objectContaining({
        appliesTo: "read-btc",
        type: "asset",
        value: "BTC/USD",
      })
    );
    expect(resolution.requirements).toContainEqual(
      expect.objectContaining({
        appliesTo: "notify-slack",
        type: "notification_channel",
        value: "slack",
      })
    );
  });

  it("uses requirements as the candidate validation decision boundary", () => {
    const resolution: IntentResolution = {
      actions: [
        {
          id: "notify-1",
          kind: "notify",
          requirementIds: ["requirement-notification_channel-1"],
          title: "Slack me",
        },
      ],
      intentPlanId: "intent-requirement-only",
      optionalEntities: [],
      requiredEntities: [],
      requirements: [
        {
          appliesTo: "notify-1",
          evidence: [{ source: "prompt", text: "Slack me" }],
          id: "requirement-notification_channel-1",
          status: "satisfied",
          type: "notification_channel",
          value: "slack",
        },
      ],
      sourceText: "Slack me",
      taskHints: ["notification"],
    };
    const result = validateCatalogCandidates(resolution, [
      candidate("native-slack/send-message", "Send Slack Message"),
      candidate("native-sendgrid/send-email", "Send Email via SendGrid"),
    ]);

    expect(result.accepted.map((item) => item.id)).toEqual([
      "native-slack/send-message",
    ]);
    expect(result.evidence[0]?.requirementEvaluations).toContainEqual(
      expect.objectContaining({
        requirementId: "requirement-notification_channel-1",
        status: "satisfied",
      })
    );
  });

  it("rejects wrong asset price-feed options before option generation", () => {
    const resolution = resolveIntentConstraints(
      plan("Track ETH price every 15 minutes and notify me")
    );
    const result = validateCatalogCandidates(resolution, [
      candidate(
        "protocol-chronicle-eth-usd-read-with-age",
        "Chronicle ETH/USD"
      ),
      candidate(
        "protocol-chainlink-eth-usd-latest-round-data",
        "Chainlink ETH/USD"
      ),
      candidate(
        "protocol-chainlink-btc-usd-latest-round-data",
        "Chainlink BTC/USD"
      ),
      candidate(
        "protocol-chronicle-dai-usd-read-with-age",
        "Chronicle DAI/USD"
      ),
    ]);

    expect(result.accepted.map((item) => item.id)).toEqual([
      "protocol-chronicle-eth-usd-read-with-age",
      "protocol-chainlink-eth-usd-latest-round-data",
    ]);
    expect(result.evidence[0]?.requirementEvaluations).toContainEqual(
      expect.objectContaining({
        requirementId: expect.stringContaining("requirement-asset"),
        status: "satisfied",
      })
    );
    expect(result.rejected.map((item) => item.id)).toEqual([
      "protocol-chainlink-btc-usd-latest-round-data",
      "protocol-chronicle-dai-usd-read-with-age",
    ]);
    expect(
      result.evidence.find((item) => item.status === "rejected")?.reasons
    ).toEqual(expect.arrayContaining(["violates asset_pair:ETH/USD"]));
  });

  it("evaluates candidates into decision groups and suppresses non-native fallbacks when native fits", () => {
    const result = evaluateCatalogCandidates(
      resolveIntentConstraints(plan("Track ETH price every 15 minutes")),
      [
        candidate(
          "protocol-chainlink-eth-usd-latest-round-data",
          "Chainlink ETH/USD"
        ),
        {
          ...candidate("workflow-eth-price-alert", "ETH price workflow"),
          provider: "workflow",
        },
      ]
    );

    expect(result.accepted.map((item) => item.id)).toEqual([
      "protocol-chainlink-eth-usd-latest-round-data",
    ]);
    expect(result.evidence).toContainEqual(
      expect.objectContaining({
        candidateId: "protocol-chainlink-eth-usd-latest-round-data",
        relationship: "competing",
        status: "accepted",
      })
    );
    expect(result.decisionGroups[0]).toEqual(
      expect.objectContaining({
        candidateIds: ["protocol-chainlink-eth-usd-latest-round-data"],
      })
    );
  });

  it("keeps explicit notification channels from becoming interchangeable", () => {
    const slackResult = validateCatalogCandidates(
      resolveIntentConstraints(plan("Send a Slack message to the team")),
      [
        candidate("native-slack/send-message", "Send Slack Message"),
        candidate("native-sendgrid/send-email", "Send Email"),
        candidate("native-telegram/send-message", "Send Telegram Message"),
        candidate("native-discord/send-message", "Send Discord Message"),
      ]
    );

    expect(slackResult.accepted.map((item) => item.id)).toEqual([
      "native-slack/send-message",
    ]);
    expect(slackResult.rejected.map((item) => item.id)).toEqual([
      "native-sendgrid/send-email",
      "native-telegram/send-message",
      "native-discord/send-message",
    ]);

    const emailResult = validateCatalogCandidates(
      resolveIntentConstraints(plan("Send an email to the team")),
      [
        candidate("native-slack/send-message", "Send Slack Message"),
        candidate("native-sendgrid/send-email", "Send Email via SendGrid"),
        candidate("native-resend/send-email", "Send Email via Resend"),
      ]
    );
    expect(emailResult.accepted.map((item) => item.id)).toEqual([
      "native-sendgrid/send-email",
      "native-resend/send-email",
    ]);

    const emailTeamResult = validateCatalogCandidates(
      resolveIntentConstraints(plan("Email the team")),
      [
        candidate("native-slack/send-message", "Send Slack Message"),
        candidate("native-sendgrid/send-email", "Send Email via SendGrid"),
      ]
    );
    expect(emailTeamResult.accepted.map((item) => item.id)).toEqual([
      "native-sendgrid/send-email",
    ]);

    const bareEmailResult = validateCatalogCandidates(
      resolveIntentConstraints(plan("Email")),
      [
        candidate("native-slack/send-message", "Send Slack Message"),
        candidate("native-sendgrid/send-email", "Send Email via SendGrid"),
      ]
    );
    expect(bareEmailResult.accepted.map((item) => item.id)).toEqual([
      "native-sendgrid/send-email",
    ]);

    const bareSlackResult = validateCatalogCandidates(
      resolveIntentConstraints(plan("Slack")),
      [
        candidate("native-slack/send-message", "Send Slack Message"),
        candidate("native-sendgrid/send-email", "Send Email via SendGrid"),
        candidate("native-discord/send-message", "Send Discord Message"),
      ]
    );
    expect(bareSlackResult.accepted.map((item) => item.id)).toEqual([
      "native-slack/send-message",
    ]);

    const bareSendGridResult = validateCatalogCandidates(
      resolveIntentConstraints(plan("SendGrid")),
      [
        candidate("native-slack/send-message", "Send Slack Message"),
        candidate("native-sendgrid/send-email", "Send Email via SendGrid"),
        candidate("native-discord/send-message", "Send Discord Message"),
      ]
    );
    expect(bareSendGridResult.accepted.map((item) => item.id)).toEqual([
      "native-sendgrid/send-email",
    ]);

    const sendGridResult = validateCatalogCandidates(
      resolveIntentConstraints(plan("Send an email via SendGrid to the team")),
      [
        candidate("native-sendgrid/send-email", "Send Email via SendGrid"),
        candidate("native-resend/send-email", "Send Email via Resend"),
      ]
    );
    expect(sendGridResult.accepted.map((item) => item.id)).toEqual([
      "native-sendgrid/send-email",
    ]);

    const contentMentionResult = validateCatalogCandidates(
      resolveIntentConstraints(
        plan("Send a Slack message about a SendGrid outage")
      ),
      [
        candidate("native-slack/send-message", "Send Slack Message"),
        candidate("native-sendgrid/send-email", "Send Email via SendGrid"),
      ]
    );
    expect(contentMentionResult.accepted.map((item) => item.id)).toEqual([
      "native-slack/send-message",
    ]);
    const ambiguousResolution = resolveIntentConstraints(
      plan("Notify me in Slack or email")
    );
    expect(
      ambiguousResolution.requiredEntities
        .filter((constraint) => constraint.type === "notification")
        .map((constraint) => constraint.channel)
    ).toEqual(["slack", "email"]);
    expect(
      ambiguousResolution.requiredEntities.some(
        (constraint) =>
          constraint.type === "provider" &&
          ["email", "slack"].includes(constraint.provider)
      )
    ).toBe(false);
    expect(
      ambiguousResolution.requiredEntities.some(
        (constraint) =>
          constraint.type === "content_kind" &&
          constraint.contentKind === "email"
      )
    ).toBe(false);
    const ambiguousResult = validateCatalogCandidates(ambiguousResolution, [
      candidate("native-slack/send-message", "Send Slack Message"),
      candidate("native-sendgrid/send-email", "Send Email via SendGrid"),
      candidate("native-resend/send-email", "Send Email via Resend"),
    ]);
    expect(ambiguousResult.accepted.map((item) => item.id)).toEqual([
      "native-slack/send-message",
      "native-sendgrid/send-email",
      "native-resend/send-email",
    ]);

    const mixedProviderAmbiguityResult = validateCatalogCandidates(
      resolveIntentConstraints(plan("Notify me via SendGrid or Slack")),
      [
        candidate("native-slack/send-message", "Send Slack Message"),
        candidate("native-sendgrid/send-email", "Send Email via SendGrid"),
        candidate("native-telegram/send-message", "Send Telegram Message"),
      ]
    );
    expect(
      mixedProviderAmbiguityResult.accepted.map((item) => item.id)
    ).toEqual(["native-slack/send-message", "native-sendgrid/send-email"]);

    const webhookAmbiguityResolution = resolveIntentConstraints(
      plan("Notify me via webhook or Slack")
    );
    expect(
      webhookAmbiguityResolution.requiredEntities
        .filter((constraint) => constraint.type === "notification")
        .map((constraint) => constraint.channel)
    ).toEqual(["slack", "webhook"]);
    const webhookAmbiguityResult = validateCatalogCandidates(
      webhookAmbiguityResolution,
      [
        candidate("native-slack/send-message", "Send Slack Message"),
        candidate("native-webhook/send-webhook", "Send Webhook"),
        candidate("native-telegram/send-message", "Send Telegram Message"),
      ]
    );
    expect(webhookAmbiguityResult.accepted.map((item) => item.id)).toEqual([
      "native-slack/send-message",
      "native-webhook/send-webhook",
    ]);

    const resendAmbiguityResult = validateCatalogCandidates(
      resolveIntentConstraints(plan("Notify me via Resend or Discord")),
      [
        candidate("native-discord/send-message", "Send Discord Message"),
        candidate("native-resend/send-email", "Send Email via Resend"),
        candidate("native-telegram/send-message", "Send Telegram Message"),
      ]
    );
    expect(resendAmbiguityResult.accepted.map((item) => item.id)).toEqual([
      "native-discord/send-message",
      "native-resend/send-email",
    ]);

    const notifyResult = validateCatalogCandidates(
      resolveIntentConstraints(plan("Notify the team")),
      [
        candidate("native-slack/send-message", "Send Slack Message"),
        candidate("native-webhook/send-webhook", "Send Webhook"),
        candidate("native-clerk/create-user", "Create User in Clerk"),
      ]
    );
    expect(notifyResult.accepted.map((item) => item.id)).toEqual([]);

    const alertResult = validateCatalogCandidates(
      resolveIntentConstraints(plan("Alert in Slack when ETH moves")),
      [
        candidate("native-slack/send-message", "Send Slack Message"),
        candidate("native-sendgrid/send-email", "Send Email via SendGrid"),
      ]
    );
    expect(alertResult.accepted.map((item) => item.id)).toEqual([
      "native-slack/send-message",
    ]);

    const slackMeResult = validateCatalogCandidates(
      resolveIntentConstraints(plan("Slack me when ETH moves")),
      [
        candidate("native-slack/send-message", "Send Slack Message"),
        candidate("native-sendgrid/send-email", "Send Email via SendGrid"),
      ]
    );
    expect(slackMeResult.accepted.map((item) => item.id)).toEqual([
      "native-slack/send-message",
    ]);

    const emailMeResult = validateCatalogCandidates(
      resolveIntentConstraints(plan("Email me when ETH moves")),
      [
        candidate("native-slack/send-message", "Send Slack Message"),
        candidate("native-sendgrid/send-email", "Send Email via SendGrid"),
      ]
    );
    expect(emailMeResult.accepted.map((item) => item.id)).toEqual([
      "native-sendgrid/send-email",
    ]);

    const imageAttachmentResult = validateCatalogCandidates(
      resolveIntentConstraints(
        plan("Send a Slack message with an image attachment")
      ),
      [
        candidate("native-slack/send-message", "Send Slack Message"),
        candidate("native-ai-gateway/generate-image", "Generate Image"),
      ]
    );
    expect(imageAttachmentResult.accepted.map((item) => item.id)).toEqual([
      "native-slack/send-message",
    ]);
  });

  it("does not turn generic calculation verbs into a hard Math provider", () => {
    const resolution = resolveIntentConstraints(
      plan("Calculate average ETH price")
    );

    expect(
      resolution.requiredEntities.some(
        (constraint) =>
          constraint.type === "provider" && constraint.provider === "math"
      )
    ).toBe(false);
  });

  it("does not treat provider words inside generated content as hard providers", () => {
    const slackResolution = resolveIntentConstraints(
      plan("Generate an image of a Slack dashboard")
    );

    expect(slackResolution.requiredEntities).toContainEqual({
      contentKind: "image",
      required: true,
      type: "content_kind",
    });
    expect(
      slackResolution.requiredEntities.some(
        (constraint) =>
          constraint.type === "provider" && constraint.provider === "slack"
      )
    ).toBe(false);
    expect(
      slackResolution.requiredEntities.some(
        (constraint) => constraint.type === "notification"
      )
    ).toBe(false);

    const v0ImageResult = validateCatalogCandidates(
      resolveIntentConstraints(plan("Generate an image of a v0 landing page")),
      [
        candidate("native-ai-gateway/generate-image", "Generate Image"),
        candidate("native-v0/create-chat", "Create Chat in v0"),
      ]
    );
    expect(v0ImageResult.accepted.map((item) => item.id)).toEqual([
      "native-ai-gateway/generate-image",
    ]);

    const aiGatewaySubjectResult = validateCatalogCandidates(
      resolveIntentConstraints(
        plan("Generate an image of an AI Gateway dashboard")
      ),
      [
        candidate("native-ai-gateway/generate-image", "Generate Image"),
        candidate("native-ai-gateway/generate-text", "Generate Text"),
      ]
    );
    expect(aiGatewaySubjectResult.accepted.map((item) => item.id)).toEqual([
      "native-ai-gateway/generate-image",
    ]);

    const explicitAiGatewayResult = validateCatalogCandidates(
      resolveIntentConstraints(plan("Generate an image via AI Gateway")),
      [
        candidate("native-ai-gateway/generate-image", "Generate Image"),
        {
          ...candidate(
            "native-other/generate-image",
            "Generate Image Elsewhere"
          ),
          capability: {
            contentKind: "image",
            kind: "ai_generation",
            operation: "generate",
            provider: "other-ai",
          },
        },
      ]
    );
    expect(explicitAiGatewayResult.accepted.map((item) => item.id)).toEqual([
      "native-ai-gateway/generate-image",
    ]);
    const explicitAiGatewayWithResult = validateCatalogCandidates(
      resolveIntentConstraints(plan("Generate an image with AI Gateway")),
      [
        candidate("native-ai-gateway/generate-image", "Generate Image"),
        {
          ...candidate(
            "native-other/generate-image",
            "Generate Image Elsewhere"
          ),
          capability: {
            contentKind: "image",
            kind: "ai_generation",
            operation: "generate",
            provider: "other-ai",
          },
        },
      ]
    );
    expect(explicitAiGatewayWithResult.accepted.map((item) => item.id)).toEqual(
      ["native-ai-gateway/generate-image"]
    );

    const clerkResolution = resolveIntentConstraints(
      plan("Generate an image of a Clerk login screen")
    );
    expect(
      clerkResolution.requiredEntities.some(
        (constraint) =>
          constraint.type === "provider" && constraint.provider === "clerk"
      )
    ).toBe(false);
    const webflowResolution = resolveIntentConstraints(
      plan("Generate a Webflow landing page mockup")
    );
    expect(
      webflowResolution.requiredEntities.some(
        (constraint) =>
          constraint.type === "provider" && constraint.provider === "webflow"
      )
    ).toBe(false);
  });

  it("treats generated JavaScript as text generation, not code execution", () => {
    const resolution = resolveIntentConstraints(
      plan("Generate JavaScript to parse CSV")
    );

    expect(resolution.requiredEntities).toContainEqual({
      contentKind: "text",
      required: true,
      type: "content_kind",
    });
    expect(
      resolution.requiredEntities.some(
        (constraint) =>
          constraint.type === "provider" && constraint.provider === "code"
      )
    ).toBe(false);
  });

  it("treats generated email copy as text generation, not email sending", () => {
    const result = validateCatalogCandidates(
      resolveIntentConstraints(plan("Generate an email to welcome a new user")),
      [
        candidate("native-ai-gateway/generate-text", "Generate Text"),
        candidate("native-sendgrid/send-email", "Send Email via SendGrid"),
      ]
    );

    expect(result.accepted.map((item) => item.id)).toEqual([
      "native-ai-gateway/generate-text",
    ]);
  });

  it("treats generated site copy as text generation", () => {
    const result = validateCatalogCandidates(
      resolveIntentConstraints(plan("Generate copy for a site")),
      [
        candidate("native-ai-gateway/generate-text", "Generate Text"),
        candidate("native-webflow/publish-site", "Publish Site in Webflow"),
      ]
    );

    expect(result.accepted.map((item) => item.id)).toEqual([
      "native-ai-gateway/generate-text",
    ]);
  });

  it("treats generic generated summaries as text generation", () => {
    const result = validateCatalogCandidates(
      resolveIntentConstraints(plan("Generate a summary of the workflow")),
      [
        candidate("native-ai-gateway/generate-text", "Generate Text"),
        candidate("native-ai-gateway/generate-image", "Generate Image"),
      ]
    );

    expect(result.accepted.map((item) => item.id)).toEqual([
      "native-ai-gateway/generate-text",
    ]);
  });

  it("accepts v0 UI generation for site and page prompts", () => {
    const result = validateCatalogCandidates(
      resolveIntentConstraints(plan("Create a v0 landing page site")),
      [
        candidate("native-v0/create-chat", "Create Chat in v0"),
        candidate("native-ai-gateway/generate-text", "Generate Text"),
        candidate("native-webflow/publish-site", "Publish Site in Webflow"),
      ]
    );

    expect(result.accepted.map((item) => item.id)).toEqual([
      "native-v0/create-chat",
    ]);

    const heroImageResult = validateCatalogCandidates(
      resolveIntentConstraints(
        plan("Create a v0 landing page site with a hero image")
      ),
      [
        candidate("native-v0/create-chat", "Create Chat in v0"),
        candidate("native-ai-gateway/generate-image", "Generate Image"),
      ]
    );

    expect(heroImageResult.accepted.map((item) => item.id)).toEqual([
      "native-v0/create-chat",
    ]);
  });

  it("does not add default USD constraints for the quote side of explicit pairs", () => {
    const resolution = resolveIntentConstraints(plan("Track ETH/BTC price"));

    expect(
      resolution.requiredEntities.filter(
        (constraint) => constraint.type === "asset_pair"
      )
    ).toEqual([
      { base: "ETH", quote: "BTC", required: true, type: "asset_pair" },
    ]);

    const result = validateCatalogCandidates(resolution, [
      candidate(
        "protocol-chainlink-eth-btc-latest-round-data",
        "Chainlink ETH/BTC"
      ),
      candidate(
        "protocol-chainlink-eth-usd-latest-round-data",
        "Chainlink ETH/USD"
      ),
    ]);
    expect(result.accepted.map((item) => item.id)).toEqual([
      "protocol-chainlink-eth-btc-latest-round-data",
    ]);
  });

  it("rejects wrong content kind and wrong resource operations", () => {
    const imageResult = validateCatalogCandidates(
      resolveIntentConstraints(plan("Generate an image of a workflow")),
      [
        candidate("native-ai-gateway/generate-image", "Generate Image"),
        candidate("native-ai-gateway/generate-text", "Generate Text"),
      ]
    );
    expect(imageResult.accepted.map((item) => item.id)).toEqual([
      "native-ai-gateway/generate-image",
    ]);

    const clerkResult = validateCatalogCandidates(
      resolveIntentConstraints(plan("Create a Clerk user")),
      [
        candidate(
          "protocol-chainlink-eth-usd-latest-round-data",
          "Chainlink ETH/USD"
        ),
        candidate("native-clerk/create-user", "Create User in Clerk"),
        candidate("native-clerk/get-user", "Get User from Clerk"),
        candidate("native-clerk/update-user", "Update User in Clerk"),
        candidate("native-clerk/delete-user", "Delete User from Clerk"),
      ]
    );
    expect(clerkResult.accepted.map((item) => item.id)).toEqual([
      "native-clerk/create-user",
    ]);

    const webflowResult = validateCatalogCandidates(
      resolveIntentConstraints(plan("Publish the Webflow site")),
      [
        candidate("native-webflow/list-sites", "List Sites in Webflow"),
        candidate("native-webflow/get-site", "Get Site in Webflow"),
        candidate("native-webflow/publish-site", "Publish Site in Webflow"),
      ]
    );
    expect(webflowResult.accepted.map((item) => item.id)).toEqual([
      "native-webflow/publish-site",
    ]);
  });

  it("accepts candidates that satisfy separate steps in composite prompts", () => {
    const notificationResult = validateCatalogCandidates(
      resolveIntentConstraints(
        plan("Track ETH price every 15 minutes and send a Slack message")
      ),
      [
        candidate(
          "protocol-chainlink-eth-usd-latest-round-data",
          "Chainlink ETH/USD"
        ),
        candidate("native-slack/send-message", "Send Slack Message"),
        candidate("native-sendgrid/send-email", "Send Email via SendGrid"),
      ]
    );

    expect(notificationResult.accepted.map((item) => item.id)).toEqual([
      "protocol-chainlink-eth-usd-latest-round-data",
      "native-slack/send-message",
    ]);

    const clerkResult = validateCatalogCandidates(
      resolveIntentConstraints(plan("Track ETH price and create a Clerk user")),
      [
        candidate(
          "protocol-chainlink-eth-usd-latest-round-data",
          "Chainlink ETH/USD"
        ),
        candidate("native-clerk/create-user", "Create User in Clerk"),
        candidate("native-clerk/delete-user", "Delete User in Clerk"),
      ]
    );
    expect(clerkResult.accepted.map((item) => item.id)).toEqual([
      "protocol-chainlink-eth-usd-latest-round-data",
      "native-clerk/create-user",
    ]);

    const nativeProviderResult = validateCatalogCandidates(
      resolveIntentConstraints(
        plan("Create a Clerk user, publish the Webflow site")
      ),
      [
        candidate("native-clerk/create-user", "Create User in Clerk"),
        candidate("native-clerk/delete-user", "Delete User in Clerk"),
        candidate("native-clerk/publish-user", "Publish User in Clerk"),
        candidate("native-webflow/create-site", "Create Site in Webflow"),
        candidate("native-webflow/publish-site", "Publish Site in Webflow"),
        candidate("native-webflow/list-sites", "List Sites in Webflow"),
      ]
    );
    expect(nativeProviderResult.accepted.map((item) => item.id)).toEqual([
      "native-clerk/create-user",
      "native-webflow/publish-site",
    ]);

    const multiChannelResult = validateCatalogCandidates(
      resolveIntentConstraints(plan("Send a Slack message; email the team")),
      [
        candidate("native-slack/send-message", "Send Slack Message"),
        candidate("native-sendgrid/send-email", "Send Email via SendGrid"),
        candidate("native-telegram/send-message", "Send Telegram Message"),
      ]
    );
    expect(multiChannelResult.accepted.map((item) => item.id)).toEqual([
      "native-slack/send-message",
      "native-sendgrid/send-email",
    ]);

    const multiAssetResult = validateCatalogCandidates(
      resolveIntentConstraints(
        plan("Track ETH price with Chronicle, track BTC price with Chainlink")
      ),
      [
        candidate(
          "protocol-chronicle-eth-usd-read-with-age",
          "Chronicle ETH/USD"
        ),
        candidate(
          "protocol-chainlink-btc-usd-latest-round-data",
          "Chainlink BTC/USD"
        ),
        candidate(
          "protocol-chronicle-btc-usd-read-with-age",
          "Chronicle BTC/USD"
        ),
        candidate(
          "protocol-chainlink-eth-usd-latest-round-data",
          "Chainlink ETH/USD"
        ),
        candidate(
          "protocol-chainlink-dai-usd-latest-round-data",
          "Chainlink DAI/USD"
        ),
      ]
    );
    expect(multiAssetResult.accepted.map((item) => item.id)).toEqual([
      "protocol-chronicle-eth-usd-read-with-age",
      "protocol-chainlink-btc-usd-latest-round-data",
    ]);

    const singleProviderPriceResult = validateCatalogCandidates(
      resolveIntentConstraints(plan("Track ETH price with Chronicle")),
      [
        candidate(
          "protocol-chronicle-eth-usd-read-with-age",
          "Chronicle ETH/USD"
        ),
        candidate(
          "protocol-chainlink-eth-usd-latest-round-data",
          "Chainlink ETH/USD"
        ),
      ]
    );
    expect(singleProviderPriceResult.accepted.map((item) => item.id)).toEqual([
      "protocol-chronicle-eth-usd-read-with-age",
    ]);

    const trailingProviderResult = validateCatalogCandidates(
      resolveIntentConstraints(
        plan("Track ETH price and AVAX price with Chronicle")
      ),
      [
        candidate(
          "protocol-chronicle-eth-usd-read-with-age",
          "Chronicle ETH/USD"
        ),
        candidate(
          "protocol-chronicle-avax-usd-read-with-age",
          "Chronicle AVAX/USD"
        ),
        candidate(
          "protocol-chainlink-eth-usd-latest-round-data",
          "Chainlink ETH/USD"
        ),
      ]
    );
    expect(trailingProviderResult.accepted.map((item) => item.id)).toEqual([
      "protocol-chronicle-eth-usd-read-with-age",
      "protocol-chronicle-avax-usd-read-with-age",
    ]);

    const aiUiResult = validateCatalogCandidates(
      resolveIntentConstraints(
        plan("Generate text with AI Gateway, create a v0 component")
      ),
      [
        candidate("native-ai-gateway/generate-text", "Generate Text"),
        candidate("native-v0/create-chat", "Create Chat in v0"),
        candidate("native-ai-gateway/generate-image", "Generate Image"),
      ]
    );
    expect(aiUiResult.accepted.map((item) => item.id)).toEqual([
      "native-ai-gateway/generate-text",
      "native-v0/create-chat",
    ]);

    const emailVerificationResult = validateCatalogCandidates(
      resolveIntentConstraints(
        plan("Create a Clerk user with email verification")
      ),
      [
        candidate("native-clerk/create-user", "Create User in Clerk"),
        candidate("native-sendgrid/send-email", "Send Email via SendGrid"),
      ]
    );
    expect(emailVerificationResult.accepted.map((item) => item.id)).toEqual([
      "native-clerk/create-user",
    ]);
  });

  it("rejects mixed-domain candidates that satisfy only generic operations", () => {
    const result = validateCatalogCandidates(
      resolveIntentConstraints(plan("Send a Slack message to the team")),
      [
        candidate("native-slack/send-message", "Send Slack Message"),
        candidate("native-webhook/send-webhook", "Send Webhook"),
        candidate(
          "protocol-chainlink-eth-usd-latest-round-data",
          "Chainlink ETH/USD"
        ),
      ]
    );

    expect(result.accepted.map((item) => item.id)).toEqual([
      "native-slack/send-message",
    ]);
  });

  it("rejects destructive candidates unless destructive intent is explicit", () => {
    const safeResult = validateCatalogCandidates(
      resolveIntentConstraints(plan("Get a Clerk user")),
      [
        candidate("native-clerk/get-user", "Get User from Clerk"),
        candidate("native-clerk/update-user", "Update User in Clerk"),
        candidate("native-clerk/delete-user", "Delete User from Clerk"),
      ]
    );
    expect(safeResult.accepted.map((item) => item.id)).toEqual([
      "native-clerk/get-user",
    ]);

    const destructiveResult = validateCatalogCandidates(
      resolveIntentConstraints(plan("Delete a Clerk user")),
      [
        candidate("native-clerk/get-user", "Get User from Clerk"),
        candidate("native-clerk/delete-user", "Delete User from Clerk"),
      ]
    );
    expect(destructiveResult.accepted.map((item) => item.id)).toEqual([
      "native-clerk/delete-user",
    ]);

    const aliasCompositeResult = validateCatalogCandidates(
      resolveIntentConstraints(
        plan("Remove a Clerk user, create a Webflow site")
      ),
      [
        candidate("native-clerk/create-user", "Create User in Clerk"),
        candidate("native-clerk/delete-user", "Delete User from Clerk"),
        candidate("native-webflow/create-site", "Create Site in Webflow"),
      ]
    );
    expect(aliasCompositeResult.accepted.map((item) => item.id)).toEqual([
      "native-clerk/delete-user",
      "native-webflow/create-site",
    ]);
  });

  it("infers representative native-node capability metadata", () => {
    expect(
      inferCandidateCapability(
        candidate(
          "native-webflow/publish-site",
          "Publish Site",
          "Publish Webflow site"
        )
      )
    ).toMatchObject({
      kind: "site_management",
      operation: "publish",
      provider: "webflow",
      resource: "site",
    });
    expect(
      inferCandidateCapability(
        candidate("native-webhook/send-webhook", "Send Webhook")
      )
    ).toMatchObject({
      contentKind: "http_request",
      kind: "http_request",
      provider: "webhook",
    });
    expect(
      inferCandidateCapability(
        candidate(
          "native-uniswap/quote-exact-input",
          "Uniswap V3: Quote Exact Input",
          "Get the expected output amount for a single-hop exact-input swap"
        )
      )
    ).toMatchObject({
      kind: "wallet_read",
      operation: "get",
      provider: "uniswap",
    });
    expect(
      inferCandidateCapability(
        candidate(
          "native-uniswap/swap-exact-input",
          "Uniswap V3: Swap Exact Input",
          "Swap an exact amount of input tokens"
        )
      )
    ).toMatchObject({
      kind: "wallet_write",
      operation: "swap",
      provider: "uniswap",
    });
  });
});
