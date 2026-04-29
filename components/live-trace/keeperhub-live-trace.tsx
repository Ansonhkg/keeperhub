"use client";

import type { DiagnosticRun, DiagnosticSpan } from "@keeperhub/trace-sdk/core";
import {
  buildTraceWaterfall,
  formatTraceDuration,
} from "@keeperhub/trace-sdk/core";
import { TraceDetailsPanel } from "@keeperhub/trace-sdk/react";
import {
  ChevronDown,
  Clipboard,
  Funnel,
  GitBranch,
  GripHorizontal,
  Maximize2,
  Play,
  Settings,
  Square,
  Trash2,
} from "lucide-react";
import { usePathname, useSearchParams } from "next/navigation";
import type { PointerEvent } from "react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { useSession } from "@/lib/auth-client";
import { cn } from "@/lib/utils";

const TRACE_SESSION_STORAGE_KEY = "keeperhub:live-trace-session";
const TRACE_WIDGET_STATE_STORAGE_KEY = "keeperhub:live-trace-widget";
const TRACE_IGNORE_ATTRIBUTE = "data-trace-ignore";
const TRACE_FLUSH_DELAY_MS = 90;
const TRACE_POLL_INTERVAL_MS = 1500;
const TRACE_PANEL_MIN_HEIGHT = 180;
const TRACE_PANEL_DEFAULT_MAX_HEIGHT = 560;
const APPLE_SCROLLBAR_CLASS =
  "scrollbar-thin scrollbar-track-transparent scrollbar-thumb-slate-600/40 hover:scrollbar-thumb-slate-500/60 [&::-webkit-scrollbar]:h-2 [&::-webkit-scrollbar]:w-2 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-slate-600/40 hover:[&::-webkit-scrollbar-thumb]:bg-slate-500/60";

type TraceSession = {
  runId: string;
  traceId: string;
  rootSpanId: string;
  started: boolean;
  startedAt: number | null;
};

type TraceWidgetState = {
  open: boolean;
  selectedSpanId: string | null;
  recording: boolean;
  panelHeight: number;
  levelFilter: string;
  detailLevelFilter: string;
  statusFilter: string;
  search: string;
  settingsOpen: boolean;
  showDateRangeTrack: boolean;
  allowTallerDockedResize: boolean;
  showSearchFilters: boolean;
};

type TraceJson =
  | null
  | string
  | number
  | boolean
  | TraceJson[]
  | { [key: string]: TraceJson };
type TraceObject = { [key: string]: TraceJson };

type TraceTimeRange = {
  startMs: number;
  endMs: number;
};

type TraceRangeInteractionKind = "pan" | "start" | "end";

type TraceRangeInteraction = {
  kind: TraceRangeInteractionKind;
  initialRange: TraceTimeRange;
  startX: number;
  trackWidth: number;
};

type TraceEvent = {
  type:
    | "run:start"
    | "run:success"
    | "run:error"
    | "step:start"
    | "step:end"
    | "step:error";
  runId: string;
  traceId: string;
  at: string;
  spanId?: string;
  parentSpanId?: string | null;
  label?: string;
  step?: string;
  kind?: string;
  attributes?: TraceObject;
  input?: TraceJson;
  output?: TraceJson;
  payload?: TraceJson;
  error?: { name: string; message: string };
};

type TraceHandledErrorDetail = {
  label?: string;
  step?: string;
  message?: string;
  errorName?: string;
  attributes?: TraceObject;
};

type KeeperHubLiveTraceProps = {
  enabled: boolean;
};

declare global {
  interface XMLHttpRequest {
    __keeperhubTrace?: { method: string; url: string };
  }

  interface WindowEventMap {
    "keeperhub:trace-error": CustomEvent<TraceHandledErrorDetail>;
  }
}

function readString(value: unknown) {
  return value == null ? "" : String(value).trim();
}

function createTraceId(prefix: string) {
  const random =
    typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : `${Date.now()}_${Math.random().toString(16).slice(2)}`;
  return `${prefix}_${random}`;
}

function createTraceSession(): TraceSession {
  return {
    rootSpanId: createTraceId("web_session"),
    runId: createTraceId("web_run"),
    started: false,
    startedAt: null,
    traceId: createTraceId("web_trace"),
  };
}

function createFullTraceTimeRange(totalDurationMs: number): TraceTimeRange {
  return { endMs: Math.max(1, Number(totalDurationMs) || 1), startMs: 0 };
}

function getMinimumTraceTimeRangeMs(totalDurationMs: number) {
  return Math.max(1, Math.max(1, Number(totalDurationMs) || 1) * 0.04);
}

function normalizeTraceTimeRange(
  range: TraceTimeRange,
  totalDurationMs: number
): TraceTimeRange {
  const safeTotalDurationMs = Math.max(1, Number(totalDurationMs) || 1);
  const minimumRangeMs = Math.min(
    safeTotalDurationMs,
    getMinimumTraceTimeRangeMs(safeTotalDurationMs)
  );
  let startMs = Math.max(
    0,
    Math.min(safeTotalDurationMs, Number(range.startMs) || 0)
  );
  let endMs = Math.max(
    0,
    Math.min(safeTotalDurationMs, Number(range.endMs) || safeTotalDurationMs)
  );

  if (endMs < startMs) {
    [startMs, endMs] = [endMs, startMs];
  }
  if (endMs - startMs < minimumRangeMs) {
    const centerMs = (startMs + endMs) / 2;
    startMs = centerMs - minimumRangeMs / 2;
    endMs = centerMs + minimumRangeMs / 2;
  }
  if (startMs < 0) {
    endMs -= startMs;
    startMs = 0;
  }
  if (endMs > safeTotalDurationMs) {
    const overflow = endMs - safeTotalDurationMs;
    startMs = Math.max(0, startMs - overflow);
    endMs = safeTotalDurationMs;
  }
  return { endMs: Math.max(startMs + minimumRangeMs, endMs), startMs };
}

function moveTraceTimeRange(
  range: TraceTimeRange,
  deltaMs: number,
  totalDurationMs: number
): TraceTimeRange {
  const safeTotalDurationMs = Math.max(1, Number(totalDurationMs) || 1);
  const durationMs = Math.max(
    getMinimumTraceTimeRangeMs(safeTotalDurationMs),
    range.endMs - range.startMs
  );
  const startMs = Math.max(
    0,
    Math.min(safeTotalDurationMs - durationMs, range.startMs + deltaMs)
  );
  return { endMs: startMs + durationMs, startMs };
}

function updateTraceTimeRange(
  interaction: TraceRangeInteraction,
  clientX: number,
  totalDurationMs: number
): TraceTimeRange {
  const deltaMs =
    ((clientX - interaction.startX) / Math.max(1, interaction.trackWidth)) *
    Math.max(1, totalDurationMs);
  if (interaction.kind === "pan") {
    return moveTraceTimeRange(
      interaction.initialRange,
      deltaMs,
      totalDurationMs
    );
  }
  if (interaction.kind === "start") {
    return normalizeTraceTimeRange(
      {
        endMs: interaction.initialRange.endMs,
        startMs: interaction.initialRange.startMs + deltaMs,
      },
      totalDurationMs
    );
  }
  return normalizeTraceTimeRange(
    {
      endMs: interaction.initialRange.endMs + deltaMs,
      startMs: interaction.initialRange.startMs,
    },
    totalDurationMs
  );
}

function getTraceTimeRangePercent(
  range: TraceTimeRange,
  totalDurationMs: number
) {
  const normalized = normalizeTraceTimeRange(range, totalDurationMs);
  const safeTotalDurationMs = Math.max(1, Number(totalDurationMs) || 1);
  return {
    left: `${(normalized.startMs / safeTotalDurationMs) * 100}%`,
    width: `${((normalized.endMs - normalized.startMs) / safeTotalDurationMs) * 100}%`,
  };
}

