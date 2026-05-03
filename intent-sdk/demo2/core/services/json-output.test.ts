import { describe, expect, test } from "vitest";

import { extractJsonBlock } from "./json-output.js";

describe("extractJsonBlock", () => {
  test("prefers valid JSON fences over earlier non-JSON fences", () => {
    const output = [
      "Notes:",
      "```ts",
      "const complete = true;",
      "```",
      "```json",
      '{"output":"ok","evidence":[],"missingRequirements":[],"complete":true}',
      "```",
    ].join("\n");

    expect(extractJsonBlock(output)).toBe(
      '{"output":"ok","evidence":[],"missingRequirements":[],"complete":true}'
    );
  });

  test("falls back to a valid object embedded in prose", () => {
    expect(extractJsonBlock('done {"complete":true} thanks')).toBe(
      '{"complete":true}'
    );
  });

  test("finds the first valid balanced object when prose contains other braces", () => {
    const output =
      'attempt {not json} then {"output":"ok {still string}","complete":true} trailing {"ignored":true}';

    expect(extractJsonBlock(output)).toBe(
      '{"output":"ok {still string}","complete":true}'
    );
  });

  test("skips invalid json fences before valid output", () => {
    const output = [
      "```json",
      "{not json}",
      "```",
      "final:",
      '{"output":"ok","complete":true}',
    ].join("\n");

    expect(extractJsonBlock(output)).toBe('{"output":"ok","complete":true}');
  });

  test("supports fenced JSON with extra whitespace around the language tag", () => {
    const output = ["``` JSON", '{"complete":true}', "```"].join("\n");

    expect(extractJsonBlock(output)).toBe('{"complete":true}');
  });

  test("extracts top-level JSON arrays", () => {
    expect(extractJsonBlock("status [1, 2, 3] done")).toBe("[1, 2, 3]");
  });

  test("keeps nested arrays and objects balanced", () => {
    const output = 'status [{"items":[{"complete":true}]}] done';

    expect(extractJsonBlock(output)).toBe('[{"items":[{"complete":true}]}]');
  });

  test("skips earlier telemetry JSON when a matcher requires the eval-exec shape", () => {
    const output = [
      '{"type":"step_start","timestamp":1777506897869,"sessionID":"ses_123","part":{"type":"step-start"}}',
      '{"type":"tool_use","part":{"tool":"read"}}',
      '{"output":"created the todo app","evidence":["index.html"],"missingRequirements":[],"complete":true}',
    ].join("\n");

    expect(
      extractJsonBlock(
        output,
        (value) =>
          typeof value === "object" &&
          value !== null &&
          "output" in value &&
          "complete" in value
      )
    ).toBe(
      '{"output":"created the todo app","evidence":["index.html"],"missingRequirements":[],"complete":true}'
    );
  });

  test("reports when no JSON candidate matches the expected schema", () => {
    const output = [
      '{"type":"step_start","timestamp":1777506897869,"sessionID":"ses_123","part":{"type":"step-start"}}',
      '{"type":"tool_use","part":{"tool":"read"}}',
    ].join("\n");

    expect(() =>
      extractJsonBlock(
        output,
        (value) =>
          typeof value === "object" &&
          value !== null &&
          "output" in value &&
          "complete" in value
      )
    ).toThrow("Could not find JSON matching expected schema");
  });
});
