import { describe, expect, it } from "vitest";

import type { CapabilityDescriptor } from "@/lib/agentic-builder/evaluation/contracts";
import { evaluateBuilderIntent } from "@/lib/agentic-builder/evaluation/evaluator";
import { evaluationPolicy } from "@/lib/agentic-builder/evaluation/policy";
import {
  REQUIREMENT_KINDS,
  RESOLVED_REQUIREMENT_STATUS,
  UNRESOLVED_REQUIREMENT_STATUSES,
  type BuilderIntentDraft,
} from "@/lib/agentic-builder/intent/contracts";

const taskKind = REQUIREMENT_KINDS[0];

describe("agentic builder capability matcher", () => {
  it("orders matching capabilities by generated source priority", () => {
    const draft = draftWithRequirement({
      id: "req_message",
      capabilityIntent: {
        action: "send_message",
        channel: "slack",
      },
    });

    const result = evaluateBuilderIntent({
      draft,
      capabilities: [
        capability("protocol_slack", "Protocol Slack", "protocol", {
          action: "send_message",
          channel: "slack",
        }),
        capability("native_slack", "Native Slack", "native", {
          action: "send_message",
          channel: "slack",
        }),
      ],
    });

    expect(result.capabilityMatches.map((match) => match.capabilityId)).toEqual([
      "native_slack",
      "protocol_slack",
    ]);
  });

  it("matches message subject prompts to the requested channel, not the subject", () => {
    const draft = draftWithRequirement({
      id: "req_message",
      capabilityIntent: {
        action: "send_message",
        channel: "slack",
      },
      fields: {
        subject: "SendGrid outage",
      },
    });

    const result = evaluateBuilderIntent({
      draft,
      capabilities: [
        capability("native_slack", "Native Slack", "native", {
          action: "send_message",
          channel: "slack",
        }),
        capability("native_sendgrid", "Native SendGrid", "native", {
          action: "send_email",
          provider: "sendgrid",
        }),
      ],
    });

    expect(result.capabilityMatches).toHaveLength(1);
    expect(result.capabilityMatches[0]?.capabilityId).toBe("native_slack");
  });

  it("proposes a custom node when no native capability matches", () => {
    const draft = draftWithRequirement({
      id: "req_site",
      status: UNRESOLVED_REQUIREMENT_STATUSES[0],
      capabilityIntent: {
        action: "create_site",
        provider: "v0",
      },
    });

    const result = evaluateBuilderIntent({ draft, capabilities: [] });

    expect(result.capabilityMatches).toEqual([]);
    expect(result.customNodeProposals).toEqual([
      {
        id: "custom:req_site",
        requirementId: "req_site",
        kind: evaluationPolicy.capabilityPolicy.fallback.missingCapabilityKind,
        title: evaluationPolicy.capabilityPolicy.fallback.missingCapabilityTitle,
        summary: "Required capability",
        requestNativeFeatureAction:
          evaluationPolicy.capabilityPolicy.fallback.requestNativeFeatureAction,
        genericHttpRequiresExplicitSelection:
          evaluationPolicy.capabilityPolicy.fallback.genericHttpRequiresExplicitSelection,
      },
    ]);
  });
});

function draftWithRequirement(input: {
  id: string;
  status?: BuilderIntentDraft["clauses"][number]["requirements"][number]["status"];
  capabilityIntent: NonNullable<
    BuilderIntentDraft["clauses"][number]["requirements"][number]["capabilityIntent"]
  >;
  fields?: Record<string, unknown>;
}): BuilderIntentDraft {
  return {
    schemaVersion: "agentic-builder.intent.v1",
    prompt: "test prompt",
    clauses: [
      {
        id: "clause_1",
        sourceText: "test clause",
        requirements: [
          {
            id: input.id,
            kind: taskKind,
            status: input.status ?? RESOLVED_REQUIREMENT_STATUS,
            summary: "Required capability",
            fields: input.fields,
            capabilityIntent: input.capabilityIntent,
          },
        ],
      },
    ],
    unresolved: [],
    assumptions: [],
  };
}

function capability(
  id: string,
  label: string,
  source: string,
  capabilityIntent: CapabilityDescriptor["capabilityIntent"]
): CapabilityDescriptor {
  return {
    id,
    label,
    source,
    capabilityIntent,
  };
}
