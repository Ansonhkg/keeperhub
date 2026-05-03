import { JsonContracts } from "./json-contracts.ts";
import { defineSchemaManifest } from "./schema.ts";

export const schemaManifests = [
  defineSchemaManifest(JsonContracts.prepareRequest),
  defineSchemaManifest(JsonContracts.prepareResponse),
  defineSchemaManifest(JsonContracts.runRequestDraft),
  defineSchemaManifest(JsonContracts.runRequest),
  defineSchemaManifest(JsonContracts.runResponse),
  defineSchemaManifest(JsonContracts.attempt),
  defineSchemaManifest(JsonContracts.evaluation),
  defineSchemaManifest(JsonContracts.fixerOutput),
  defineSchemaManifest({
    id: "schema.eval-exec-v3.operation-step",
    kind: "object",
  }),
  defineSchemaManifest({
    id: "schema.eval-exec-v3.operation.continue-step.input",
    kind: "object",
  }),
];

export default schemaManifests;
