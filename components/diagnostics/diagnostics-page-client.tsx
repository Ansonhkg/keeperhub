"use client";

import type {
  DiagnosticRun,
  DiagnosticRunSummary,
} from "@keeperhub/trace-sdk/core";
import { LiveTraceInspector } from "@keeperhub/trace-sdk/react";
import { Download, RefreshCw, Trash2 } from "lucide-react";
import { useSearchParams } from "next/navigation";
import {
  startTransition,
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useState,
} from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { api, type DiagnosticsSummary } from "@/lib/api-client";
import { cn } from "@/lib/utils";
import { KeeperHubTraceProvider } from "./keeperhub-trace-provider";

type RunsState = {
  runs: DiagnosticRunSummary[];
  total: number;
  page: number;
  pageSize: number;
  capabilities: string[];
};

const TRACE_SCROLLBAR_CLASS =
  "scrollbar-thin scrollbar-track-transparent scrollbar-thumb-slate-600/40 hover:scrollbar-thumb-slate-500/60 [&::-webkit-scrollbar]:h-2 [&::-webkit-scrollbar]:w-2 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-slate-600/40 hover:[&::-webkit-scrollbar-thumb]:bg-slate-500/60";

function downloadJson(filename: string, payload: unknown) {
  const blob = new Blob([JSON.stringify(payload, null, 2)], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

function formatBytes(value: number | undefined) {
  if (!value) {
    return "0 B";
  }
  if (value < 1024) {
    return `${value} B`;
  }
  if (value < 1024 * 1024) {
    return `${(value / 1024).toFixed(1)} KB`;
  }
  return `${(value / 1024 / 1024).toFixed(1)} MB`;
}

function statusTone(status: string) {
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

function runStartedAt(run: DiagnosticRunSummary) {
  const date = new Date(run.startedAt);
  return Number.isNaN(date.getTime()) ? "Unknown start" : date.toLocaleString();
}

export function DiagnosticsPageClient() {
  const searchParams = useSearchParams();
  const deepLinkedId =
    searchParams.get("id") ??
    searchParams.get("runId") ??
    searchParams.get("traceId") ??
    "";
  const [summary, setSummary] = useState<DiagnosticsSummary | null>(null);
  const [runsState, setRunsState] = useState<RunsState>({
    capabilities: [],
    page: 0,
    pageSize: 20,
    runs: [],
    total: 0,
  });
  const [selectedRun, setSelectedRun] = useState<DiagnosticRun | null>(null);
  const [selectedRunId, setSelectedRunId] = useState(deepLinkedId);
  const [selectedSpanId, setSelectedSpanId] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState("all");
  const [capabilityFilter, setCapabilityFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);
  const [retentionDays, setRetentionDays] = useState("30");
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const deferredSearch = useDeferredValue(search.trim());

  const query = useMemo(
    () => ({
      capability: capabilityFilter,
      page,
      pageSize: 20,
      search: deferredSearch,
      status: statusFilter,
    }),
    [capabilityFilter, deferredSearch, page, statusFilter]
  );

  const loadSummaryAndRuns = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [summaryResponse, runsResponse] = await Promise.all([
        api.diagnostics.getSummary(),
        api.diagnostics.listRuns(query),
      ]);
      setSummary(summaryResponse.summary);
      setRunsState(runsResponse);
      setSelectedRunId(
        (current) => current || runsResponse.runs[0]?.runId || ""
      );
    } catch (loadError) {
      const message =
        loadError instanceof Error
          ? loadError.message
          : "Failed to load diagnostics";
      setError(message);
    } finally {
      setLoading(false);
    }
  }, [query]);

  useEffect(() => {
    loadSummaryAndRuns().catch((loadError: unknown) => {
      setError(
        loadError instanceof Error
          ? loadError.message
          : "Failed to load diagnostics"
      );
    });
  }, [loadSummaryAndRuns]);

  useEffect(() => {
    if (!deepLinkedId) {
      return;
    }
    let cancelled = false;
    api.diagnostics
      .listRuns({ page: 0, pageSize: 50, search: deepLinkedId })
      .then((response) => {
        if (cancelled) {
          return;
        }
        const exactMatch = response.runs.find(
          (run) => run.runId === deepLinkedId || run.traceId === deepLinkedId
        );
        setSelectedRunId(exactMatch?.runId ?? deepLinkedId);
      })
      .catch(() => {
        if (!cancelled) {
          setSelectedRunId(deepLinkedId);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [deepLinkedId]);

  useEffect(() => {
    if (!selectedRunId) {
      setSelectedRun(null);
      return;
    }
    let cancelled = false;
    setDetailLoading(true);
    api.diagnostics
      .getRun(selectedRunId)
      .then((response) => {
        if (!cancelled) {
          setSelectedRun(response.run);
        }
      })
      .catch((detailError) => {
        if (!cancelled) {
          setSelectedRun(null);
          toast.error(
            detailError instanceof Error
              ? detailError.message
              : "Failed to load diagnostic run"
          );
        }
      })
      .finally(() => {
        if (!cancelled) {
          setDetailLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [selectedRunId]);

  const capabilities = runsState.capabilities.length
    ? runsState.capabilities
    : (summary?.capabilities ?? []);
  const hasNext = (runsState.page + 1) * runsState.pageSize < runsState.total;

  async function cleanupRuns() {
    try {
      const result = await api.diagnostics.cleanup(Number(retentionDays));
      toast.success(`Removed ${result.removed} diagnostic runs`);
      await loadSummaryAndRuns();
    } catch (cleanupError) {
      toast.error(
        cleanupError instanceof Error
          ? cleanupError.message
          : "Failed to clean up diagnostics"
      );
    }
  }

  function exportFilteredRuns() {
    downloadJson("diagnostics-filtered-runs.json", {
      exportedAt: new Date().toISOString(),
      filters: query,
      runs: runsState.runs,
      summary,
      total: runsState.total,
    });
  }

  function exportSelectedRun() {
    if (!selectedRun) {
      return;
    }
    downloadJson(`diagnostic-run-${selectedRun.runId}.json`, {
      exportedAt: new Date().toISOString(),
      run: selectedRun,
    });
  }

  return (
    <KeeperHubTraceProvider>
      <main className="pointer-events-auto h-dvh overflow-y-auto bg-background px-4 pt-6 pb-[calc(1.5rem+var(--trace-widget-docked-offset,0px))] md:px-8">
        <div className="mx-auto flex min-h-full max-w-7xl flex-col gap-6">
          <div className="flex shrink-0 flex-wrap items-end justify-between gap-4">
            <div>
              <h1 className="font-semibold text-3xl tracking-tight">
                Diagnostics
              </h1>
              <p className="mt-2 max-w-2xl text-muted-foreground text-sm">
                Inspect persisted workflow traces without replacing the existing
                workflow run logs.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button
                onClick={() => {
                  loadSummaryAndRuns().catch((loadError: unknown) => {
                    toast.error(
                      loadError instanceof Error
                        ? loadError.message
                        : "Failed to refresh diagnostics"
                    );
                  });
                }}
                variant="outline"
              >
                <RefreshCw className="mr-2 h-4 w-4" /> Refresh
              </Button>
              <Button onClick={exportFilteredRuns} variant="outline">
                <Download className="mr-2 h-4 w-4" /> Export filtered
              </Button>
              <Button
                disabled={!selectedRun}
                onClick={exportSelectedRun}
                variant="outline"
              >
                <Download className="mr-2 h-4 w-4" /> Export run
              </Button>
            </div>
          </div>

          <div className="grid shrink-0 gap-3 md:grid-cols-4">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">Stored runs</CardTitle>
              </CardHeader>
              <CardContent className="font-semibold text-2xl">
                {summary?.totalRuns ?? "-"}
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">Stored spans</CardTitle>
              </CardHeader>
              <CardContent className="font-semibold text-2xl">
                {summary?.totalSpans ?? "-"}
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">Stored events</CardTitle>
              </CardHeader>
              <CardContent className="font-semibold text-2xl">
                {summary?.totalEvents ?? "-"}
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">Footprint</CardTitle>
              </CardHeader>
              <CardContent className="font-semibold text-2xl">
                {formatBytes(summary?.approximateFootprintBytes)}
              </CardContent>
            </Card>
          </div>

          <Card className="shrink-0">
            <CardContent className="grid gap-3 pt-6 md:grid-cols-[minmax(0,1fr)_160px_180px_140px_auto]">
              <Input
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search run, trace, capability"
                value={search}
              />
              <Select onValueChange={setStatusFilter} value={statusFilter}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All statuses</SelectItem>
                  <SelectItem value="running">Running</SelectItem>
                  <SelectItem value="success">Success</SelectItem>
                  <SelectItem value="error">Error</SelectItem>
                </SelectContent>
              </Select>
              <Select
                onValueChange={setCapabilityFilter}
                value={capabilityFilter}
              >
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Capability" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All capabilities</SelectItem>
                  {capabilities.map((capability) => (
                    <SelectItem key={capability} value={capability}>
                      {capability}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select onValueChange={setRetentionDays} value={retentionDays}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Retention" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="7">7 days</SelectItem>
                  <SelectItem value="30">30 days</SelectItem>
                  <SelectItem value="90">90 days</SelectItem>
                </SelectContent>
              </Select>
              <Button
                onClick={() => {
                  cleanupRuns().catch((cleanupError: unknown) => {
                    toast.error(
                      cleanupError instanceof Error
                        ? cleanupError.message
                        : "Failed to clean up diagnostics"
                    );
                  });
                }}
                variant="outline"
              >
                <Trash2 className="mr-2 h-4 w-4" /> Cleanup
              </Button>
            </CardContent>
          </Card>

          {error ? (
            <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-4 text-destructive text-sm">
              {error}
            </div>
          ) : null}

          <div className="grid min-h-0 items-start gap-4 lg:grid-cols-[380px_minmax(0,1fr)]">
            <Card className="max-h-[calc(100dvh-18rem)] min-h-80 gap-4 overflow-hidden">
              <CardHeader className="shrink-0">
                <CardTitle>Recent runs</CardTitle>
              </CardHeader>
              <CardContent
                className={cn(
                  "min-h-0 flex-1 space-y-3 overflow-y-auto pr-3",
                  TRACE_SCROLLBAR_CLASS
                )}
              >
                {loading ? (
                  <div className="py-8 text-center text-muted-foreground text-sm">
                    Loading runs.
                  </div>
                ) : null}
                {!loading && runsState.runs.length === 0 ? (
                  <div className="rounded-lg border border-dashed p-6 text-center text-muted-foreground text-sm">
                    No diagnostic runs match these filters.
                  </div>
                ) : null}
                {runsState.runs.map((run) => (
                  <button
                    className={cn(
                      "w-full rounded-lg border p-3 text-left transition hover:bg-muted/40",
                      selectedRunId === run.runId &&
                        "border-primary bg-primary/5"
                    )}
                    key={run.runId}
                    onClick={() =>
                      startTransition(() => setSelectedRunId(run.runId))
                    }
                    type="button"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="truncate font-medium text-sm">
                          {run.runId}
                        </div>
                        <div className="mt-1 text-muted-foreground text-xs">
                          {runStartedAt(run)}
                        </div>
                      </div>
                      <Badge
                        className={statusTone(run.status)}
                        variant="outline"
                      >
                        {run.status}
                      </Badge>
                    </div>
                    <div className="mt-2 text-muted-foreground text-xs">
                      {run.capability || "unknown"} · {run.spanCount} spans ·{" "}
                      {run.eventCount} events
                    </div>
                  </button>
                ))}
                <div className="flex items-center justify-between pt-2">
                  <Button
                    disabled={page === 0}
                    onClick={() => setPage((value) => Math.max(0, value - 1))}
                    size="sm"
                    variant="outline"
                  >
                    Newer
                  </Button>
                  <span className="text-muted-foreground text-xs">
                    Page {page + 1}
                  </span>
                  <Button
                    disabled={!hasNext}
                    onClick={() => setPage((value) => value + 1)}
                    size="sm"
                    variant="outline"
                  >
                    Older
                  </Button>
                </div>
              </CardContent>
            </Card>

            <LiveTraceInspector
              onSelectedSpanChange={setSelectedSpanId}
              run={selectedRun}
              runId={selectedRunId}
              selectedSpanId={selectedSpanId}
              streamUrl={
                selectedRunId
                  ? `/api/diagnostics/runs/${encodeURIComponent(selectedRunId)}/stream`
                  : null
              }
            />
            {detailLoading ? (
              <div className="text-muted-foreground text-sm">
                Refreshing selected trace.
              </div>
            ) : null}
          </div>
        </div>
      </main>
    </KeeperHubTraceProvider>
  );
}
