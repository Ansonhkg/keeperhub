import type { DiagnosticSpan } from "../types";
import { buildTraceTree, type TraceTreeNode } from "./tree";

export type TraceWaterfallRow = Omit<DiagnosticSpan, "durationMs"> & {
  depth: number;
  durationMs: number;
  durationMsClamped: number;
  endOffsetMs: number;
  offsetMs: number;
  parentLabel: string;
};

export type TraceWaterfallData = {
  rows: TraceWaterfallRow[];
  tickMs: number;
  tickValues: number[];
  totalDurationMs: number;
};

function timestampMs(value: string | null | undefined) {
  if (!value) {
    return null;
  }

  const timestamp = new Date(value).getTime();
  return Number.isNaN(timestamp) ? null : timestamp;
}

function getTickMs(totalDurationMs: number) {
  if (totalDurationMs <= 120) {
    return 20;
  }
  if (totalDurationMs <= 240) {
    return 40;
  }
  if (totalDurationMs <= 400) {
    return 50;
  }
  if (totalDurationMs <= 800) {
    return 100;
  }
  if (totalDurationMs <= 1600) {
    return 200;
  }
  if (totalDurationMs <= 3200) {
    return 400;
  }
  if (totalDurationMs <= 6400) {
    return 800;
  }
  return 1000;
}

function effectiveDurationMs(span: DiagnosticSpan, startTime: number) {
  if (span.durationMs != null && span.durationMs >= 0) {
    return span.durationMs;
  }

  const endTime = timestampMs(span.endedAt);
  return endTime == null ? 1 : Math.max(1, endTime - startTime);
}

export function buildTraceWaterfall(
  spans: DiagnosticSpan[],
  runStartedAt?: string | null
): TraceWaterfallData {
  const roots = buildTraceTree(spans);
  if (!roots.length) {
    return {
      rows: [],
      tickMs: 100,
      tickValues: [0, 100],
      totalDurationMs: 1,
    };
  }

  const spanMap = new Map(spans.map((span) => [span.id, span]));
  const startTimes = spans
    .map((span) => timestampMs(span.startedAt))
    .filter((value): value is number => value != null);
  const runStartTime = timestampMs(runStartedAt);
  const baseTime = Math.min(
    ...(runStartTime == null ? startTimes : [runStartTime, ...startTimes])
  );
  const rows: TraceWaterfallRow[] = [];
  let latestTime = baseTime;

  function visit(node: TraceTreeNode, depth: number) {
    const startTime = timestampMs(node.startedAt) ?? baseTime;
    const durationMs = effectiveDurationMs(node, startTime);
    const offsetMs = Math.max(0, startTime - baseTime);
    latestTime = Math.max(latestTime, startTime + durationMs);

    rows.push({
      ...node,
      depth,
      durationMs,
      durationMsClamped: Math.max(6, durationMs),
      endOffsetMs: offsetMs + durationMs,
      offsetMs,
      parentLabel: node.parentSpanId
        ? (spanMap.get(node.parentSpanId)?.label ?? "")
        : "",
    });

    for (const child of node.children) {
      visit(child, depth + 1);
    }
  }

  for (const root of roots) {
    visit(root, 0);
  }

  const totalDurationMs = Math.max(1, latestTime - baseTime);
  const tickMs = getTickMs(totalDurationMs);
  const tickValues: number[] = [];
  for (
    let current = tickMs;
    current < totalDurationMs + tickMs;
    current += tickMs
  ) {
    tickValues.push(current);
  }

  return {
    rows,
    tickMs,
    tickValues,
    totalDurationMs,
  };
}