function resolveWaterfallBarPosition(
  offsetMs: number,
  durationMs: number,
  totalDurationMs: number,
  visibleRange: TraceTimeRange
) {
  const normalizedRange = normalizeTraceTimeRange(
    visibleRange,
    totalDurationMs
  );
  const rangeDurationMs = Math.max(
    1,
    normalizedRange.endMs - normalizedRange.startMs
  );
  const barStartMs = Math.max(0, Number(offsetMs) || 0);
  const barEndMs = Math.max(
    barStartMs,
    barStartMs + Math.max(0, Number(durationMs) || 0)
  );
  const visibleStartMs = Math.max(barStartMs, normalizedRange.startMs);
  const visibleEndMs = Math.min(barEndMs, normalizedRange.endMs);

  if (visibleEndMs <= visibleStartMs) {
    return { left: "0%", visible: false, width: "0%" };
  }
  const rawLeftPercent =
    ((visibleStartMs - normalizedRange.startMs) / rangeDurationMs) * 100;
  const rawWidthPercent =
    ((visibleEndMs - visibleStartMs) / rangeDurationMs) * 100;
  const leftPercent = Math.max(0, Math.min(99.4, rawLeftPercent));
  const widthPercent = Math.min(
    100 - leftPercent,
    Math.max(0.6, rawWidthPercent)
  );
  return { left: `${leftPercent}%`, visible: true, width: `${widthPercent}%` };
}

function defaultWidgetState(): TraceWidgetState {
  return {
    open: false,
    panelHeight: 260,
    recording: true,
    selectedSpanId: null,
    detailLevelFilter: "all",
    levelFilter: "all",
    search: "",
    settingsOpen: false,
    showDateRangeTrack: true,
    allowTallerDockedResize: false,
    showSearchFilters: false,
    statusFilter: "all",
  };
}

function maxDockedPanelHeight(allowTaller: boolean) {
  if (!allowTaller || typeof window === "undefined") {
    return TRACE_PANEL_DEFAULT_MAX_HEIGHT;
  }
  return Math.max(
    TRACE_PANEL_DEFAULT_MAX_HEIGHT,
    Math.min(900, Math.floor(window.innerHeight * 0.86))
  );
}

function readInitialTraceSession() {
  if (typeof window === "undefined") {
    return createTraceSession();
  }
  try {
    const raw = window.sessionStorage.getItem(TRACE_SESSION_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<TraceSession>;
      if (
        parsed.runId &&
        parsed.traceId &&
        parsed.rootSpanId &&
        !parsed.started
      ) {
        return {
          rootSpanId: String(parsed.rootSpanId),
          runId: String(parsed.runId),
          started: false,
          startedAt: null,
          traceId: String(parsed.traceId),
        } satisfies TraceSession;
      }
    }
  } catch {
    // Fall through to a fresh session.
  }
  const session = createTraceSession();
  writeTraceSession(session);
  return session;
}

function writeTraceSession(session: TraceSession) {
  try {
    window.sessionStorage.setItem(
      TRACE_SESSION_STORAGE_KEY,
      JSON.stringify(session)
    );
  } catch {
    // Best effort only.
  }
}

function readStoredWidgetState(): TraceWidgetState {
  try {
    const raw = window.localStorage.getItem(TRACE_WIDGET_STATE_STORAGE_KEY);
    if (!raw) {
      return defaultWidgetState();
    }
    const parsed = JSON.parse(raw) as Partial<TraceWidgetState>;
    return {
      levelFilter:
        typeof parsed.levelFilter === "string" ? parsed.levelFilter : "all",
      detailLevelFilter:
        typeof parsed.detailLevelFilter === "string"
          ? parsed.detailLevelFilter
          : "all",
      allowTallerDockedResize: Boolean(parsed.allowTallerDockedResize),
      open: Boolean(parsed.open),
      panelHeight:
        typeof parsed.panelHeight === "number"
          ? Math.min(
              maxDockedPanelHeight(Boolean(parsed.allowTallerDockedResize)),
              Math.max(TRACE_PANEL_MIN_HEIGHT, parsed.panelHeight)
            )
          : 260,
      recording: parsed.recording !== false,
      search: typeof parsed.search === "string" ? parsed.search : "",
      selectedSpanId:
        typeof parsed.selectedSpanId === "string"
          ? parsed.selectedSpanId
          : null,
      settingsOpen: Boolean(parsed.settingsOpen),
      showDateRangeTrack: parsed.showDateRangeTrack !== false,
      showSearchFilters: Boolean(parsed.showSearchFilters),
      statusFilter:
        typeof parsed.statusFilter === "string" ? parsed.statusFilter : "all",
    };
  } catch {
    return defaultWidgetState();
  }
}

function writeWidgetState(state: TraceWidgetState) {
  try {
    window.localStorage.setItem(
      TRACE_WIDGET_STATE_STORAGE_KEY,
      JSON.stringify(state)
    );
  } catch {
    // Best effort only.
  }
}

function isoNow() {
  return new Date().toISOString();
}

function closestTraceIgnored(target: EventTarget | null) {
  return (
    target instanceof Element &&
    Boolean(target.closest(`[${TRACE_IGNORE_ATTRIBUTE}]`))
  );
}

function truncate(value: string, limit = 180) {
  return value.length > limit ? `${value.slice(0, limit - 3)}...` : value;
}

function safeJsonValue(value: unknown, depth = 0): TraceJson {
  if (
    value == null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return typeof value === "string" ? truncate(value) : (value as TraceJson);
  }
  if (depth > 3) {
    return "[truncated]";
  }
  if (Array.isArray(value)) {
    return value.slice(0, 8).map((entry) => safeJsonValue(entry, depth + 1));
  }
  if (value instanceof URLSearchParams) {
    return Object.fromEntries([...value.entries()].slice(0, 12));
  }
  if (value instanceof FormData) {
    const entries: TraceObject = {};
    for (const [key, entry] of [...value.entries()].slice(0, 12)) {
      entries[key] =
        typeof entry === "string"
          ? truncate(entry)
          : `${entry.name} ${entry.size} bytes`;
    }
    return entries;
  }
  if (value instanceof Blob) {
    return { size: value.size, type: value.type || "blob" };
  }
  if (typeof value === "object") {
    const result: TraceObject = {};
    for (const [key, entry] of Object.entries(value).slice(0, 16)) {
      if (
        /(password|token|secret|authorization|cookie|csrf|api[-_]?key|credential|private|public)/i.test(
          key
        )
      ) {
        result[key] = "[redacted]";
        continue;
      }
      result[key] = safeJsonValue(entry, depth + 1);
    }
    return result;
  }
  return truncate(String(value));
}

function bodyPreview(body: BodyInit | null | undefined) {
  if (body == null) {
    return null;
  }
  if (typeof body === "string") {
    try {
      return safeJsonValue(JSON.parse(body));
    } catch {
      return truncate(body);
    }
  }
  return safeJsonValue(body);
}

function readFetchUrl(input: RequestInfo | URL) {
  if (typeof input === "string") {
    return input;
  }
  if (input instanceof URL) {
    return input.toString();
  }
  return input.url;
}

function readFetchMethod(input: RequestInfo | URL, init?: RequestInit) {
  return readString(
    init?.method ||
      (input instanceof Request ? input.method : "") ||
      (init?.body ? "POST" : "GET")
  ).toUpperCase();
}

function parseFetchUrl(url: string) {
  try {
    return new URL(url, window.location.origin);
  } catch {
    return null;
  }
}

function shouldTraceFetch(url: string) {
  const parsed = parseFetchUrl(url);
  if (!parsed) {
    return false;
  }
  if (parsed.origin !== window.location.origin) {
    return false;
  }
  return (
    parsed.pathname.startsWith("/api/") &&
    !parsed.pathname.startsWith("/api/diagnostics/")
  );
}

function requestLabel(method: string, url: string) {
  const parsed = parseFetchUrl(url);
  return `${method} ${parsed?.pathname || url}`;
}

function readTargetText(element: Element) {
  const value =
    element.getAttribute("data-trace-label") ||
    element.getAttribute("aria-label") ||
    element.getAttribute("title") ||
    element.getAttribute("name") ||
    element.getAttribute("placeholder") ||
    element.textContent ||
    element.getAttribute("href") ||
    element.tagName.toLowerCase();
  return truncate(value.replace(/\s+/g, " ").trim(), 80);
}

function describeInteractiveTarget(target: EventTarget | null) {
  const element = target instanceof Element ? target : null;
  const interactive = element?.closest(
    "button,a,input[type='button'],input[type='submit'],summary,[role='button'],[role='menuitem']"
  );
  if (
    !(interactive instanceof HTMLElement) ||
    interactive.closest(`[${TRACE_IGNORE_ATTRIBUTE}]`)
  ) {
    return null;
  }
  const label = readTargetText(interactive);
  if (!label) {
    return null;
  }
  const tag = interactive.tagName.toLowerCase();
  const isLink = interactive instanceof HTMLAnchorElement;
  const step = isLink ? "ui-click-link" : "ui-click";
  const action = isLink ? `Open ${label}` : `Click ${label}`;
  const targetPayload: TraceObject = {
    kind: isLink ? "link" : "control",
    label,
    tagName: tag,
  };
  if (interactive.id) {
    targetPayload.id = interactive.id;
  }
  if (isLink) {
    targetPayload.href = interactive.href;
    targetPayload.pathname = interactive.pathname;
  }
  return {
    attributes: {
      collapsedLabel: action,
      summary: action,
      target: targetPayload,
    },
    label: action,
    message: isLink ? interactive.href : tag,
    payload: { target: targetPayload },
    step,
  };
}

