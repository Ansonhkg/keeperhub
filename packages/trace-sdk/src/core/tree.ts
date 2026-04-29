import type { DiagnosticSpan } from "../types";

export type TraceTreeNode = DiagnosticSpan & {
  children: TraceTreeNode[];
};

function timestampMs(value: string | null | undefined) {
  if (!value) {
    return 0;
  }

  const timestamp = new Date(value).getTime();
  return Number.isNaN(timestamp) ? 0 : timestamp;
}

export function buildTraceTree(spans: DiagnosticSpan[]): TraceTreeNode[] {
  const nodes = new Map<string, TraceTreeNode>();
  const roots: TraceTreeNode[] = [];

  for (const span of spans) {
    nodes.set(span.id, { ...span, children: [] });
  }

  const sortedNodes = [...nodes.values()].sort((left, right) => {
    const startedDiff =
      timestampMs(left.startedAt) - timestampMs(right.startedAt);
    return startedDiff === 0
      ? left.label.localeCompare(right.label)
      : startedDiff;
  });

  for (const node of sortedNodes) {
    const parent = node.parentSpanId ? nodes.get(node.parentSpanId) : null;
    if (parent) {
      parent.children.push(node);
    } else {
      roots.push(node);
    }
  }

  return roots;
}
