import { describe, expect, it } from "vitest";

import { evaluateBuilderIntent } from "@/lib/agentic-builder/evaluation/evaluator";
import { evaluationPolicy } from "@/lib/agentic-builder/evaluation/policy";
import {
  REQUIREMENT_KINDS,
  RESOLVED_REQUIREMENT_STATUS,
  UNRESOLVED_REQUIREMENT_STATUSES,
  type BuilderIntentDraft,
  type IntentConnector,
} from "@/lib/agentic-builder/intent/contracts";

const taskKind = REQUIREMENT_KINDS[0];
const unresolvedStatus = UNRESOLVED_REQUIREMENT_STATUSES[0];

describe("agentic builder requirement evaluator", () => {
  it("turns alternative connector clauses into option groups", () => {
    const draft = draftWithClause({
      connector: connectorWhere((semantics) => semantics.createsOptionGroup),
      requirements: [
        requirement("req_slack", "Send Slack message", {
          action: "send_message",
          channel: "slack",
        }),
        requirement("req_email", "Send email message", {
          action: "send_message",
          channel: "email",
        }),
      ],
    });

    const result = evaluateBuilderIntent({ draft });

    expect(result.tasks).toHaveLength(2);
    expect(result.optionGroups).toEqual([
      {
        id: "option-group:clause_1",
        clauseId: "clause_1",
        taskIds: ["task:req_slack", "task:req_email"],
      },
    ]);
  });

  it("turns conjunction connector clauses into multiple required tasks", () => {
    const draft = draftWithClause({
      connector: connectorWhere(
        (semantics) => semantics.requiresAllTasks && !semantics.createsOptionGroup
      ),
      requirements: [
        requirement("req_slack", "Send Slack message", {
          action: "send_message",
          channel: "slack",
        }),
        requirement("req_email", "Send email message", {
          action: "send_message",
          channel: "email",
        }),
      ],
    });

    const result = evaluateBuilderIntent({ draft });

    expect(result.tasks).toHaveLength(2);
    expect(result.tasks.every((task) => task.requiresAllTasks)).toBe(true);
    expect(result.optionGroups).toEqual([]);
  });

  it("keeps unresolved requirements as questions that block materialization", () => {
    const draft = draftWithClause({
      requirements: [
        {
          id: "req_threshold",
          kind: taskKind,
          status: unresolvedStatus,
          summary: "Define movement threshold",
          question: "What movement should trigger the workflow?",
          blocksMaterialization: true,
        },
      ],
      unresolved: [
        {
          requirementId: "req_threshold",
          status: unresolvedStatus,
          question: "What movement should trigger the workflow?",
          blocksMaterialization: true,
        },
      ],
    });

    const result = evaluateBuilderIntent({ draft });

    expect(result.tasks).toEqual([]);
    expect(result.unresolved).toEqual([
      {
        requirementId: "req_threshold",
        status: unresolvedStatus,
        question: "What movement should trigger the workflow?",
        blocksMaterialization: true,
      },
    ]);
    expect(result.requirements[0]?.blocksMaterialization).toBe(true);
  });

  it("preserves structured requirement fields for later graph materialization", () => {
    const fields = {
      temporal: {
        interval: "15 minutes",
      },
      condition: {
        comparator: "moves",
        asset: "ETH",
      },
      state: {
        baseline: "previous_check",
      },
      branch: {
        trueBranch: "notify",
      },
    };
    const draft = draftWithClause({
      requirements: [
        {
          ...requirement("req_eth_moves", "Track ETH movement", {
            action: "track_price",
            provider: "chronicle",
          }),
          fields,
        },
      ],
    });

    const result = evaluateBuilderIntent({ draft, capabilities: [] });

    expect(result.requirements[0]).toMatchObject({
      id: "req_eth_moves",
      fields,
      capabilityIntent: {
        action: "track_price",
        provider: "chronicle",
      },
    });
  });
});

function draftWithClause(input: {
  connector?: IntentConnector;
  requirements: BuilderIntentDraft["clauses"][number]["requirements"];
  unresolved?: BuilderIntentDraft["unresolved"];
}): BuilderIntentDraft {
  return {
    schemaVersion: "agentic-builder.intent.v1",
    prompt: "test prompt",
    clauses: [
      {
        id: "clause_1",
        sourceText: "test clause",
        connector: input.connector,
        requirements: input.requirements,
      },
    ],
    unresolved: input.unresolved ?? [],
    assumptions: [],
  };
}

function requirement(
  id: string,
  summary: string,
  capabilityIntent: NonNullable<
    BuilderIntentDraft["clauses"][number]["requirements"][number]["capabilityIntent"]
  >
): BuilderIntentDraft["clauses"][number]["requirements"][number] {
  return {
    id,
    kind: taskKind,
    status: RESOLVED_REQUIREMENT_STATUS,
    summary,
    capabilityIntent,
  };
}

function connectorWhere(
  predicate: (
    semantics: (typeof evaluationPolicy.connectorSemantics)[string]
  ) => boolean
): IntentConnector {
  const match = Object.entries(evaluationPolicy.connectorSemantics).find(
    ([, semantics]) => predicate(semantics)
  );

  if (!match) {
    throw new Error("No connector matched test predicate");
  }

  return match[0] as IntentConnector;
}