function describeFormTarget(target: EventTarget | null) {
  const element = target instanceof Element ? target : null;
  const form =
    element instanceof HTMLFormElement ? element : element?.closest("form");
  if (
    !(form instanceof HTMLFormElement) ||
    form.closest(`[${TRACE_IGNORE_ATTRIBUTE}]`)
  ) {
    return null;
  }
  const label = truncate(
    form.getAttribute("aria-label") ||
      form.getAttribute("name") ||
      form.id ||
      form.action ||
      "form",
    80
  );
  const action = `Submit ${label}`;
  const targetPayload: TraceObject = {
    action: form.action,
    kind: "form",
    label,
    method: form.method.toUpperCase() || "GET",
  };
  return {
    attributes: {
      collapsedLabel: action,
      summary: action,
      target: targetPayload,
    },
    label: action,
    message: `${form.method.toUpperCase() || "GET"} ${form.action || window.location.pathname}`,
    payload: { target: targetPayload },
    step: "ui-submit",
  };
}

function statusTone(status: string) {
  switch (status) {
    case "success":
      return "text-emerald-300";
    case "error":
      return "text-rose-300";
    case "running":
      return "text-amber-300";
    case "stopped":
      return "text-red-300";
    default:
      return "text-slate-400";
  }
}

function spanTone(span: DiagnosticSpan) {
  if (span.status === "error") {
    return "bg-[#ff6a5e]";
  }
  if (span.status === "running") {
    return "bg-[#f6c84c]";
  }
  const level = traceLevel(span);
  if (level === "db") {
    return "bg-cyan-300";
  }
  if (level === "external" || level === "rpc" || level === "ai") {
    return "bg-violet-300";
  }
  if (level === "auth") {
    return "bg-amber-300";
  }
  if (
    span.id.startsWith("web_") ||
    span.step.startsWith("ui-") ||
    span.step === "browser-session"
  ) {
    return "bg-[#5b8cff]";
  }
  return "bg-[#7bd85f]";
}

