import {
  reduceTraceLifecycle,
  type DiagnosticRun as SdkDiagnosticRun,
  type DiagnosticSpan as SdkDiagnosticSpan,
  type TraceJsonObject,
  type TraceJsonValue,
} from "@keeperhub/trace-sdk/core";
import type {
  TraceCleanupOptions,
  TraceCleanupResult,
  TraceDiagnosticsSummary,
  TraceRecordEvent,
  TraceRunListOptions,
  TraceRunListResult,
  TraceStore,
} from "@keeperhub/trace-sdk/server";
import { count, eq, inArray } from "drizzle-orm";
import { db as defaultDb } from "@/lib/db";
import {
  diagnosticEvents,
  diagnosticRuns,
  diagnosticSpanLinks,
  diagnosticSpans,
} from "@/lib/db/schema";

type KeeperDb = typeof defaultDb;

function toDate(value: string | null | undefined) {
  if (!value) {
    return null;
  }

  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function toRequiredDate(value: string) {
  return toDate(value) ?? new Date();
}

function toIso(value: Date | null) {
  return value ? value.toISOString() : null;
}

function toRequiredIso(value: Date) {
  return value.toISOString();
}

function readMetadata(run: SdkDiagnosticRun, key: string) {
  const value = run.attributes?.[key];
  return typeof value === "string" ? value : "";
}

function readOptionalMetadata(run: SdkDiagnosticRun, key: string) {
  const value = readMetadata(run, key);
  return value || null;
}

function runToDb(run: SdkDiagnosticRun) {
  return {
    actor: run.actor,
    attributes: run.attributes,
    capability: run.capability,
    createdAt: toRequiredDate(run.createdAt),
    durationMs: run.durationMs,
    endedAt: toDate(run.endedAt),
    error: run.error,
    eventCount: run.events.length,
    lastEventType: run.lastEventType,
    mode: run.mode,
    organizationId: readOptionalMetadata(run, "organizationId"),
    origin: run.origin,
    platform: run.platform,
    provider: run.provider,
    runId: run.runId,
    spanCount: run.spans.length,
    startedAt: toRequiredDate(run.startedAt),
    status: run.status,
    traceId: run.traceId,
    trigger: run.trigger,
    updatedAt: toRequiredDate(run.updatedAt),
    userId: readOptionalMetadata(run, "userId"),
    workflowExecutionId: readOptionalMetadata(run, "executionId"),
    workflowId: readOptionalMetadata(run, "workflowId"),
  };
}

function spanToDb(runId: string, span: SdkDiagnosticSpan) {
  return {
    attributes: span.attributes ?? null,
    durationMs: span.durationMs,
    endedAt: toDate(span.endedAt),
    error: span.error ?? null,
    input: span.input ?? null,
    kind: span.kind,
    label: span.label,
    output: span.output ?? null,
    parentSpanId: span.parentSpanId,
    runId,
    spanId: span.id,
    startedAt: toRequiredDate(span.startedAt),
    status: span.status,
    step: span.step,
    traceId: span.traceId,
  };
}

function runRowToSdk(
  row: typeof diagnosticRuns.$inferSelect
): Omit<SdkDiagnosticRun, "events" | "links" | "spans"> {
  return {
    actor: row.actor,
    attributes: row.attributes as TraceJsonObject | null,
    capability: row.capability,
    createdAt: toRequiredIso(row.createdAt),
    durationMs: row.durationMs,
    endedAt: toIso(row.endedAt),
    error: row.error as SdkDiagnosticRun["error"],
    eventCount: row.eventCount,
    lastEventType: row.lastEventType,
    mode: row.mode,
    origin: row.origin,
    platform: row.platform,
    provider: row.provider,
    runId: row.runId,
    spanCount: row.spanCount,
    startedAt: toRequiredIso(row.startedAt),
    status: row.status,
    traceId: row.traceId,
    trigger: row.trigger,
    updatedAt: toRequiredIso(row.updatedAt),
  };
}

function spanRowToSdk(
  row: typeof diagnosticSpans.$inferSelect
): SdkDiagnosticSpan {
  return {
    attributes: row.attributes as TraceJsonObject | null,
    durationMs: row.durationMs,
    endedAt: toIso(row.endedAt),
    error: row.error as SdkDiagnosticSpan["error"],
    id: row.spanId,
    input: row.input as TraceJsonValue | null,
    kind: row.kind,
    label: row.label,
    output: row.output as TraceJsonValue | null,
    parentSpanId: row.parentSpanId,
    runId: row.runId,
    startedAt: toRequiredIso(row.startedAt),
    status: row.status,
    step: row.step,
    traceId: row.traceId,
  };
}

function eventRowToSdk(
  row: typeof diagnosticEvents.$inferSelect
): SdkDiagnosticRun["events"][number] {
  return {
    at: toRequiredIso(row.at),
    attributes: row.attributes as TraceJsonObject | null,
    durationMs: row.durationMs,
    error: row.error as SdkDiagnosticRun["events"][number]["error"],
    id: row.id,
    parentSpanId: row.parentSpanId,
    payload: row.payload as TraceJsonValue | null,
    runId: row.runId,
    spanId: row.spanId,
    traceId: row.traceId,
    type: row.type,
  };
}

function linkRowToSdk(
  row: typeof diagnosticSpanLinks.$inferSelect
): SdkDiagnosticRun["links"][number] {
  return {
    attributes: row.attributes as TraceJsonObject | null,
    id: row.id,
    linkedSpanId: row.linkedSpanId,
    runId: row.runId,
    spanId: row.spanId,
    traceId: row.traceId,
    type: row.type,
  };
}

function runMatchesOptions(
  run: typeof diagnosticRuns.$inferSelect,
  options: TraceRunListOptions
) {
  if (
    options.status &&
    options.status !== "all" &&
    run.status !== options.status
  ) {
    return false;
  }
  if (
    options.capability &&
    options.capability !== "all" &&
    run.capability !== options.capability
  ) {
    return false;
  }
  if (!options.search) {
    return true;
  }

  const search = options.search.toLowerCase();
  return [run.runId, run.traceId, run.capability, run.lastEventType, run.status]
    .join("\n")
    .toLowerCase()
    .includes(search);
}

export class DrizzleTraceStore implements TraceStore {
  private readonly database: KeeperDb;

  constructor(database: KeeperDb = defaultDb) {
    this.database = database;
  }

  async recordEvent(event: TraceRecordEvent) {
    if (!event.runId) {
      return null;
    }

    const current = await this.getRun(event.runId);
    if (!current && event.type !== "run:start") {
      return null;
    }

    const next = reduceTraceLifecycle(current, event);
    const eventRecord = next.events.at(-1);
    if (!eventRecord) {
      return next;
    }

    await this.database.transaction(async (tx) => {
      const runValues = runToDb(next);
      await tx
        .insert(diagnosticRuns)
        .values(runValues)
        .onConflictDoUpdate({
          target: diagnosticRuns.runId,
          set: runValues,
        })
        .execute();

      for (const span of next.spans) {
        const spanValues = spanToDb(next.runId, span);
        await tx
          .insert(diagnosticSpans)
          .values(spanValues)
          .onConflictDoUpdate({
            target: [diagnosticSpans.runId, diagnosticSpans.spanId],
            set: spanValues,
          })
          .execute();
      }

      for (const link of next.links) {
        await tx
          .insert(diagnosticSpanLinks)
          .values({
            attributes: link.attributes,
            id: link.id,
            linkedSpanId: link.linkedSpanId,
            runId: link.runId,
            spanId: link.spanId,
            traceId: link.traceId,
            type: link.type,
          })
          .onConflictDoNothing()
          .execute();
      }

      await tx
        .insert(diagnosticEvents)
        .values({
          at: toRequiredDate(eventRecord.at),
          attributes: eventRecord.attributes,
          durationMs: eventRecord.durationMs,
          error: eventRecord.error,
          id: eventRecord.id,
          parentSpanId: eventRecord.parentSpanId,
          payload: eventRecord.payload,
          runId: eventRecord.runId,
          spanId: eventRecord.spanId,
          traceId: eventRecord.traceId,
          type: eventRecord.type,
        })
        .onConflictDoNothing()
        .execute();
    });

    return next;
  }

  async recordEvents(events: readonly TraceRecordEvent[]) {
    const results: Array<SdkDiagnosticRun | null> = [];
    for (const event of events) {
      results.push(await this.recordEvent(event));
    }
    return results;
  }

  async listRuns(
    options: TraceRunListOptions = {}
  ): Promise<TraceRunListResult> {
    const page = Math.max(0, Math.floor(Number(options.page ?? 0)) || 0);
    const pageSize = Math.max(
      1,
      Math.min(200, Math.floor(Number(options.pageSize ?? 20)) || 20)
    );
    const allRows = await this.database.select().from(diagnosticRuns).execute();
    const filteredRows = allRows
      .filter((run) => runMatchesOptions(run, options))
      .sort(
        (left, right) => right.updatedAt.getTime() - left.updatedAt.getTime()
      );
    const offset = page * pageSize;

    return {
      capabilities: [
        ...new Set(allRows.map((row) => row.capability).filter(Boolean)),
      ].sort((left, right) => left.localeCompare(right)),
      page,
      pageSize,
      runs: filteredRows.slice(offset, offset + pageSize).map(runRowToSdk),
      total: filteredRows.length,
    };
  }

  async getRun(runId: string) {
    const [run] = await this.database
      .select()
      .from(diagnosticRuns)
      .where(eq(diagnosticRuns.runId, runId))
      .execute();
    if (!run) {
      return null;
    }

    const [spans, events, links] = await Promise.all([
      this.database
        .select()
        .from(diagnosticSpans)
        .where(eq(diagnosticSpans.runId, runId))
        .execute(),
      this.database
        .select()
        .from(diagnosticEvents)
        .where(eq(diagnosticEvents.runId, runId))
        .execute(),
      this.database
        .select()
        .from(diagnosticSpanLinks)
        .where(eq(diagnosticSpanLinks.runId, runId))
        .execute(),
    ]);

    return {
      ...runRowToSdk(run),
      events: events
        .sort(
          (left, right) =>
            left.at.getTime() - right.at.getTime() ||
            left.id.localeCompare(right.id)
        )
        .map(eventRowToSdk),
      links: links
        .sort((left, right) => left.id.localeCompare(right.id))
        .map(linkRowToSdk),
      spans: spans
        .sort(
          (left, right) =>
            left.startedAt.getTime() - right.startedAt.getTime() ||
            left.label.localeCompare(right.label)
        )
        .map(spanRowToSdk),
    };
  }

  async getSummary(): Promise<TraceDiagnosticsSummary> {
    const [totalRows, allRuns] = await Promise.all([
      this.database.select({ count: count() }).from(diagnosticRuns).execute(),
      this.database.select().from(diagnosticRuns).execute(),
    ]);
    const statuses = allRuns.reduce<Record<string, number>>((result, run) => {
      result[run.status] = (result[run.status] ?? 0) + 1;
      return result;
    }, {});

    return {
      approximateFootprintBytes: JSON.stringify(allRuns).length,
      capabilities: [
        ...new Set(allRuns.map((run) => run.capability).filter(Boolean)),
      ].sort((left, right) => left.localeCompare(right)),
      statuses,
      totalEvents: allRuns.reduce((sum, run) => sum + run.eventCount, 0),
      totalRuns: Number(totalRows[0]?.count ?? 0),
      totalSpans: allRuns.reduce((sum, run) => sum + run.spanCount, 0),
    };
  }

  async cleanupRuns(options: TraceCleanupOptions): Promise<TraceCleanupResult> {
    const retentionDays = Math.max(1, Number(options.retentionDays || 0) || 0);
    const now = options.now ? new Date(options.now) : new Date();
    const cutoff = new Date(
      now.getTime() - retentionDays * 24 * 60 * 60 * 1000
    );
    const beforeRows = await this.database
      .select({ runId: diagnosticRuns.runId })
      .from(diagnosticRuns)
      .execute();
    const cutoffRows = await this.database
      .select()
      .from(diagnosticRuns)
      .execute();
    const cutoffRunIds = cutoffRows
      .filter((run) => run.startedAt < cutoff)
      .map((run) => run.runId);

    if (cutoffRunIds.length) {
      await this.database
        .delete(diagnosticRuns)
        .where(inArray(diagnosticRuns.runId, cutoffRunIds))
        .execute();
    }

    return {
      kept: beforeRows.length - cutoffRunIds.length,
      removed: cutoffRunIds.length,
    };
  }
}
