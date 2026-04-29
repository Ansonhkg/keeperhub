import { useEffect } from "react";
import type { DiagnosticRun } from "../types";
import { useTraceReactAdapter } from "./adapters";
import { TraceDetailsPanel } from "./trace-details-panel";

export type DiagnosticsRunInspectorProps = {
  run: DiagnosticRun | null;
  loading?: boolean;
  error?: string | null;
  selectedSpanId?: string | null;
  onSelectedSpanChange?: (spanId: string | null) => void;
};

export function DiagnosticsRunInspector({
  error,
  loading = false,
  onSelectedSpanChange,
  run,
  selectedSpanId,
}: DiagnosticsRunInspectorProps) {
  const adapter = useTraceReactAdapter();

  useEffect(() => {
    if (!(run && onSelectedSpanChange)) {
      return;
    }
    if (
      selectedSpanId &&
      run.spans.some((span) => span.id === selectedSpanId)
    ) {
      return;
    }
    onSelectedSpanChange(run.spans[0]?.id ?? null);
  }, [onSelectedSpanChange, run, selectedSpanId]);

  const copy = (label: string, value: string) => {
    navigator.clipboard?.writeText(value).then(
      () => adapter.toast?.success?.(`${label} copied`),
      () => adapter.toast?.error?.(`Could not copy ${label.toLowerCase()}`)
    );
  };

  if (loading) {
    return (
      <div className="rounded-xl border p-6 text-muted-foreground text-sm">
        Loading diagnostic run.
      </div>
    );
  }
  if (error) {
    return (
      <div className="rounded-xl border border-destructive/30 bg-destructive/10 p-6 text-destructive text-sm">
        {error}
      </div>
    );
  }
  if (!run) {
    return (
      <div className="rounded-xl border border-dashed p-8 text-muted-foreground text-sm">
        Select a run to inspect its trace.
      </div>
    );
  }

  return (
    <TraceDetailsPanel
      actions={[
        {
          label: "Copy run ID",
          onClick: () => copy("Run ID", run.runId),
        },
        {
          label: "Copy trace ID",
          onClick: () => copy("Trace ID", run.traceId),
        },
      ]}
      breadcrumbs={["Diagnostics", "Trace Details"]}
      onSelectedSpanChange={onSelectedSpanChange}
      run={run}
      selectedSpanId={selectedSpanId}
    />
  );
}
