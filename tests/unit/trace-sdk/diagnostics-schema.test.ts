import { getTableConfig } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";
import {
  diagnosticEvents,
  diagnosticRuns,
  diagnosticSpanLinks,
  diagnosticSpans,
} from "../../../lib/db/schema";

describe("diagnostics Drizzle schema", () => {
  it("exports diagnostic run, span, event, and link tables", () => {
    expect(diagnosticRuns).toBeDefined();
    expect(diagnosticSpans).toBeDefined();
    expect(diagnosticEvents).toBeDefined();
    expect(diagnosticSpanLinks).toBeDefined();
  });

  it("diagnostic_runs has ownership, metadata, and lifecycle columns", () => {
    const config = getTableConfig(diagnosticRuns);
    const columns = new Set(config.columns.map((column) => column.name));

    for (const name of [
      "run_id",
      "trace_id",
      "workflow_id",
      "workflow_execution_id",
      "user_id",
      "organization_id",
      "capability",
      "status",
      "created_at",
      "updated_at",
      "started_at",
      "ended_at",
      "duration_ms",
      "event_count",
      "span_count",
      "attributes",
      "error",
    ]) {
      expect(columns.has(name)).toBe(true);
    }
  });

  it("diagnostic_spans is indexed by run and unique by run/span", () => {
    const config = getTableConfig(diagnosticSpans);
    const columns = new Set(config.columns.map((column) => column.name));

    expect(columns.has("run_id")).toBe(true);
    expect(columns.has("span_id")).toBe(true);
    expect(columns.has("parent_span_id")).toBe(true);
    expect(columns.has("input")).toBe(true);
    expect(columns.has("output")).toBe(true);
    expect(columns.has("error")).toBe(true);
    expect(
      config.indexes.some(
        (index) => index.config.name === "uq_diagnostic_spans_run_span"
      )
    ).toBe(true);
  });
});
