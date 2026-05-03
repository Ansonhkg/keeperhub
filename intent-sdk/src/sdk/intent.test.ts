import { describe, expect, test } from "vitest";

import {
  domain,
  type IntentContract,
  primitive,
  resolveIntent,
} from "./intent.js";

describe("resolveIntent questions", () => {
  test("keeps LLM question wording while applying product constraints", async () => {
    const workflowDomain = domain({
      id: "workflow",
      intent: {
        questionConstraintsForRequirement({ requirement }) {
          if (requirement.id !== "destination") {
            return undefined;
          }
          return {
            id: requirement.id,
            requirementId: requirement.id,
            options: [
              { label: "Primary", value: "primary" },
              { label: "Secondary", value: "secondary" },
            ],
            title: "Destination",
            type: "choice",
          };
        },
      },
      primitives: [
        primitive({ id: "deliver", description: "Delivers a result." }),
      ],
    });
    const contract: IntentContract = {
      kind: "intent_contract",
      requirements: [
        {
          id: "destination",
          label: "Destination",
          question: {
            id: "destination",
            options: [
              { label: "Primary from LLM", value: "primary" },
              { label: "Unsupported option", value: "unsupported" },
            ],
            prompt: "Where should I send the result?",
            requirementId: "destination",
            title: "LLM title",
            type: "text",
          },
          required: true,
          status: "missing",
          type: "string",
          value: null,
        },
      ],
      steps: [
        {
          id: "step_deliver",
          label: "Deliver",
          primitive: "deliver",
          requirementIds: ["destination"],
        },
      ],
    };

    const session = await resolveIntent({
      domain: workflowDomain,
      prompt: "Process this and deliver the result.",
      resolver: () => contract,
    });

    expect(session.questions).toEqual([
      {
        id: "destination",
        options: [{ label: "Primary from LLM", value: "primary" }],
        prompt: "Where should I send the result?",
        requirementId: "destination",
        title: "LLM title",
        type: "choice",
      },
    ]);
  });

  test("uses product fallback only when the LLM omitted question wording", async () => {
    const workflowDomain = domain({
      id: "workflow",
      intent: {
        questionConstraintsForRequirement({ requirement }) {
          return {
            fallbackPrompt: `What should ${requirement.label} be?`,
            id: requirement.id,
            requirementId: requirement.id,
            title: requirement.label,
            type: "text",
          };
        },
      },
      primitives: [primitive({ id: "read", description: "Reads data." })],
    });

    const session = await resolveIntent({
      domain: workflowDomain,
      prompt: "Read a value.",
      resolver: () => ({
        kind: "intent_contract",
        requirements: [
          {
            id: "target",
            label: "Read target",
            required: true,
            status: "missing",
            type: "string",
            value: null,
          },
        ],
        steps: [
          {
            id: "step_read",
            label: "Read",
            primitive: "read",
            requirementIds: ["target"],
          },
        ],
      }),
    });

    expect(session.questions[0]?.prompt).toBe("What should Read target be?");
  });
});
