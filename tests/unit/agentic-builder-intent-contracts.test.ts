import { describe, expect, it } from "vitest";

import {
  REQUIREMENT_KINDS,
  REQUIREMENT_STATUSES,
  RESOLVED_REQUIREMENT_STATUS,
  UNRESOLVED_REQUIREMENT_STATUSES,
} from "@/lib/agentic-builder/intent/contracts";
import builderIntentDraftJsonSchema from "@/lib/agentic-builder/intent/generated/builder-intent-draft.schema.json";
import { BuilderIntentDraftSchema } from "@/lib/agentic-builder/intent/schema";
import intentVocabulary from "@/lib/agentic-builder/intent/spec/vocabulary.json";

describe("agentic builder Intent IR contracts", () => {
  it("keeps the checked-in JSON schema vocabulary aligned with the TypeScript contract", () => {
    expect(
      builderIntentDraftJsonSchema.$defs.requirementStatus.enum
    ).toEqual([...REQUIREMENT_STATUSES]);
    expect(builderIntentDraftJsonSchema.$defs.requirementKind.enum).toEqual([
      ...REQUIREMENT_KINDS,
    ]);
  });

  it("validates a draft with satisfied and unresolved requirements", () => {
    const unresolvedStatus = UNRESOLVED_REQUIREMENT_STATUSES[0];
    const draft = BuilderIntentDraftSchema.parse({
      schemaVersion: "agentic-builder.intent.v1",
      prompt: "Slack me when ETH moves",
      clauses: [
        {
          id: "clause_notify",
          sourceText: "Slack me",
          connector: "when",
          requirements: [
            {
              id: "req_slack",
              kind: "notification",
              status: RESOLVED_REQUIREMENT_STATUS,
              summary: "Notify via Slack",
              capabilityIntent: {
                action: "send_message",
                channel: "slack",
              },
            },
            {
              id: "req_threshold",
              kind: "condition",
              status: unresolvedStatus,
              summary: "Define what ETH movement means",
              question: "What ETH price movement should trigger the Slack message?",
              blocksMaterialization: true,
            },
          ],
        },
      ],
      unresolved: [
        {
          requirementId: "req_threshold",
          status: unresolvedStatus,
          question: "What ETH price movement should trigger the Slack message?",
          blocksMaterialization: true,
        },
      ],
      assumptions: [],
    });

    expect(draft.clauses[0]?.requirements).toHaveLength(2);
  });

  it("rejects unresolved requirements that do not point at a requirement", () => {
    const unresolvedStatus = UNRESOLVED_REQUIREMENT_STATUSES[0];
    const result = BuilderIntentDraftSchema.safeParse({
      schemaVersion: "agentic-builder.intent.v1",
      prompt: "Notify me",
      clauses: [
        {
          id: "clause_notify",
          sourceText: "Notify me",
          requirements: [
            {
              id: "req_channel",
              kind: "notification",
              status: unresolvedStatus,
              summary: "Notification channel is missing",
              question: "Where should KeeperHub notify you?",
              blocksMaterialization: true,
            },
          ],
        },
      ],
      unresolved: [
        {
          requirementId: "req_missing",
          status: unresolvedStatus,
          question: "Where should KeeperHub notify you?",
          blocksMaterialization: true,
        },
      ],
      assumptions: [],
    });

    expect(result.success).toBe(false);
  });

  it("rejects blocking unresolved requirements without a question", () => {
    const unresolvedStatus = UNRESOLVED_REQUIREMENT_STATUSES[0];
    const result = BuilderIntentDraftSchema.safeParse({
      schemaVersion: "agentic-builder.intent.v1",
      prompt: "Notify me",
      clauses: [
        {
          id: "clause_notify",
          sourceText: "Notify me",
          requirements: [
            {
              id: "req_channel",
              kind: "notification",
              status: unresolvedStatus,
              summary: "Notification channel is missing",
              blocksMaterialization: true,
            },
          ],
        },
      ],
      unresolved: [],
      assumptions: [],
    });

    expect(result.success).toBe(false);
  });
});