function spanBadgeTone(span: DiagnosticSpan) {
  if (span.status === "error") {
    return "border-[#ff6a5e]/40 bg-[#ff6a5e]/10 text-[#ffb0a9]";
  }
  if (span.status === "running") {
    return "border-[#f6c84c]/40 bg-[#f6c84c]/10 text-[#ffe08a]";
  }
  const level = traceLevel(span);
  if (level === "db") {
    return "border-cyan-300/30 bg-cyan-300/10 text-cyan-200";
  }
  if (level === "external" || level === "rpc" || level === "ai") {
    return "border-violet-300/30 bg-violet-300/10 text-violet-200";
  }
  if (level === "auth") {
    return "border-amber-300/30 bg-amber-300/10 text-amber-200";
  }
  if (
    span.id.startsWith("web_") ||
    span.step.startsWith("ui-") ||
    span.step === "browser-session"
  ) {
    return "border-[#5b8cff]/40 bg-[#5b8cff]/15 text-[#9bb9ff]";
  }
  return "border-[#7bd85f]/40 bg-[#7bd85f]/10 text-[#b7f2a5]";
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

function formatCopyPayload(value: unknown) {
  if (value == null) {
    return "null";
  }
  try {
    return JSON.stringify(value, null, 2) ?? "null";
  } catch {
    return String(value);
  }
}

function appendCopyPayload(
  lines: string[],
  label: string,
  value: unknown,
  indent = "  "
) {
  if (value == null) {
    return;
  }
  lines.push(`${indent}${label}:`);
  for (const line of formatCopyPayload(value).split("\n")) {
    lines.push(`${indent}  ${line}`);
  }
}

function copyMinimalTraceTree(run: DiagnosticRun) {
  const lines = [
    `Trace ${run.runId} ${run.status}`,
    `${run.spans.length} spans · ${run.events.length} events`,
  ];
  for (const span of run.spans.slice(0, 120)) {
    lines.push(
      `- ${span.label || span.step} · ${span.status} · ${formatTraceDuration(span.durationMs) || "pending"}`
    );
  }
  if (run.spans.length > 120) {
    lines.push(`... ${run.spans.length - 120} more spans omitted`);
  }
  if (run.links.length) {
    lines.push("Links:");
    for (const link of run.links.slice(0, 40)) {
      lines.push(`- ${link.spanId} -> ${link.linkedSpanId} (${link.type})`);
    }
  }
  return lines.join("\n");
}

function copyTraceWithErrors(run: DiagnosticRun) {
  const lines = [copyMinimalTraceTree(run)];
  const errorSpans = run.spans.filter(
    (span) => span.status === "error" || span.error
  );
  if (errorSpans.length) {
    lines.push("");
    lines.push("Errors:");
    for (const span of errorSpans) {
      const errorEvent = run.events.find(
        (event) => event.spanId === span.id && event.type === "step:error"
      );
      lines.push(
        `- ${span.label || span.step} · ${formatTraceDuration(span.durationMs) || "pending"}`
      );
      appendCopyPayload(lines, "error", span.error ?? errorEvent?.error);
      appendCopyPayload(lines, "payload", span.input ?? span.attributes);
      appendCopyPayload(lines, "response", span.output ?? errorEvent?.payload);
    }
  }
  return lines.join("\n");
}

function copyDiagnosticPrompt(run: DiagnosticRun) {
  return [
    "You are given an error trace and possibly some related code.",
    "",
    "Your task is NOT to immediately fix or resolve the issue.",
    "",
    "Instead, analyze the error trace carefully, identify the root cause (or most likely causes), and explain what is happening and why the error occurs.",
    "",
    "DO NOT provide a full implementation or final fixed code.",
    "",
    "Trace:",
    copyTraceWithErrors(run),
  ].join("\n");
}

export function KeeperHubLiveTrace({ enabled }: KeeperHubLiveTraceProps) {
  const { data: sessionData } = useSession();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [widgetState, setWidgetState] =
    useState<TraceWidgetState>(defaultWidgetState);
  const [traceSession, setTraceSession] = useState(readInitialTraceSession);
  const [currentRun, setCurrentRun] = useState<DiagnosticRun | null>(null);
  const [loadingRun, setLoadingRun] = useState(false);
  const [detailModalOpen, setDetailModalOpen] = useState(false);
  const [visibleRange, setVisibleRange] = useState<TraceTimeRange>(() =>
    createFullTraceTimeRange(1)
  );
  const [rangePinned, setRangePinned] = useState(false);
  const actor =
    sessionData?.user?.email ||
    sessionData?.user?.name ||
    sessionData?.user?.id ||
    "anonymous";
  const actorRef = useRef(actor);
  const sessionRef = useRef(traceSession);
  const stateRef = useRef(widgetState);
  const pendingEventsRef = useRef<TraceEvent[]>([]);
  const flushTimeoutRef = useRef<number | null>(null);
  const lastRouteRef = useRef<string | null>(null);
  const dragStartRef = useRef<{ height: number; y: number } | null>(null);
  const rangeTrackRef = useRef<HTMLDivElement | null>(null);
  const rangeInteractionRef = useRef<TraceRangeInteraction | null>(null);
  const previousRangeContextRef = useRef({ runId: "", totalDurationMs: 1 });

  useEffect(() => {
    setWidgetState(readStoredWidgetState());
  }, []);

  useEffect(() => {
    actorRef.current = actor;
  }, [actor]);

  useEffect(() => {
    sessionRef.current = traceSession;
    writeTraceSession(traceSession);
  }, [traceSession]);

  useEffect(() => {
    stateRef.current = widgetState;
    writeWidgetState(widgetState);
    document.documentElement.style.setProperty(
      "--trace-widget-docked-offset",
      widgetState.open ? `${widgetState.panelHeight}px` : "0px"
    );
    return () => {
      document.documentElement.style.setProperty(
        "--trace-widget-docked-offset",
        "0px"
      );
    };
  }, [widgetState]);

  function updateWidget(next: Partial<TraceWidgetState>) {
    setWidgetState((current) => ({ ...current, ...next }));
  }

  function isRecording() {
    return stateRef.current.recording;
  }

  function startResize(event: PointerEvent<HTMLButtonElement>) {
    event.preventDefault();
    dragStartRef.current = {
      height: widgetState.panelHeight,
      y: event.clientY,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function resizePanel(event: PointerEvent<HTMLButtonElement>) {
    const start = dragStartRef.current;
    if (!start) {
      return;
    }
    updateWidget({
      panelHeight: Math.min(
        maxDockedPanelHeight(widgetState.allowTallerDockedResize),
        Math.max(TRACE_PANEL_MIN_HEIGHT, start.height + start.y - event.clientY)
      ),
    });
  }

  function stopResize() {
    dragStartRef.current = null;
  }

  function runAttributes(trigger: string, summary: string): TraceObject {
    return {
      actor: actorRef.current,
      capability: "web.ui.session",
      mode: "live",
      origin: "browser",
      platform: "browser",
      provider: "keeperhub",
      summary,
      trace: { sourcePath: window.location.pathname, surface: "browser" },
      trigger,
    };
  }

  function startTrace(trigger: string, label: string, message: string) {
    const active = sessionRef.current;
    if (active.started) {
      return { events: [] as TraceEvent[], session: active };
    }
    const startedAt = Date.now();
    const next = { ...active, started: true, startedAt };
    sessionRef.current = next;
    setTraceSession(next);
    const attributes = {
      ...runAttributes(trigger, label),
      message: truncate(message),
    };
    return {
      events: [
        {
          at: new Date(startedAt).toISOString(),
          attributes,
          runId: next.runId,
          traceId: next.traceId,
          type: "run:start",
        },
        {
          at: new Date(startedAt).toISOString(),
          attributes,
          kind: "run",
          label: "Browser Session",
          parentSpanId: null,
          runId: next.runId,
          spanId: next.rootSpanId,
          step: "browser-session",
          traceId: next.traceId,
          type: "step:start",
        },
      ] satisfies TraceEvent[],
      session: next,
    };
  }

  function flushEventsSoon() {
    if (flushTimeoutRef.current) {
      window.clearTimeout(flushTimeoutRef.current);
    }
    flushTimeoutRef.current = window.setTimeout(() => {
      flushTimeoutRef.current = null;
      const events = pendingEventsRef.current.splice(0);
      if (!events.length) {
        return;
      }
      fetch("/api/diagnostics/events", {
        body: JSON.stringify({ events }),
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        keepalive: true,
        method: "POST",
      }).catch(() => {
        // Tracing must never break the app.
      });
    }, TRACE_FLUSH_DELAY_MS);
  }

  async function sendEventsNow(events: TraceEvent[]) {
    if (!events.length) {
      return;
    }
    try {
      await fetch("/api/diagnostics/events", {
        body: JSON.stringify({ events }),
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        keepalive: true,
        method: "POST",
      });
    } catch {
      // Tracing must never break the app.
    }
  }

  function queueEvents(events: TraceEvent[], options?: { force?: boolean }) {
    if (!(options?.force || isRecording())) {
      return;
    }
    pendingEventsRef.current.push(...events);
    flushEventsSoon();
    if (stateRef.current.open && isRecording()) {
      window.setTimeout(() => loadRun(), 240);
    }
  }

  function recordInstantStep(input: {
    trigger: string;
    step: string;
    label: string;
    message: string;
    payload?: TraceObject;
    attributes?: TraceObject;
  }) {
    if (!isRecording()) {
      return;
    }
    const started = startTrace(input.trigger, input.label, input.message);
    const at = Date.now();
    const spanId = createTraceId("web_step");
    queueEvents([
      ...started.events,
      {
        at: new Date(at).toISOString(),
        attributes: input.attributes,
        input: input.payload ?? null,
        kind: "step",
        label: input.label,
        parentSpanId: started.session.rootSpanId,
        runId: started.session.runId,
        spanId,
        step: input.step,
        traceId: started.session.traceId,
        type: "step:start",
      },
      {
        at: new Date(at + 1).toISOString(),
        output: input.payload ?? input.attributes ?? null,
        runId: started.session.runId,
        spanId,
        traceId: started.session.traceId,
        type: "step:end",
      },
    ]);
  }

  function recordErrorStep(input: {
    trigger: string;
    step: string;
    label: string;
    message: string;
    errorName: string;
    attributes?: TraceObject;
  }) {
    if (!isRecording()) {
      return;
    }
    const started = startTrace(input.trigger, input.label, input.message);
    const at = Date.now();
    const spanId = createTraceId("web_error");
    queueEvents([
      ...started.events,
      {
        at: new Date(at).toISOString(),
        attributes: input.attributes,
        error: { message: input.message, name: input.errorName },
        kind: "error",
        label: input.label,
        parentSpanId: started.session.rootSpanId,
        runId: started.session.runId,
        spanId,
        step: input.step,
        traceId: started.session.traceId,
        type: "step:start",
      },
      {
        at: new Date(at + 1).toISOString(),
        error: { message: input.message, name: input.errorName },
        runId: started.session.runId,
        spanId,
        traceId: started.session.traceId,
        type: "step:error",
      },
    ]);
  }

  async function loadRun() {
    const active = sessionRef.current;
    if (!active.started) {
      setCurrentRun(null);
      return;
    }
    setLoadingRun(true);
    try {
      const response = await fetch(
        `/api/diagnostics/runs/${encodeURIComponent(active.runId)}`,
        {
          credentials: "same-origin",
        }
      );
      if (!response.ok) {
        return;
      }
      const body = (await response.json()) as { run?: DiagnosticRun };
      if (body.run && body.run.runId === sessionRef.current.runId) {
        setCurrentRun(body.run);
        if (!stateRef.current.selectedSpanId && body.run.spans[0]) {
          updateWidget({ selectedSpanId: body.run.spans[0].id });
        }
      }
    } finally {
      setLoadingRun(false);
    }
  }

  useEffect(() => {
    if (!enabled) {
      return undefined;
    }
    function onClick(event: MouseEvent) {
      if (
        !isRecording() ||
        event.defaultPrevented ||
        event.button !== 0 ||
        closestTraceIgnored(event.target)
      ) {
        return;
      }
      const descriptor = describeInteractiveTarget(event.target);
      if (!descriptor) {
        return;
      }
      recordInstantStep({ ...descriptor, trigger: "click" });
    }
    function onSubmit(event: SubmitEvent) {
      if (!isRecording() || closestTraceIgnored(event.target)) {
        return;
      }
      const descriptor = describeFormTarget(event.target);
      if (!descriptor) {
        return;
      }
      recordInstantStep({ ...descriptor, trigger: "submit" });
    }
    document.addEventListener("click", onClick, true);
    document.addEventListener("submit", onSubmit, true);
    return () => {
      document.removeEventListener("click", onClick, true);
      document.removeEventListener("submit", onSubmit, true);
    };
  }, [enabled]);

  useEffect(() => {
    if (!(enabled && widgetState.recording)) {
      return;
    }
    const route = `${pathname}${searchParams.size ? `?${searchParams.toString()}` : ""}`;
    if (lastRouteRef.current === null) {
      lastRouteRef.current = route;
      return;
    }
    if (lastRouteRef.current === route) {
      return;
    }
    const previous = lastRouteRef.current;
    lastRouteRef.current = route;
    recordInstantStep({
      attributes: {
        collapsedLabel: `Navigate ${pathname || "/"}`,
        location: { from: previous, pathname, search: searchParams.toString() },
        summary: route,
      },
      label: `Navigate ${pathname || "/"}`,
      message: route,
      payload: {
        location: { from: previous, pathname, search: searchParams.toString() },
      },
      step: "ui-route-change",
      trigger: "navigate",
    });
  }, [enabled, pathname, searchParams, widgetState.recording]);

  useEffect(() => {
    if (!enabled || typeof window === "undefined") {
      return undefined;
    }
    let recordedPageLoad = false;
    const recordPageLoad = () => {
      if (recordedPageLoad || !isRecording()) {
        return;
      }
      recordedPageLoad = true;
      const navigation = performance.getEntriesByType("navigation")[0] as
        | PerformanceNavigationTiming
        | undefined;
      recordInstantStep({
        attributes: {
          durationMs: navigation ? Math.round(navigation.duration) : null,
          pathname: window.location.pathname,
          timing: navigation
            ? {
                domContentLoadedMs: Math.round(
                  navigation.domContentLoadedEventEnd - navigation.startTime
                ),
                loadEventMs: Math.round(
                  navigation.loadEventEnd - navigation.startTime
                ),
                responseEndMs: Math.round(
                  navigation.responseEnd - navigation.startTime
                ),
              }
            : null,
        },
        label: `Page load ${window.location.pathname || "/"}`,
        message: window.location.href,
        step: "page-load",
        trigger: "page-load",
      });
    };

    if (document.readyState === "complete") {
      window.setTimeout(recordPageLoad, 0);
    } else {
      window.addEventListener("load", recordPageLoad, { once: true });
    }

    function onError(event: ErrorEvent) {
      recordErrorStep({
        attributes: {
          colno: event.colno,
          filename: event.filename,
          lineno: event.lineno,
        },
        errorName: event.error instanceof Error ? event.error.name : "Error",
        label: "Client error",
        message: event.message || "Client error",
        step: "client-error",
        trigger: "client-error",
      });
    }

    function onUnhandledRejection(event: PromiseRejectionEvent) {
      const reason = event.reason;
      recordErrorStep({
        attributes: { reason: safeJsonValue(reason) },
        errorName: reason instanceof Error ? reason.name : "UnhandledRejection",
        label: "Unhandled promise rejection",
        message: reason instanceof Error ? reason.message : String(reason),
        step: "client-unhandled-rejection",
        trigger: "client-error",
      });
    }

    function onHandledError(event: CustomEvent<TraceHandledErrorDetail>) {
      const detail = event.detail ?? {};
      recordErrorStep({
        attributes: detail.attributes,
        errorName: detail.errorName || "HandledError",
        label: detail.label || "Handled client error",
        message: detail.message || "Handled client error",
        step: detail.step || "client-handled-error",
        trigger: "client-error",
      });
    }

    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onUnhandledRejection);
    window.addEventListener("keeperhub:trace-error", onHandledError);
    return () => {
      window.removeEventListener("load", recordPageLoad);
      window.removeEventListener("error", onError);
      window.removeEventListener("unhandledrejection", onUnhandledRejection);
      window.removeEventListener("keeperhub:trace-error", onHandledError);
    };
  }, [enabled]);

  useEffect(() => {
    if (!enabled || typeof window === "undefined") {
      return undefined;
    }
    const originalOpen = XMLHttpRequest.prototype.open;
    const originalSend = XMLHttpRequest.prototype.send;

    XMLHttpRequest.prototype.open = function tracedOpen(
      method: string,
      url: string | URL,
      async?: boolean,
      username?: string | null,
      password?: string | null
    ) {
      this.__keeperhubTrace = { method, url: String(url) };
      return originalOpen.call(
        this,
        method,
        url,
        async ?? true,
        username,
        password
      );
    };

    XMLHttpRequest.prototype.send = function tracedSend(
      body?: Document | XMLHttpRequestBodyInit | null
    ) {
      const metadata = this.__keeperhubTrace;
      if (!(metadata && isRecording() && shouldTraceFetch(metadata.url))) {
        return originalSend.call(this, body);
      }

      const label = requestLabel(metadata.method, metadata.url);
      const started = startTrace("xhr", label, label);
      const spanId = createTraceId("web_xhr");
      const startedAt = Date.now();
      const parsed = parseFetchUrl(metadata.url);

      this.setRequestHeader("X-KeeperHub-Trace-Run-Id", started.session.runId);
      this.setRequestHeader("X-KeeperHub-Trace-Id", started.session.traceId);
      this.setRequestHeader("X-KeeperHub-Trace-Parent-Span-Id", spanId);
      this.setRequestHeader("X-KeeperHub-Trace-Capability", "web.ui.session");
      this.setRequestHeader("X-KeeperHub-Trace-Origin", "browser");
      this.setRequestHeader("X-KeeperHub-Trace-Actor", actorRef.current);

      queueEvents([
        ...started.events,
        {
          at: new Date(startedAt).toISOString(),
          attributes: {
            request: {
              body:
                body instanceof Document
                  ? "[document]"
                  : bodyPreview(body ?? null),
              method: metadata.method,
              pathname: parsed?.pathname || "",
              search: parsed?.search || "",
              url: metadata.url,
            },
            summary: label,
            trace: {
              sourcePath: parsed?.pathname || metadata.url,
              surface: "browser",
            },
          },
          kind: "http",
          label,
          parentSpanId: started.session.rootSpanId,
          runId: started.session.runId,
          spanId,
          step: "xhr-request",
          traceId: started.session.traceId,
          type: "step:start",
        },
      ]);

      this.addEventListener("loadend", () => {
        const failed = this.status >= 400 || this.status === 0;
        queueEvents([
          {
            at: isoNow(),
            error: failed
              ? { message: `XHR failed (${this.status})`, name: "XHRError" }
              : undefined,
            output: {
              response: {
                durationMs: Math.max(0, Date.now() - startedAt),
                status: this.status,
              },
            },
            runId: started.session.runId,
            spanId,
            traceId: started.session.traceId,
            type: failed ? "step:error" : "step:end",
          },
        ]);
      });

      return originalSend.call(this, body);
    };

    return () => {
      XMLHttpRequest.prototype.open = originalOpen;
      XMLHttpRequest.prototype.send = originalSend;
    };
  }, [enabled]);

  useEffect(() => {
    if (!enabled || typeof window === "undefined") {
      return undefined;
    }
    const originalFetch = window.fetch.bind(window);
    window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = readFetchUrl(input);
      const method = readFetchMethod(input, init);
      if (!(isRecording() && shouldTraceFetch(url))) {
        return originalFetch(input, init);
      }

      const label = requestLabel(method, url);
      const started = startTrace("http", label, label);
      const spanId = createTraceId("web_http");
      const startedAt = Date.now();
      const parsed = parseFetchUrl(url);
      const headers = new Headers(
        init?.headers || (input instanceof Request ? input.headers : undefined)
      );
      headers.set("X-KeeperHub-Trace-Run-Id", started.session.runId);
      headers.set("X-KeeperHub-Trace-Id", started.session.traceId);
      headers.set("X-KeeperHub-Trace-Parent-Span-Id", spanId);
      headers.set("X-KeeperHub-Trace-Capability", "web.ui.session");
      headers.set("X-KeeperHub-Trace-Origin", "browser");
      headers.set("X-KeeperHub-Trace-Actor", actorRef.current);

      if (flushTimeoutRef.current) {
        window.clearTimeout(flushTimeoutRef.current);
        flushTimeoutRef.current = null;
      }
      await sendEventsNow(pendingEventsRef.current.splice(0));

      const requestPayload = {
        body: bodyPreview(init?.body ?? null),
        method,
        pathname: parsed?.pathname || "",
        search: parsed?.search || "",
        url,
      } satisfies TraceObject;

      queueEvents([
        {
          at: new Date(startedAt).toISOString(),
          attributes: {
            collapsedLabel: label,
            request: requestPayload,
            summary: label,
            trace: { sourcePath: parsed?.pathname || url, surface: "browser" },
          },
          input: { request: requestPayload },
          kind: "http",
          label,
          parentSpanId: started.session.rootSpanId,
          runId: started.session.runId,
          spanId,
          step: "http-request",
          traceId: started.session.traceId,
          type: "step:start",
        },
      ]);

      if (started.events.length) {
        await sendEventsNow(started.events);
      }

      try {
        const nextInit = { ...init, headers };
        const response = await originalFetch(
          input instanceof Request ? new Request(input, nextInit) : input,
          input instanceof Request ? undefined : nextInit
        );
        const durationMs = Math.max(0, Date.now() - startedAt);
        let responsePreview: TraceJson = null;
        try {
          const clone = response.clone();
          const contentType = clone.headers.get("content-type") || "";
          const text = await clone.text();
          responsePreview =
            contentType.includes("application/json") && text
              ? safeJsonValue(JSON.parse(text))
              : truncate(text);
        } catch {
          responsePreview = null;
        }
        queueEvents([
          {
            at: isoNow(),
            output: {
              response: {
                body: responsePreview,
                ok: response.ok,
                status: response.status,
              },
            },
            runId: started.session.runId,
            spanId,
            traceId: started.session.traceId,
            type: response.ok ? "step:end" : "step:error",
            ...(response.ok
              ? {}
              : {
                  error: {
                    message: `Request failed (${response.status})`,
                    name: "FetchError",
                  },
                }),
          },
        ]);
        return response;
      } catch (error) {
        queueEvents([
          {
            at: isoNow(),
            error: {
              message:
                error instanceof Error ? error.message : "Request failed",
              name: "FetchError",
            },
            runId: started.session.runId,
            spanId,
            traceId: started.session.traceId,
            type: "step:error",
          },
        ]);
        throw error;
      }
    };
    return () => {
      window.fetch = originalFetch;
    };
  }, [enabled]);

  useEffect(() => {
    if (
      !(
        enabled &&
        widgetState.open &&
        widgetState.recording &&
        traceSession.started
      )
    ) {
      return undefined;
    }
    void loadRun();
    const interval = window.setInterval(() => {
      void loadRun();
    }, TRACE_POLL_INTERVAL_MS);
    return () => window.clearInterval(interval);
  }, [
    enabled,
    widgetState.open,
    widgetState.recording,
    traceSession.started,
    traceSession.runId,
  ]);

  const displayedRun = currentRun;
  const selectedSpan =
    displayedRun?.spans.find(
      (span) => span.id === widgetState.selectedSpanId
    ) ||
    displayedRun?.spans[0] ||
    null;
  const waterfall = displayedRun
    ? buildTraceWaterfall(displayedRun.spans, displayedRun.startedAt)
    : null;
  const normalizedVisibleRange = waterfall
    ? rangePinned
      ? normalizeTraceTimeRange(visibleRange, waterfall.totalDurationMs)
      : createFullTraceTimeRange(waterfall.totalDurationMs)
    : createFullTraceTimeRange(1);
  const availableLevels = displayedRun
    ? ["all", ...new Set(displayedRun.spans.map(traceLevel))]
    : ["all"];
  const availableStatuses = displayedRun
    ? ["all", ...new Set(displayedRun.spans.map((span) => span.status))]
    : ["all"];
  const normalizedSearch = widgetState.search.trim().toLowerCase();
  const visibleRows = waterfall
    ? waterfall.rows.filter(
        (row) =>
          (widgetState.levelFilter === "all" ||
            traceLevel(row) === widgetState.levelFilter) &&
          (widgetState.statusFilter === "all" ||
            row.status === widgetState.statusFilter) &&
          (!normalizedSearch ||
            `${row.label} ${row.step} ${row.id} ${row.traceId}`
              .toLowerCase()
              .includes(normalizedSearch))
      )
    : [];
  const headerStatus = widgetState.recording
    ? displayedRun?.status || (traceSession.started ? "running" : "idle")
    : "stopped";
  const subtitle = displayedRun
    ? `${displayedRun.spans.length} spans · ${displayedRun.events.length} events`
    : widgetState.recording
      ? traceSession.started
        ? "Capturing browser session. History lives in Diagnostics."
        : "Trace idle. Interact with the UI to start recording."
      : "Recording stopped. Resume to capture a new browser session.";

  useEffect(() => {
    if (!(displayedRun && waterfall)) {
      return;
    }
    if (!rangePinned) {
      setVisibleRange(createFullTraceTimeRange(waterfall.totalDurationMs));
      previousRangeContextRef.current = {
        runId: displayedRun.runId,
        totalDurationMs: waterfall.totalDurationMs,
      };
      return;
    }
    setVisibleRange((current) => {
      const previous = previousRangeContextRef.current;
      previousRangeContextRef.current = {
        runId: displayedRun.runId,
        totalDurationMs: waterfall.totalDurationMs,
      };

      if (previous.runId !== displayedRun.runId) {
        return createFullTraceTimeRange(waterfall.totalDurationMs);
      }

      const wasFitToEnd =
        current.startMs <= 0.5 &&
        current.endMs >= previous.totalDurationMs - 0.5;
      if (wasFitToEnd) {
        return createFullTraceTimeRange(waterfall.totalDurationMs);
      }

      return normalizeTraceTimeRange(current, waterfall.totalDurationMs);
    });
  }, [displayedRun?.runId, rangePinned, waterfall?.totalDurationMs]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return undefined;
    }
    function clearRangeInteraction() {
      rangeInteractionRef.current = null;
      document.body.style.userSelect = "";
      document.documentElement.style.cursor = "";
    }
    function handlePointerMove(event: globalThis.PointerEvent) {
      const interaction = rangeInteractionRef.current;
      if (!(interaction && waterfall)) {
        return;
      }
      event.preventDefault();
      setVisibleRange(
        updateTraceTimeRange(
          interaction,
          event.clientX,
          waterfall.totalDurationMs
        )
      );
    }
    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", clearRangeInteraction);
    window.addEventListener("pointercancel", clearRangeInteraction);
    return () => {
      clearRangeInteraction();
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", clearRangeInteraction);
      window.removeEventListener("pointercancel", clearRangeInteraction);
    };
  }, [waterfall?.totalDurationMs]);

  if (!enabled) {
    return null;
  }

  function beginRangeInteraction(kind: TraceRangeInteractionKind) {
    return function handlePointerDown(event: PointerEvent<HTMLDivElement>) {
      if (event.button !== 0 || !waterfall) {
        return;
      }
      const track = rangeTrackRef.current;
      if (!track) {
        return;
      }
      const rect = track.getBoundingClientRect();
      if (rect.width <= 0) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      setRangePinned(true);
      rangeInteractionRef.current = {
        initialRange: normalizedVisibleRange,
        kind,
        startX: event.clientX,
        trackWidth: rect.width,
      };
      document.body.style.userSelect = "none";
      document.documentElement.style.cursor =
        kind === "pan" ? "grabbing" : "ew-resize";
    };
  }

  function resetVisibleRange() {
    if (!waterfall) {
      return;
    }
    setRangePinned(false);
    setVisibleRange(createFullTraceTimeRange(waterfall.totalDurationMs));
  }

  function stopRecording() {
    updateWidget({ recording: false });
    if (flushTimeoutRef.current) {
      window.clearTimeout(flushTimeoutRef.current);
      flushTimeoutRef.current = null;
    }
    const previous = sessionRef.current;
    if (previous.started) {
      queueEvents(
        [
          {
            at: isoNow(),
            output: { reason: "recording-stopped" },
            runId: previous.runId,
            spanId: previous.rootSpanId,
            traceId: previous.traceId,
            type: "step:end",
          },
          {
            at: isoNow(),
            runId: previous.runId,
            traceId: previous.traceId,
            type: "run:success",
          },
        ],
        { force: true }
      );
    }
  }

  function resumeRecording() {
    const next = createTraceSession();
    sessionRef.current = next;
    setTraceSession(next);
    setCurrentRun(null);
    setDetailModalOpen(false);
    updateWidget({ recording: true, selectedSpanId: null });
    writeTraceSession(next);
  }

  function toggleRecording() {
    if (widgetState.recording) {
      stopRecording();
      return;
    }
    resumeRecording();
  }

  function clearTrace() {
    const previous = sessionRef.current;
    if (previous.started) {
      queueEvents(
        [
          {
            at: isoNow(),
            output: { reason: "clear" },
            runId: previous.runId,
            spanId: previous.rootSpanId,
            traceId: previous.traceId,
            type: "step:end",
          },
          {
            at: isoNow(),
            runId: previous.runId,
            traceId: previous.traceId,
            type: "run:success",
          },
        ],
        { force: true }
      );
    }
    const next = createTraceSession();
    sessionRef.current = next;
    setTraceSession(next);
    setCurrentRun(null);
    setDetailModalOpen(false);
    updateWidget({ selectedSpanId: null });
    pendingEventsRef.current = [];
    writeTraceSession(next);
  }

  async function copyTrace() {
    if (!displayedRun) {
      return;
    }
    try {
      await navigator.clipboard.writeText(copyMinimalTraceTree(displayedRun));
      toast.success("Minimal trace tree copied");
    } catch {
      toast.error("Could not copy trace");
    }
  }

  async function copyPrompt() {
    if (!displayedRun) {
      return;
    }
    try {
      await navigator.clipboard.writeText(copyDiagnosticPrompt(displayedRun));
      toast.success("Diagnostic prompt copied");
    } catch {
      toast.error("Could not copy prompt");
    }
  }

  function renderTraceTimelineTrack() {
    if (!(displayedRun && waterfall && widgetState.showDateRangeTrack)) {
      return null;
    }
    const totalDuration = Math.max(1, waterfall.totalDurationMs);
    const rangePercent = getTraceTimeRangePercent(
      normalizedVisibleRange,
      totalDuration
    );
    const isFullRange =
      normalizedVisibleRange.startMs <= 0.5 &&
      normalizedVisibleRange.endMs >= totalDuration - 0.5;
    const ticks = [0, 0.25, 0.5, 0.75, 1];
    return (
      <div className="border-[#263348] border-b px-3 py-2">
        <div className="mb-2 flex items-center justify-between gap-3 text-[10px] text-slate-400 tracking-[0.22em]">
          <span>
            {formatTraceDuration(normalizedVisibleRange.startMs).toUpperCase()}{" "}
            - {formatTraceDuration(normalizedVisibleRange.endMs).toUpperCase()}
          </span>
          <button
            className="rounded-md border border-[#263348] px-2 py-0.5 text-[10px] text-slate-500 uppercase tracking-[0.16em] transition hover:border-[#5b8cff]/40 hover:text-slate-300 disabled:opacity-40"
            data-trace-ignore="true"
            disabled={isFullRange}
            onClick={resetVisibleRange}
            type="button"
          >
            <Maximize2 className="h-3 w-3" />
          </button>
        </div>
        <div
          aria-label="Trace timeline range"
          aria-valuemax={Math.round(totalDuration)}
          aria-valuemin={0}
          aria-valuenow={Math.round(normalizedVisibleRange.endMs)}
          className="relative h-6 overflow-hidden rounded-lg border border-[#263348] bg-[#071222] shadow-[inset_0_0_0_1px_rgba(91,140,255,0.14)]"
          data-trace-ignore="true"
          onDoubleClick={resetVisibleRange}
          ref={rangeTrackRef}
          role="slider"
          tabIndex={0}
        >
          <div className="absolute inset-x-1 top-1/2 h-3 -translate-y-1/2 rounded-md bg-[#07101d]" />
          {ticks.slice(1, -1).map((tick) => (
            <div
              className="pointer-events-none absolute top-0 bottom-0 w-px bg-[#2d7fbc]/45"
              key={tick}
              style={{ left: `${tick * 100}%` }}
            />
          ))}
          <div
            className="absolute top-1 bottom-1 cursor-grab rounded-md border border-[#0b8de8] bg-[#0b5d9b]/70 shadow-[0_0_0_1px_rgba(91,140,255,0.18),0_8px_24px_rgba(37,99,235,0.22)] active:cursor-grabbing"
            onPointerDown={beginRangeInteraction("pan")}
            style={rangePercent}
            title="Drag to pan the visible trace range"
          >
            <div
              className="absolute inset-y-0 left-0 w-2 cursor-ew-resize rounded-l-md border-[#5b8cff]/60 border-r bg-[#5b8cff]/35"
              onPointerDown={beginRangeInteraction("start")}
              title="Drag to resize range start"
            />
            <div
              className="absolute inset-y-0 right-0 w-2 cursor-ew-resize rounded-r-md border-[#5b8cff]/60 border-l bg-[#5b8cff]/35"
              onPointerDown={beginRangeInteraction("end")}
              title="Drag to resize range end"
            />
          </div>
        </div>
      </div>
    );
  }

  function renderTimeline() {
    if (!(displayedRun && waterfall?.rows.length)) {
      return (
        <div className="p-5 text-sm text-slate-400">
          {loadingRun
            ? "Capturing trace data..."
            : "No active trace. Interact with the UI to start a new trace."}
        </div>
      );
    }
    const totalDuration = Math.max(1, waterfall.totalDurationMs);
    return (
      <div className="overflow-hidden rounded-xl border border-[#263348] bg-[#0b1220]">
        {renderTraceTimelineTrack()}
        {widgetState.showSearchFilters ? (
          <div className="flex flex-wrap items-center gap-3 border-[#263348] border-b bg-[#10131a] px-3 py-1.5 text-slate-300 text-xs">
            <div className="flex h-7 min-w-[240px] flex-1 items-center gap-2 rounded-full bg-white/10 px-3 text-slate-300">
              <Funnel className="h-3.5 w-3.5 text-slate-400" />
              <input
                className="min-w-0 flex-1 bg-transparent text-slate-100 outline-none placeholder:text-slate-400"
                data-trace-ignore="true"
                onChange={(event) =>
                  updateWidget({ search: event.target.value })
                }
                placeholder="Filter"
                value={widgetState.search}
              />
            </div>
            <div className="flex flex-wrap items-center gap-1">
              {availableStatuses.map((status) => (
                <button
                  className={cn(
                    "rounded-md border border-slate-500/70 px-2 py-0.5 font-semibold text-xs capitalize transition hover:bg-white/10",
                    widgetState.statusFilter === status &&
                      "border-[#8f8cff]/70 bg-[#8f8cff]/30 text-slate-50"
                  )}
                  data-trace-ignore="true"
                  key={status}
                  onClick={() => updateWidget({ statusFilter: status })}
                  type="button"
                >
                  {status === "all" ? "All" : status}
                </button>
              ))}
              {availableLevels.map((level) => (
                <button
                  className={cn(
                    "rounded-md border border-slate-500/70 px-2 py-0.5 font-semibold text-xs capitalize transition hover:bg-white/10",
                    widgetState.levelFilter === level &&
                      "border-[#8f8cff]/70 bg-[#8f8cff]/30 text-slate-50"
                  )}
                  data-trace-ignore="true"
                  key={level}
                  onClick={() => updateWidget({ levelFilter: level })}
                  type="button"
                >
                  {level === "all" ? "All" : level}
                </button>
              ))}
            </div>
          </div>
        ) : null}
        <div className="grid grid-cols-[minmax(220px,34%)_128px_84px_1fr] border-[#263348] border-b px-3 py-1.5 text-[10px] text-slate-500 tracking-[0.28em]">
          <span>NAME</span>
          <span>TYPE</span>
          <span>TIME</span>
          <span>WATERFALL</span>
        </div>
        <div className={cn("overflow-auto", APPLE_SCROLLBAR_CLASS)}>
          {visibleRows.length === 0 ? (
            <div className="px-3 py-6 text-center text-slate-500 text-sm">
              No spans match the selected level.
            </div>
          ) : null}
          {visibleRows.map((row) => {
            const position = resolveWaterfallBarPosition(
              row.offsetMs,
              row.durationMsClamped,
              totalDuration,
              normalizedVisibleRange
            );
            return (
              <button
                className={cn(
                  "grid w-full grid-cols-[minmax(220px,34%)_128px_84px_1fr] items-center border-[#263348] border-b px-3 py-1.5 text-left transition last:border-b-0 hover:bg-[#162236]",
                  row.status === "error" &&
                    "border-red-500/35 bg-red-500/10 text-red-50 hover:bg-red-500/15",
                  widgetState.selectedSpanId === row.id &&
                    (row.status === "error"
                      ? "bg-red-500/15 shadow-[inset_3px_0_0_rgba(248,113,113,0.85)]"
                      : "bg-[#14243a]")
                )}
                key={row.id}
                onClick={() => {
                  updateWidget({ selectedSpanId: row.id });
                  setDetailModalOpen(true);
                }}
                type="button"
              >
                <div
                  className="min-w-0 text-slate-100"
                  style={{ paddingLeft: row.depth * 20 }}
                >
                  <span className="truncate font-medium text-sm">
                    {row.label}
                  </span>
                  <span className="ml-1 text-[10px] text-slate-500 uppercase tracking-[0.18em]">
                    {row.step.replace(/^ui-/, "")}
                  </span>
                  {hasRedactedPayload(row) ? (
                    <span className="ml-1 rounded border border-amber-400/30 px-1.5 py-0.5 text-[10px] text-amber-200 uppercase tracking-[0.16em]">
                      redacted
                    </span>
                  ) : null}
                </div>
                <span
                  className={cn(
                    "w-fit rounded border px-1.5 py-0.5 text-[10px] uppercase tracking-[0.18em]",
                    spanBadgeTone(row)
                  )}
                >
                  {traceLevel(row)}
                </span>
                <div className="text-slate-400 text-xs">
                  {formatTraceDuration(row.durationMs) || "pending"}
                </div>
                <div className="relative h-5 rounded-full bg-black/30">
                  {position.visible ? (
                    <div
                      className={cn(
                        "absolute top-1/2 h-2 -translate-y-1/2 rounded-full",
                        spanTone(row)
                      )}
                      style={{ left: position.left, width: position.width }}
                    />
                  ) : null}
                </div>
              </button>
            );
          })}
        </div>
      </div>
    );
  }

  function renderDetails() {
    return (
      <TraceDetailsPanel
        actions={[
          {
            disabled: !displayedRun,
            label: "Copy Trace",
            onClick: () => void copyTrace(),
          },
          {
            disabled: !displayedRun,
            label: "Copy Prompt",
            onClick: () => void copyPrompt(),
          },
          {
            label: "Close",
            onClick: () => setDetailModalOpen(false),
          },
        ]}
        breadcrumbs={["Live Trace", "Trace Details"]}
        detailLevelFilter={widgetState.detailLevelFilter}
        onDetailLevelFilterChange={(level) =>
          updateWidget({ detailLevelFilter: level })
        }
        onSelectedSpanChange={(spanId) =>
          updateWidget({ selectedSpanId: spanId })
        }
        run={displayedRun}
        selectedSpanId={widgetState.selectedSpanId}
      />
    );
  }

  function renderPanel() {
    return (
      <section
        aria-label="Live trace"
        className="pointer-events-auto flex flex-col overflow-hidden border border-[#263348] border-b-0 bg-[#0b1220]/98 text-slate-100 shadow-2xl backdrop-blur"
        data-trace-ignore="true"
        style={{ height: widgetState.panelHeight }}
      >
        <button
          aria-label="Resize live trace panel"
          className="flex h-4 w-full cursor-ns-resize items-center justify-center text-slate-500 hover:bg-[#162236] hover:text-slate-300"
          onPointerCancel={stopResize}
          onPointerDown={startResize}
          onPointerMove={resizePanel}
          onPointerUp={stopResize}
          type="button"
        >
          <GripHorizontal className="h-3.5 w-3.5" />
        </button>
        <div className="flex items-start justify-between gap-4 border-[#263348] border-b px-4 py-2.5">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-3">
              <GitBranch className="h-4 w-4 text-[#00ff66]" />
              <span className="font-semibold text-base">Live trace</span>
              <span className={cn("text-sm", statusTone(headerStatus))}>
                {headerStatus}
              </span>
              <span className="text-slate-400 text-sm">{subtitle}</span>
            </div>
            <div className="mt-1 flex items-center gap-2 text-slate-400 text-xs">
              <span className="truncate">
                {displayedRun?.runId || traceSession.runId}
              </span>
              <span>·</span>
              <a
                className="text-slate-100 underline-offset-4 hover:underline"
                href="/diagnostics"
              >
                Diagnostics
              </a>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <Button
              className={cn(
                "h-8 gap-2 px-3",
                widgetState.recording &&
                  "border-red-500/40 bg-red-500/10 text-red-200 hover:bg-red-500/20",
                !widgetState.recording &&
                  "border-[#00ff66]/40 bg-[#00ff66]/10 text-[#00ff66] hover:bg-[#00ff66]/15"
              )}
              onClick={toggleRecording}
              size="sm"
              type="button"
              variant="outline"
            >
              {widgetState.recording ? (
                <Square className="h-3.5 w-3.5 fill-current" />
              ) : (
                <Play className="h-3.5 w-3.5 fill-current" />
              )}
              {widgetState.recording ? "Stop" : "Record"}
            </Button>
            <Button
              className="h-8 gap-2 px-3"
              disabled={!displayedRun}
              onClick={() => void copyTrace()}
              size="sm"
              type="button"
              variant="ghost"
            >
              <Clipboard className="h-4 w-4" />
              Copy Trace
            </Button>
            <Button
              className="h-8 gap-2 px-3"
              disabled={!displayedRun}
              onClick={() => void copyPrompt()}
              size="sm"
              type="button"
              variant="ghost"
            >
              <Clipboard className="h-4 w-4" />
              Copy Prompt
            </Button>
            <Button
              className="h-8 w-8"
              onClick={() =>
                updateWidget({
                  showSearchFilters: !widgetState.showSearchFilters,
                })
              }
              size="icon"
              type="button"
              variant={widgetState.showSearchFilters ? "secondary" : "ghost"}
            >
              <Funnel className="h-4 w-4" />
            </Button>
            <div className="relative">
              <Button
                className="h-8 w-8"
                onClick={() =>
                  updateWidget({ settingsOpen: !widgetState.settingsOpen })
                }
                size="icon"
                type="button"
                variant={widgetState.settingsOpen ? "secondary" : "ghost"}
              >
                <Settings className="h-4 w-4" />
              </Button>
              {widgetState.settingsOpen ? (
                <div
                  className="absolute top-10 right-0 z-[70] w-80 rounded-xl border border-[#263348] bg-[#0b1220] p-3 text-slate-100 shadow-2xl"
                  data-trace-ignore="true"
                >
                  <div className="mb-3">
                    <div className="font-semibold text-sm">Trace settings</div>
                    <div className="mt-1 text-slate-500 text-xs">
                      Display preferences only. Captured trace events are
                      unchanged.
                    </div>
                  </div>
                  <div className="space-y-3">
                    <label className="flex cursor-pointer items-start justify-between gap-3 rounded-lg border border-[#263348] bg-[#08111f] p-3 text-sm">
                      <span>
                        <span className="block text-slate-100">
                          Show trace timeline
                        </span>
                        <span className="mt-0.5 block text-slate-500 text-xs">
                          Show the compact duration track above the waterfall.
                        </span>
                      </span>
                      <input
                        checked={widgetState.showDateRangeTrack}
                        className="mt-0.5 h-4 w-4 accent-[#00ff66]"
                        data-trace-ignore="true"
                        onChange={(event) =>
                          updateWidget({
                            showDateRangeTrack: event.target.checked,
                          })
                        }
                        type="checkbox"
                      />
                    </label>
                    <label className="flex cursor-pointer items-start justify-between gap-3 rounded-lg border border-[#263348] bg-[#08111f] p-3 text-sm">
                      <span>
                        <span className="block text-slate-100">
                          Allow taller docked resize
                        </span>
                        <span className="mt-0.5 block text-slate-500 text-xs">
                          Let the bottom dock grow beyond the default height
                          cap.
                        </span>
                      </span>
                      <input
                        checked={widgetState.allowTallerDockedResize}
                        className="mt-0.5 h-4 w-4 accent-[#00ff66]"
                        data-trace-ignore="true"
                        onChange={(event) => {
                          const allowTaller = event.target.checked;
                          updateWidget({
                            allowTallerDockedResize: allowTaller,
                            panelHeight: allowTaller
                              ? widgetState.panelHeight
                              : Math.min(
                                  TRACE_PANEL_DEFAULT_MAX_HEIGHT,
                                  widgetState.panelHeight
                                ),
                          });
                        }}
                        type="checkbox"
                      />
                    </label>
                  </div>
                </div>
              ) : null}
            </div>
            <Button
              className="h-8 w-8"
              disabled={!(displayedRun || traceSession.started)}
              onClick={clearTrace}
              size="icon"
              type="button"
              variant="ghost"
            >
              <Trash2 className="h-4 w-4" />
            </Button>
            <Button
              className="h-8 w-8"
              onClick={() => updateWidget({ open: false })}
              size="icon"
              type="button"
              variant="ghost"
            >
              <ChevronDown className="h-4 w-4" />
            </Button>
          </div>
        </div>
        <div
          className={cn(
            "min-h-0 flex-1 overflow-auto p-3",
            APPLE_SCROLLBAR_CLASS
          )}
        >
          {renderTimeline()}
        </div>
      </section>
    );
  }

  function renderDetailDialog() {
    return (
      <Dialog onOpenChange={setDetailModalOpen} open={detailModalOpen}>
        <DialogContent
          className="z-[90] max-h-[86vh] max-w-[min(1120px,94vw)] overflow-hidden border-[#263348] bg-[#0b1220] p-0 text-slate-100 shadow-2xl sm:max-w-[min(1120px,94vw)]"
          data-trace-ignore="true"
          showCloseButton={false}
        >
          <DialogTitle className="sr-only">Trace Details</DialogTitle>
          <div
            className={cn("max-h-[86vh] overflow-auto", APPLE_SCROLLBAR_CLASS)}
          >
            {renderDetails()}
          </div>
        </DialogContent>
      </Dialog>
    );
  }

  if (!widgetState.open) {
    return (
      <>
        {renderDetailDialog()}
        <div className="pointer-events-none fixed right-5 bottom-5 z-[60]">
          <Button
            className="pointer-events-auto h-10 gap-2 rounded-full border-[#263348] bg-[#0b1220]/95 px-4 text-slate-100 shadow-2xl backdrop-blur hover:bg-[#162236]"
            data-trace-ignore="true"
            onClick={() => updateWidget({ open: true })}
            size="sm"
            type="button"
            variant="outline"
          >
            <GitBranch className="h-4 w-4 text-[#00ff66]" />
            Trace
            <span className={cn("text-xs", statusTone(headerStatus))}>
              {headerStatus}
            </span>
          </Button>
        </div>
      </>
    );
  }

  return (
    <>
      {renderDetailDialog()}
      <div className="pointer-events-none fixed right-0 bottom-0 left-0 z-[60]">
        {renderPanel()}
      </div>
    </>
  );
}
