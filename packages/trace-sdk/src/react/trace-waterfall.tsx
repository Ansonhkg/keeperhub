import { buildTraceWaterfall, formatTraceDuration } from "../core";
import type { DiagnosticRun } from "../types";
import { cx } from "./adapters";

type TraceWaterfallProps = {
  run: DiagnosticRun;
  selectedSpanId?: string | null;
  onSelectSpan?: (spanId: string) => void;
};

function rowTone(status: string) {
  switch (status) {
    case "success":
      return "bg-emerald-500";
    case "error":
      return "bg-rose-500";
    case "running":
      return "bg-amber-500";
    default:
      return "bg-muted-foreground";
  }
}

export function TraceWaterfall({
  onSelectSpan,
  run,
  selectedSpanId,
}: TraceWaterfallProps) {
  const waterfall = buildTraceWaterfall(run.spans);
  if (!waterfall.rows.length) {
    return (
      <div className="rounded-lg border border-dashed p-6 text-muted-foreground text-sm">
        No waterfall spans yet.
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {waterfall.rows.map((row) => {
        const width = Math.max(
          2,
          (row.durationMsClamped / waterfall.totalDurationMs) * 100
        );
        const offset = (row.offsetMs / waterfall.totalDurationMs) * 100;
        return (
          <button
            className={cx(
              "grid w-full grid-cols-[180px_1fr_72px] items-center gap-3 rounded-lg border px-3 py-2 text-left text-sm transition",
              selectedSpanId === row.id
                ? "border-primary bg-primary/5"
                : "bg-card hover:bg-accent/40"
            )}
            key={row.id}
            onClick={() => onSelectSpan?.(row.id)}
            type="button"
          >
            <div className="min-w-0">
              <div className="truncate font-medium">{row.label}</div>
              <div className="truncate text-muted-foreground text-xs">
                {row.parentLabel || row.step}
              </div>
            </div>
            <div className="relative h-3 rounded-full bg-muted">
              <div
                className={cx(
                  "absolute top-0 h-3 rounded-full",
                  rowTone(row.status)
                )}
                style={{ left: `${offset}%`, width: `${width}%` }}
              />
            </div>
            <div className="text-right text-muted-foreground text-xs">
              {formatTraceDuration(row.durationMs)}
            </div>
          </button>
        );
      })}
    </div>
  );
}
