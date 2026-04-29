import { type ReactNode, useState } from "react";
import { buildTraceWaterfall, formatTraceDuration } from "../core";
import type { DiagnosticRun, DiagnosticSpan } from "../types";
import { cx, useTraceButton } from "./adapters";

const TRACE_SCROLLBAR_CLASS =
  "scrollbar-thin scrollbar-track-transparent scrollbar-thumb-slate-600/40 hover:scrollbar-thumb-slate-500/60 [&::-webkit-scrollbar]:h-2 [&::-webkit-scrollbar]:w-2 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-slate-600/40 hover:[&::-webkit-scrollbar-thumb]:bg-slate-500/60";

const TRACE_LEVELS = [
  "all",
  "browser",
  "network",
  "server",
  "auth",
  "db",
  "workflow",
  "external",
  "rpc",
  "ai",
  "billing",
  "internal",
];

type TraceDetailsAction = {
  label: string;
  onClick: () => void;
  disabled?: boolean;
};

export type TraceDetailsPanelProps = {
  run: DiagnosticRun | null;
  selectedSpanId?: string | null;
  onSelectedSpanChange?: (spanId: string | null) => void;
  detailLevelFilter?: string;
  onDetailLevelFilterChange?: (level: string) => void;
  breadcrumbs?: string[];
  actions?: TraceDetailsAction[];
};

function statusTone(status: string) {
  switch (status) {
    case "error":
      return "border-red-500/30 bg-red-500/10 text-red-200";
    case "running":
      return "border-amber-500/30 bg-amber-500/10 text-amber-200";
    default:
      return "border-[#00ff66]/30 bg-[#00ff66]/10 text-[#00ff66]";
  }
}

function spanTone(span: DiagnosticSpan) {
  if (span.status === "error") {
    return "bg-red-400";
  }
  if (span.status === "running") {
    return "bg-amber-300";
  }
  if (span.kind === "http" || span.step === "api-request") {
    return "bg-blue-400";
  }
  if (span.step === "http-request" || span.step === "network-fetch") {
    return "bg-cyan-300";
  }
  if (span.kind === "db") {
    return "bg-purple-300";
  }
  if (span.kind === "auth") {
    return "bg-fuchsia-300";
  }
  if (span.kind === "external" || span.kind === "rpc") {
    return "bg-orange-300";
  }
  if (span.kind === "workflow" || span.kind === "step") {
    return "bg-emerald-300";
  }
  if (span.id.startsWith("web_") || span.step.startsWith("ui-")) {
    return "bg-[#5b8cff]";
  }
  return "bg-slate-400";
}

function spanBadgeTone(span: DiagnosticSpan) {
  const level = traceLevel(span);
  switch (level) {
    case "browser":
      return "border-[#5b8cff]/40 bg-[#5b8cff]/15 text-[#9bb9ff]";
    case "network":
      return "border-cyan-400/40 bg-cyan-400/10 text-cyan-200";
    case "server":
      return "border-blue-400/40 bg-blue-400/10 text-blue-200";
    case "auth":
      return "border-fuchsia-400/40 bg-fuchsia-400/10 text-fuchsia-200";
    case "db":
      return "border-purple-400/40 bg-purple-400/10 text-purple-200";
    case "workflow":
      return "border-emerald-400/40 bg-emerald-400/10 text-emerald-200";
    case "external":
    case "rpc":
      return "border-orange-400/40 bg-orange-400/10 text-orange-200";
    case "ai":
      return "border-violet-400/40 bg-violet-400/10 text-violet-200";
    case "billing":
      return "border-yellow-400/40 bg-yellow-400/10 text-yellow-200";
    default:
      return "border-slate-400/40 bg-slate-400/10 text-slate-200";
  }
}

