import { describe, expect, test } from "vitest";

import { JsonContracts, renderJsonContract } from "./json-contracts.js";
import { schemaManifests } from "./schema-manifests.js";

describe("JSON contracts", () => {
  test("render valid prompt schemas from named contracts", () => {
    const draftSchema = JSON.parse(
      renderJsonContract(JsonContracts.runRequestDraft)
    ) as {
      type?: string;
      properties?: Record<string, unknown>;
      additionalProperties?: boolean;
    };

    expect(draftSchema.type).toBe("object");
    expect(draftSchema.additionalProperties).toBe(false);
    expect(draftSchema.properties).toHaveProperty("task");
    expect(draftSchema.properties).toHaveProperty("successCriteria");
  });

  test("expose prompt output contracts through graph schema manifests", () => {
    const manifestIds = schemaManifests.map((manifest) => manifest.id);

    expect(manifestIds).toEqual(
      expect.arrayContaining([
        JsonContracts.runRequestDraft.id,
        JsonContracts.attempt.id,
        JsonContracts.evaluation.id,
        JsonContracts.fixerOutput.id,
      ])
    );
  });
});
