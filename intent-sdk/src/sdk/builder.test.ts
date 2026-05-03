import { describe, expect, test } from "vitest";

import { capabilities, capability } from "./builder.js";
import type { IntentContract } from "./intent.js";

describe("capabilities", () => {
  test("reports unsupported intent steps instead of silently dropping them", async () => {
    const catalog = capabilities({
      items: [
        capability({
          id: "source.read",
          primitive: "read",
          title: "Read source",
        }),
      ],
    });

    const intent: IntentContract = {
      kind: "intent_contract",
      requirements: [
        {
          id: "source_id",
          label: "Source",
          required: true,
          status: "satisfied",
          type: "string",
          value: "source-1",
        },
        {
          id: "target_id",
          label: "Target",
          required: true,
          status: "satisfied",
          type: "string",
          value: "target-1",
        },
      ],
      steps: [
        {
          id: "step_read",
          label: "Read source",
          primitive: "read",
          requirementIds: ["source_id"],
        },
        {
          id: "step_write",
          label: "Write target",
          primitive: "write",
          requirementIds: ["target_id"],
        },
      ],
    };

    const match = await catalog.match(intent);

    expect(match.plan.items.map((item) => item.primitive)).toEqual(["read"]);
    expect(match.missingCapabilities).toEqual([
      {
        label: "Write target",
        primitive: "write",
        stepId: "step_write",
      },
    ]);
  });

  test("uses product-provided mappers for capability input", async () => {
    const catalog = capabilities({
      items: [
        capability({
          id: "source.read",
          mapInput: ({ requirementValue }) => ({
            source: requirementValue(["source_id", "source"]),
            mode: requirementValue("read_mode", "snapshot"),
          }),
          primitive: "read",
          title: "Read source",
        }),
      ],
    });

    const intent: IntentContract = {
      kind: "intent_contract",
      requirements: [
        {
          id: "source_id",
          label: "Source",
          required: true,
          status: "satisfied",
          type: "string",
          value: "source-1",
        },
      ],
      steps: [
        {
          id: "step_read",
          label: "Read source",
          primitive: "read",
          requirementIds: ["source_id"],
        },
      ],
    };

    const match = await catalog.match(intent);

    expect(match.plan.items[0]?.input).toEqual({
      mode: "snapshot",
      source: "source-1",
    });
    expect(match.missingCapabilities).toEqual([]);
  });

  test("does not invent primitive-specific input when a capability has no mapper", async () => {
    const catalog = capabilities({
      items: [
        capability({
          id: "source.read",
          primitive: "read",
          title: "Read source",
        }),
      ],
    });

    const intent: IntentContract = {
      kind: "intent_contract",
      requirements: [
        {
          id: "source_id",
          label: "Source",
          required: true,
          status: "satisfied",
          type: "string",
          value: "source-1",
        },
      ],
      steps: [
        {
          id: "step_read",
          label: "Read source",
          primitive: "read",
          requirementIds: ["source_id"],
        },
      ],
    };

    const match = await catalog.match(intent);

    expect(match.plan.items[0]?.input).toEqual({});
  });
});