function traceLevel(span: DiagnosticSpan) {
  const kind = String(span.kind || "").toLowerCase();
  const step = String(span.step || "").toLowerCase();
  const trace = span.attributes?.trace;
  if (kind === "db" || step.startsWith("db.")) {
    return "db";
  }
  if (kind === "auth" || step.startsWith("auth.")) {
    return "auth";
  }
  if (kind === "external" || step.startsWith("fetch.")) {
    return "external";
  }
  if (kind === "rpc" || step.includes("rpc")) {
    return "rpc";
  }
  if (kind === "ai" || step.includes("ai")) {
    return "ai";
  }
  if (kind === "billing" || step.includes("billing")) {
    return "billing";
  }
  if (kind === "workflow" || kind === "step" || step.includes("workflow")) {
    return "workflow";
  }
  if (kind === "http" || kind === "http.server" || step === "api-request") {
    return "server";
  }
  if (step === "http-request" || step === "network-fetch") {
    return "network";
  }
  if (
    trace &&
    typeof trace === "object" &&
    !Array.isArray(trace) &&
    trace.surface === "server"
  ) {
    return "server";
  }
  return span.id.startsWith("web_") ||
    step.startsWith("ui-") ||
    step === "browser-session"
    ? "browser"
    : "internal";
}

function hasRedactedPayload(span: DiagnosticSpan) {
  return JSON.stringify({
    attributes: span.attributes,
    input: span.input,
    output: span.output,
  }).includes("[redacted]");
}

function surfaceLabel(span: DiagnosticSpan) {
  const trace = span.attributes?.trace;
  if (
    trace &&
    typeof trace === "object" &&
    !Array.isArray(trace) &&
    trace.surface === "server"
  ) {
    return "server";
  }
  return span.id.startsWith("web_") ||
    span.step.startsWith("ui-") ||
    span.step === "browser-session"
    ? "browser"
    : "server";
}

function formatTime(value: string | null | undefined) {
  if (!value) {
    return "";
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? ""
    : date.toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      });
}

