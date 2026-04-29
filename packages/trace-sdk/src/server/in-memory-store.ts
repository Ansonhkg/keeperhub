import { reduceTraceLifecycle } from "../core/lifecycle";
import type { DiagnosticRun, DiagnosticRunSummary } from "../types";
import type {
  TraceCleanupOptions,
  TraceCleanupResult,
  TraceDiagnosticsSummary,
  TraceRecordEvent,
  TraceRunListOptions,
  TraceRunListResult,
  TraceStore,
} from "./contracts";

function toTimestamp(value: Date | string | number | null | undefined) {
  if (value == null) {
    return null;
  }

  const timestamp =
    value instanceof Date ? value.getTime() : new Date(value).getTime();
  return Number.isNaN(timestamp) ? null : timestamp;
}

function readPage(value: number | undefined) {
  return Math.max(0, Math.floor(Number(value ?? 0)) || 0);
}

function readPageSize(value: number | undefined) {
  return Math.max(1, Math.min(200, Math.floor(Number(value ?? 20)) || 20));
}

function readCapability(run: DiagnosticRun) {
  return run.capability;
}

function matchesSearch(run: DiagnosticRun, search: string) {
  if (!search) {
    return true;
  }

  const haystack = [
    run.runId,
    run.traceId,
    run.status,
    run.lastEventType,
    readCapability(run),
    run.error?.message ?? "",
  ]
    .join("\n")
    .toLowerCase();
  return haystack.includes(search.toLowerCase());
}

function summarizeRun(run: DiagnosticRun): DiagnosticRunSummary {
  return {
    actor: run.actor,
    attributes: run.attributes,
    capability: run.capability,
    createdAt: run.createdAt,
    durationMs: run.durationMs,
    endedAt: run.endedAt,
    error: run.error,
    eventCount: run.events.length,
    lastEventType: run.lastEventType,
    mode: run.mode,
    origin: run.origin,
    platform: run.platform,
    provider: run.provider,
    runId: run.runId,
    spanCount: run.spans.length,
    startedAt: run.startedAt,
    status: run.status,
    traceId: run.traceId,
    trigger: run.trigger,
    updatedAt: run.updatedAt,
  };
}

function cloneRun(run: DiagnosticRun): DiagnosticRun {
  return JSON.parse(JSON.stringify(run)) as DiagnosticRun;
}

function sortRuns(left: DiagnosticRun, right: DiagnosticRun) {
  return (
    (toTimestamp(right.updatedAt) ?? 0) - (toTimestamp(left.updatedAt) ?? 0)
  );
}

function getRunId(event: TraceRecordEvent) {
  return event.runId;
}

function getRunReferenceTimestamp(run: DiagnosticRun) {
  return (
    toTimestamp(run.endedAt) ??
    toTimestamp(run.startedAt) ??
    toTimestamp(run.createdAt) ??
    toTimestamp(run.updatedAt)
  );
}

function getStatusCounts(runs: DiagnosticRun[]) {
  return runs.reduce<Record<string, number>>((counts, run) => {
    counts[run.status] = (counts[run.status] ?? 0) + 1;
    return counts;
  }, {});
}

function getCapabilities(runs: DiagnosticRun[]) {
  return [...new Set(runs.map(readCapability).filter(Boolean))].sort(
    (left, right) => left.localeCompare(right)
  );
}

function isTraceLifecycleEvent(
  event: TraceRecordEvent
): event is TraceRecordEvent {
  return Boolean(event.type && event.at);
}

export function createInMemoryTraceStore(): TraceStore {
  const runs = new Map<string, DiagnosticRun>();

  function recordEvent(event: TraceRecordEvent) {
    if (!isTraceLifecycleEvent(event)) {
      return Promise.resolve(null);
    }

    const runId = getRunId(event);
    if (!runId) {
      return Promise.resolve(null);
    }

    const current = runs.get(runId) ?? null;
    if (!current && event.type !== "run:start") {
      return Promise.resolve(null);
    }

    const next = reduceTraceLifecycle(current, event);
    runs.set(runId, next);
    return Promise.resolve(cloneRun(next));
  }

  return {
    cleanupRuns(options: TraceCleanupOptions): Promise<TraceCleanupResult> {
      const retentionDays = Math.max(
        1,
        Number(options.retentionDays || 0) || 0
      );
      const now = toTimestamp(options.now ?? new Date()) ?? Date.now();
      const cutoff = now - retentionDays * 24 * 60 * 60 * 1000;
      let removed = 0;

      for (const [runId, run] of runs) {
        const timestamp = getRunReferenceTimestamp(run);
        if (timestamp != null && timestamp < cutoff) {
          runs.delete(runId);
          removed += 1;
        }
      }

      return Promise.resolve({ kept: runs.size, removed });
    },

    getRun(runId: string) {
      const run = runs.get(runId) ?? null;
      return Promise.resolve(run ? cloneRun(run) : null);
    },

    getSummary(): Promise<TraceDiagnosticsSummary> {
      const allRuns = [...runs.values()];
      return Promise.resolve({
        approximateFootprintBytes: JSON.stringify(allRuns).length,
        capabilities: getCapabilities(allRuns),
        statuses: getStatusCounts(allRuns),
        totalEvents: allRuns.reduce((sum, run) => sum + run.events.length, 0),
        totalRuns: allRuns.length,
        totalSpans: allRuns.reduce((sum, run) => sum + run.spans.length, 0),
      });
    },

    listRuns(options: TraceRunListOptions = {}): Promise<TraceRunListResult> {
      const page = readPage(options.page);
      const pageSize = readPageSize(options.pageSize);
      const status = String(options.status ?? "").toLowerCase();
      const capability = String(options.capability ?? "");
      const filteredRuns = [...runs.values()].sort(sortRuns).filter((run) => {
        if (status && status !== "all" && run.status !== status) {
          return false;
        }
        if (
          capability &&
          capability !== "all" &&
          readCapability(run) !== capability
        ) {
          return false;
        }
        return matchesSearch(run, String(options.search ?? ""));
      });
      const offset = page * pageSize;

      return Promise.resolve({
        capabilities: getCapabilities([...runs.values()]),
        page,
        pageSize,
        runs: filteredRuns.slice(offset, offset + pageSize).map(summarizeRun),
        total: filteredRuns.length,
      });
    },

    recordEvent,

    async recordEvents(events: readonly TraceRecordEvent[]) {
      const results: Array<DiagnosticRun | null> = [];
      for (const event of events) {
        results.push(await recordEvent(event));
      }
      return results;
    },
  };
}
