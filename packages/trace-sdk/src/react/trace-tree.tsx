import {
  buildTraceTree,
  formatTraceDuration,
  type TraceTreeNode,
} from "../core";
import type { DiagnosticSpan } from "../types";
import { cx } from "./adapters";

type TraceTreeProps = {
  spans: DiagnosticSpan[];
  selectedSpanId?: string | null;
  onSelectSpan?: (spanId: string) => void;
};

function statusClass(status: string) {
  switch (status) {
    case "success":
      return "text-emerald-700";
    case "error":
      return "text-rose-700";
    case "running":
      return "text-amber-700";
    default:
      return "text-muted-foreground";
  }
}

function TraceTreeBranch({
  depth,
  node,
  onSelectSpan,
  selectedSpanId,
}: {
  depth: number;
  node: TraceTreeNode;
  selectedSpanId?: string | null;
  onSelectSpan?: (spanId: string) => void;
}) {
  return (
    <li className="space-y-2">
      <button
        className={cx(
          "w-full rounded-lg border px-3 py-2 text-left transition",
          selectedSpanId === node.id
            ? "border-primary bg-primary/5"
            : "bg-card hover:bg-accent/40"
        )}
        onClick={() => onSelectSpan?.(node.id)}
        type="button"
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="font-medium">{node.label}</div>
            <div className="mt-1 text-muted-foreground text-xs">
              {node.kind} {node.step ? `· ${node.step}` : ""}{" "}
              {formatTraceDuration(node.durationMs)}
            </div>
          </div>
          <span className={cx("text-xs font-medium", statusClass(node.status))}>
            {node.status}
          </span>
        </div>
      </button>
      {node.children.length ? (
        <ul
          className={cx(
            "space-y-2 border-l pl-3",
            depth === 0 ? "ml-3" : "ml-4"
          )}
        >
          {node.children.map((child) => (
            <TraceTreeBranch
              depth={depth + 1}
              key={child.id}
              node={child}
              onSelectSpan={onSelectSpan}
              selectedSpanId={selectedSpanId}
            />
          ))}
        </ul>
      ) : null}
    </li>
  );
}

export function TraceTree({
  onSelectSpan,
  selectedSpanId,
  spans,
}: TraceTreeProps) {
  const roots = buildTraceTree(spans);
  if (!roots.length) {
    return (
      <div className="rounded-lg border border-dashed p-6 text-muted-foreground text-sm">
        No trace spans yet.
      </div>
    );
  }

  return (
    <ul className="space-y-3">
      {roots.map((node) => (
        <TraceTreeBranch
          depth={0}
          key={node.id}
          node={node}
          onSelectSpan={onSelectSpan}
          selectedSpanId={selectedSpanId}
        />
      ))}
    </ul>
  );
}