function formatDateTime(value: string | null | undefined) {
  if (!value) {
    return "";
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? ""
    : date.toLocaleString([], {
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        month: "short",
        second: "2-digit",
      });
}

function renderHighlightedJsonLine(line: string, lineIndex: number) {
  const parts: ReactNode[] = [];
  const tokenPattern =
    /"(?:\\.|[^"\\])*"(?=\s*:)|"(?:\\.|[^"\\])*"|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?|\b(?:true|false|null)\b|[{}[\]:,]/g;
  let lastIndex = 0;

  for (const match of line.matchAll(tokenPattern)) {
    const token = match[0];
    const startIndex = match.index ?? 0;
    if (startIndex > lastIndex) {
      parts.push(
        <span
          className="text-slate-500"
          key={`${lineIndex}-plain-${startIndex}`}
        >
          {line.slice(lastIndex, startIndex)}
        </span>
      );
    }
    const className = token.startsWith('"')
      ? token.endsWith('"') &&
        line
          .slice(startIndex + token.length)
          .trimStart()
          .startsWith(":")
        ? "text-sky-300"
        : "text-emerald-300"
      : /^(true|false)$/.test(token)
        ? "text-violet-300"
        : token === "null"
          ? "text-slate-400"
          : /^-?\d/.test(token)
            ? "text-amber-300"
            : "text-slate-400";
    parts.push(
      <span className={className} key={`${lineIndex}-token-${startIndex}`}>
        {token}
      </span>
    );
    lastIndex = startIndex + token.length;
  }

  if (lastIndex < line.length) {
    parts.push(
      <span className="text-slate-500" key={`${lineIndex}-plain-end`}>
        {line.slice(lastIndex)}
      </span>
    );
  }

  return parts.length ? parts : " ";
}

function JsonBlock({ value }: { value: unknown }) {
  if (value == null) {
    return <span className="text-slate-500">None</span>;
  }
  if (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return <span>{String(value)}</span>;
  }
  const formatted = JSON.stringify(value, null, 2) ?? "";
  return (
    <pre
      className={cx(
        "max-h-[220px] overflow-auto rounded-lg border border-[#263348] bg-[#08111f] p-3 text-[11px] leading-5",
        TRACE_SCROLLBAR_CLASS
      )}
    >
      {formatted.split("\n").map((line, index) => (
        <div key={`${line}-${formatted.slice(0, index).length}`}>
          {renderHighlightedJsonLine(line, index)}
        </div>
      ))}
    </pre>
  );
}

export function TraceDetailsPanel({
  actions = [],
  breadcrumbs = ["Trace", "Trace Details"],
  detailLevelFilter,
  onDetailLevelFilterChange,
  onSelectedSpanChange,
  run,
  selectedSpanId,
}: TraceDetailsPanelProps) {
  const Button = useTraceButton();
  const [internalLevelFilter, setInternalLevelFilter] = useState("all");
  const activeLevelFilter = detailLevelFilter ?? internalLevelFilter;
  const selectedSpan =
    run?.spans.find((span) => span.id === selectedSpanId) ??
    run?.spans[0] ??
    null;

  if (!(run && selectedSpan)) {
    return (
      <div className="p-5 text-sm text-slate-400">
        Select a span from the timeline.
      </div>
    );
  }

  const waterfall = buildTraceWaterfall(run.spans);
  const hierarchyRows = waterfall.rows.filter(
    (row) =>
      activeLevelFilter === "all" || traceLevel(row) === activeLevelFilter
  );
  const totalDuration = Math.max(1, waterfall.totalDurationMs);
  const spanEvents = run.events.filter(
    (event) => event.spanId === selectedSpan.id
  );
  const spanLinks = run.links.filter(
    (link) =>
      link.spanId === selectedSpan.id || link.linkedSpanId === selectedSpan.id
  );
  const duration = formatTraceDuration(selectedSpan.durationMs) || "running";
  const summaryRows = [
    ["Status", selectedSpan.status],
    ["Duration", duration],
    ["Service", run.capability || "web.ui.session"],
    ["Operation", selectedSpan.label],
    ["Started", formatTime(selectedSpan.startedAt)],
  ];
  const setLevelFilter = (level: string) => {
    if (onDetailLevelFilterChange) {
      onDetailLevelFilterChange(level);
      return;
    }
    setInternalLevelFilter(level);
  };

  return (
    <div className="space-y-3 text-slate-100">
      <div className="flex items-start justify-between gap-4 border-[#263348] border-b px-4 py-3">
        <div className="min-w-0">
          <div className="mb-3 flex items-center gap-2 text-slate-500 text-xs">
            {breadcrumbs.map((crumb, index) => (
              <span className="contents" key={crumb}>
                {index > 0 ? <span>›</span> : null}
                <span>{crumb}</span>
              </span>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="truncate font-bold text-2xl text-slate-50">
              {selectedSpan.label}
            </h3>
            <span
              className={cx(
                "rounded-md border px-2 py-1 text-xs",
                statusTone(selectedSpan.status)
              )}
            >
              {selectedSpan.status}
            </span>
            <span
              className={cx(
                "rounded-md border px-2 py-1 text-xs",
                spanBadgeTone(selectedSpan)
              )}
            >
              {surfaceLabel(selectedSpan)}
            </span>
            <span
              className={cx(
                "rounded-md border px-2 py-1 text-xs",
                spanBadgeTone(selectedSpan)
              )}
            >
              {traceLevel(selectedSpan)}
            </span>
            {hasRedactedPayload(selectedSpan) ? (
              <span className="rounded-md border border-amber-400/30 bg-amber-400/10 px-2 py-0.5 text-amber-200 text-xs">
                redacted payload
              </span>
            ) : null}
          </div>
          <p className="mt-2 truncate text-slate-500 text-xs">
            {formatDateTime(selectedSpan.startedAt)} · Trace ID:{" "}
            {selectedSpan.traceId} · Span ID: {selectedSpan.id}
          </p>
        </div>
        <div className="flex shrink-0 items-start gap-4">
          <div className="text-right">
            <div className="font-bold text-3xl text-slate-50">{duration}</div>
            <p className="text-slate-500 text-xs">Total Duration</p>
          </div>
          {actions.length ? (
            <div className="flex items-center gap-2">
              {actions.map((action) => (
                <Button
                  disabled={action.disabled}
                  key={action.label}
                  onClick={action.onClick}
                  size="sm"
                  variant="outline"
                >
                  {action.label}
                </Button>
              ))}
            </div>
          ) : null}
        </div>
      </div>
      <div className="space-y-3 px-3 pb-3">
        <section className="rounded-xl border border-[#263348] bg-[#0d1422] p-3">
          <div className="mb-3 flex items-center justify-between">
            <h4 className="font-semibold text-slate-100 text-sm">Overview</h4>
            <span className="text-slate-500 text-xs">{selectedSpan.step}</span>
          </div>
          <div className="grid overflow-hidden rounded-lg border border-[#263348] bg-[#08111f] sm:grid-cols-5">
            {summaryRows.map(([label, value]) => (
              <div
                className="border-[#263348] border-r p-3 last:border-r-0"
                key={label}
              >
                <div className="text-[10px] text-slate-500 uppercase tracking-[0.22em]">
                  {label}
                </div>
                <div className="mt-2 truncate text-slate-100 text-sm">
                  {value}
                </div>
              </div>
            ))}
          </div>
        </section>
        <section className="rounded-xl border border-[#263348] bg-[#0d1422] p-3">
          <div className="mb-3 flex items-center justify-between gap-3">
            <h4 className="font-semibold text-slate-100 text-sm">
              Trace Hierarchy
            </h4>
            <div className="flex flex-wrap items-center gap-1">
              {TRACE_LEVELS.map((level) => (
                <button
                  className={cx(
                    "rounded-md border border-[#263348] px-2 py-1 text-[10px] uppercase tracking-[0.12em] transition hover:bg-[#162236]",
                    activeLevelFilter === level &&
                      "border-[#00ff66]/40 bg-[#00ff66]/10 text-[#00ff66]"
                  )}
                  data-trace-ignore="true"
                  key={level}
                  onClick={() => setLevelFilter(level)}
                  type="button"
                >
                  {level}
                </button>
              ))}
            </div>
          </div>
          <div className="overflow-hidden rounded-lg border border-[#263348] bg-[#08111f]">
            <div className="grid grid-cols-[minmax(260px,42%)_128px_90px_1fr] border-[#263348] border-b px-3 py-1.5 text-[10px] text-slate-500 tracking-[0.22em]">
              <span>SPAN</span>
              <span>TYPE</span>
              <span>TIME</span>
              <span className="grid grid-cols-5 gap-2">
                {[0, 0.25, 0.5, 0.75, 1].map((marker) => (
                  <span key={marker}>
                    {formatTraceDuration(totalDuration * marker).toUpperCase()}
                  </span>
                ))}
              </span>
            </div>
            <div
              className={cx(
                "max-h-[236px] overflow-auto",
                TRACE_SCROLLBAR_CLASS
              )}
            >
              {hierarchyRows.map((row) => {
                const width = Math.max(
                  0.6,
                  (row.durationMsClamped / totalDuration) * 100
                );
                const offset = Math.max(
                  0,
                  (row.offsetMs / totalDuration) * 100
                );
                return (
                  <button
                    className={cx(
                      "grid w-full grid-cols-[minmax(260px,42%)_128px_90px_1fr] items-center border-[#263348] border-b px-3 py-2 text-left transition last:border-b-0 hover:bg-[#162236]",
                      selectedSpan.id === row.id && "bg-[#1a2a3e]"
                    )}
                    key={row.id}
                    onClick={() => onSelectedSpanChange?.(row.id)}
                    type="button"
                  >
                    <div
                      className="min-w-0 text-slate-100"
                      style={{ paddingLeft: row.depth * 18 }}
                    >
                      <span className="truncate font-medium text-sm">
                        {row.label}
                      </span>
                    </div>
                    <span
                      className={cx(
                        "w-fit rounded border px-1.5 py-0.5 text-[10px] uppercase tracking-[0.14em]",
                        spanBadgeTone(row)
                      )}
                    >
                      {traceLevel(row)}
                    </span>
                    <span className="text-slate-400 text-xs">
                      {formatTraceDuration(row.durationMs) || "pending"}
                    </span>
                    <span className="relative h-5 rounded-full bg-black/25">
                      <span
                        className={cx(
                          "absolute top-1/2 h-2 -translate-y-1/2 rounded-full",
                          spanTone(row)
                        )}
                        style={{ left: `${offset}%`, width: `${width}%` }}
                      />
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        </section>
        <div className="grid gap-3 lg:grid-cols-2">
          <section className="rounded-xl border border-[#263348] bg-[#0d1422] p-3">
            <h4 className="mb-3 font-semibold text-slate-100 text-sm">
              Request Payload
            </h4>
            <JsonBlock value={selectedSpan.input ?? selectedSpan.attributes} />
          </section>
          <section className="rounded-xl border border-[#263348] bg-[#0d1422] p-3">
            <h4 className="mb-3 font-semibold text-slate-100 text-sm">
              Span Events
            </h4>
            <div
              className={cx(
                "max-h-[220px] space-y-2 overflow-auto",
                TRACE_SCROLLBAR_CLASS
              )}
            >
              {spanEvents.length ? (
                spanEvents.map((event) => (
                  <div
                    className="flex items-start justify-between rounded-lg border border-[#263348] bg-[#08111f] p-2.5"
                    key={event.id}
                  >
                    <div className="flex min-w-0 items-start gap-3">
                      <span className="mt-1.5 h-3 w-3 shrink-0 rounded-full border border-[#00ffcc]" />
                      <div className="min-w-0">
                        <div className="truncate font-medium text-slate-100 text-sm">
                          {selectedSpan.label}
                        </div>
                        <div className="text-slate-500 text-xs">
                          {event.type}
                        </div>
                      </div>
                    </div>
                    <div className="shrink-0 text-right text-slate-400 text-xs">
                      <div>{formatTime(event.at)}</div>
                      <div>{formatTraceDuration(event.durationMs)}</div>
                    </div>
                  </div>
                ))
              ) : (
                <div className="rounded-lg border border-[#263348] bg-[#08111f] p-3 text-slate-500 text-sm">
                  No events recorded for this span.
                </div>
              )}
            </div>
          </section>
        </div>
        <section className="rounded-xl border border-[#263348] bg-[#0d1422] p-3">
          <h4 className="mb-3 font-semibold text-slate-100 text-sm">
            Response
          </h4>
          <JsonBlock value={selectedSpan.output ?? selectedSpan.error} />
        </section>
        {spanLinks.length ? (
          <section className="rounded-xl border border-[#263348] bg-[#0d1422] p-3">
            <h4 className="mb-3 font-semibold text-slate-100 text-sm">
              Linked Spans
            </h4>
            <div className="space-y-2">
              {spanLinks.map((link) => {
                const targetId =
                  link.spanId === selectedSpan.id
                    ? link.linkedSpanId
                    : link.spanId;
                const target = run.spans.find((span) => span.id === targetId);
                return (
                  <button
                    className="flex w-full items-center justify-between rounded-lg border border-[#263348] bg-[#08111f] p-2.5 text-left hover:bg-[#162236]"
                    key={link.id}
                    onClick={() => onSelectedSpanChange?.(targetId)}
                    type="button"
                  >
                    <span className="min-w-0 truncate text-slate-100 text-sm">
                      {target?.label || targetId}
                    </span>
                    <span className="ml-3 shrink-0 rounded border border-[#263348] px-2 py-0.5 text-slate-400 text-xs uppercase tracking-[0.16em]">
                      {link.type}
                    </span>
                  </button>
                );
              })}
            </div>
          </section>
        ) : null}
      </div>
    </div>
  );
}
