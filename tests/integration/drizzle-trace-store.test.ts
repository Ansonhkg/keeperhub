import { inArray } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { diagnosticRuns } from "../../lib/db/schema";
import { DrizzleTraceStore } from "../../lib/trace/drizzle-trace-store";

type Database = typeof import("../../lib/db").db;

const traceId = "1234567890abcdef1234567890abcdef";
const runIds = ["diag-store-run", "diag-store-old", "diag-store-new"];

async function cleanupRuns() {
  const db = await getDb();
  await db
    .delete(diagnosticRuns)
    .where(inArray(diagnosticRuns.runId, runIds))
    .execute();
}

async function getDb(): Promise<Database> {
  const actual =
    await vi.importActual<typeof import("../../lib/db")>("../../lib/db");
  return actual.db;
}

describe("DrizzleTraceStore", () => {
  beforeEach(async () => {
    await cleanupRuns();
  });

  afterEach(async () => {
    await cleanupRuns();
  });

  it("records events and assembles run detail, list, and summary", async () => {
    const db = await getDb();
    const store = new DrizzleTraceStore(db);

    await store.recordEvent({
      at: "2026-01-01T00:00:00.000Z",
      attributes: { capability: "workflow", source: "integration-test" },
      runId: "diag-store-run",
      traceId,
      type: "run:start",
    });
    await store.recordEvent({
      at: "2026-01-01T00:00:00.010Z",
      kind: "step",
      label: "HTTP Request",
      parentSpanId: null,
      runId: "diag-store-run",
      spanId: "1234567890abcdef",
      step: "http.request",
      type: "step:start",
    });
    await store.recordEvent({
      at: "2026-01-01T00:00:00.020Z",
      output: { ok: true },
      runId: "diag-store-run",
      spanId: "1234567890abcdef",
      type: "step:end",
    });
    await store.recordEvent({
      at: "2026-01-01T00:00:00.030Z",
      runId: "diag-store-run",
      type: "run:success",
    });

    const detail = await store.getRun("diag-store-run");
    const list = await store.listRuns({
      capability: "workflow",
      page: 0,
      pageSize: 10,
    });
    const summary = await store.getSummary();

    expect(detail).toMatchObject({
      capability: "workflow",
      durationMs: 30,
      eventCount: 4,
      runId: "diag-store-run",
      spanCount: 1,
      status: "success",
      traceId,
    });
    expect(detail?.events.map((event) => event.type)).toEqual([
      "run:start",
      "step:start",
      "step:end",
      "run:success",
    ]);
    expect(detail?.spans[0]).toMatchObject({
      durationMs: 10,
      output: { ok: true },
      status: "success",
    });
    expect(list.runs.map((run) => run.runId)).toContain("diag-store-run");
    expect(summary.totalRuns).toBeGreaterThanOrEqual(1);
    expect(summary.capabilities).toContain("workflow");
  });

  it("removes runs older than the retention cutoff", async () => {
    const db = await getDb();
    const store = new DrizzleTraceStore(db);

    await store.recordEvent({
      at: "2026-01-01T00:00:00.000Z",
      runId: "diag-store-old",
      traceId,
      type: "run:start",
    });
    await store.recordEvent({
      at: "2026-01-04T00:00:00.000Z",
      runId: "diag-store-new",
      traceId,
      type: "run:start",
    });

    const result = await store.cleanupRuns({
      now: "2026-01-04T12:00:00.000Z",
      retentionDays: 1,
    });
    const list = await store.listRuns({ page: 0, pageSize: 10 });

    expect(result).toEqual({
      kept: expect.any(Number),
      removed: expect.any(Number),
    });
    expect(result.removed).toBeGreaterThanOrEqual(1);
    expect(list.runs.map((run) => run.runId)).not.toContain("diag-store-old");
    expect(list.runs.map((run) => run.runId)).toContain("diag-store-new");
  });
});
