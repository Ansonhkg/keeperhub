import type { DiagnosticRun } from "../types";
import { DiagnosticsRunInspector } from "./diagnostics-run-inspector";
import { useDiagnosticRunStream } from "./use-diagnostic-run-stream";

type LiveTraceInspectorProps = {
  run: DiagnosticRun | null;
  runId?: string | null;
  streamUrl?: string | null;
  selectedSpanId?: string | null;
  onSelectedSpanChange?: (spanId: string | null) => void;
};

const STATUS_LABELS = {
  closed: "Closed",
  error: "Closed",
  idle: "Closed",
  live: "Live",
  reconnecting: "Reconnecting",
  stale: "Stale",
};

export function LiveTraceInspector({
  onSelectedSpanChange,
  run,
  selectedSpanId,
  streamUrl,
}: LiveTraceInspectorProps) {
  const stream = useDiagnosticRunStream({
    enabled: Boolean(streamUrl),
    initialRun: run,
    streamUrl,
  });
  const currentRun = stream.run ?? run;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3 rounded-xl border bg-card px-4 py-3 text-card-foreground shadow-xs">
        <div>
          <div className="text-sm font-medium">Live trace</div>
          <div className="text-muted-foreground text-xs">
            {stream.lastEventAt
              ? `Last event ${stream.lastEventAt}`
              : "Waiting for trace events"}
          </div>
        </div>
        <span className="rounded-full border bg-muted px-3 py-1 font-medium text-muted-foreground text-xs">
          {STATUS_LABELS[stream.status]}
        </span>
      </div>
      <DiagnosticsRunInspector
        error={stream.error}
        onSelectedSpanChange={onSelectedSpanChange}
        run={currentRun}
        selectedSpanId={selectedSpanId}
      />
    </div>
  );
}
