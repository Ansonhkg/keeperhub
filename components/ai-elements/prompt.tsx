"use client";

import { useReactFlow } from "@xyflow/react";
import { useAtom, useAtomValue, useSetAtom } from "jotai";
import { ArrowUp, Trash2 } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Shimmer } from "@/components/ai-elements/shimmer";
import {
  DecisionTray,
  type PlanningStatusItem,
} from "@/components/agentic-builder/decision-tray";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { api } from "@/lib/api-client";
import {
  filterBuilderPreviewGraph,
  isBuilderPreviewEdge,
  projectBuilderToCanvas,
} from "@/lib/agentic-builder/canvas-projection";
import {
  builderProjectionStateAtom,
  clearBuilderProjectionAtom,
  setBuilderProjectionForWorkflowAtom,
} from "@/lib/agentic-builder/store";
import {
  hasBuilderWorkflowContext,
  workflowContextNodesForBuilder,
} from "@/lib/agentic-builder/workflow-context";
import {
  materializeBuilderProjectionToRuntime,
  type RuntimeMaterializedWorkflowGraph,
} from "@/lib/agentic-builder/runtime-materializer";
import { getRuntimeReadinessIssues } from "@/lib/agentic-builder/runtime-readiness";
import { dedupeEdges } from "@/lib/workflow/edge-helpers";
import {
  currentWorkflowNameAtom,
  edgesAtom,
  isGeneratingAtom,
  nodesAtom,
} from "@/lib/workflow-store";
import type { BuilderProjection } from "@keeperhub/agentic-builder/schemas";

const PROMPT_HISTORY_STORAGE_KEY = "keeperhub.workflowPromptHistory";
const MAX_PROMPT_HISTORY_ITEMS = 50;

type AIPromptProps = {
  workflowId?: string;
};

function hasUnresolvedBuilderWork(projection: BuilderProjection): boolean {
  return (
    projection.candidateBranches.some((branch) => branch.status === "open") ||
    projection.questions.some((question) => question.status === "open") ||
    projection.validation.issues.some((issue) => issue.severity === "error")
  );
}

type BuilderSessionStreamEvent =
  | {
      detail?: string;
      label: string;
      stage: string;
      status: "running" | "completed";
      type: "status";
    }
  | { projection: BuilderProjection; type: "projection" }
  | { error: string; type: "error" };

async function builderResponseError(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { error?: unknown };
    return typeof body.error === "string"
      ? body.error
      : "Builder action failed";
  } catch {
    return "Builder action failed";
  }
}

function parseBuilderStreamMessage(message: string): BuilderSessionStreamEvent | null {
  const data = message
    .split("\n")
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice("data:".length).trim())
    .join("\n");

  if (!data) {
    return null;
  }

  return JSON.parse(data) as BuilderSessionStreamEvent;
}

function upsertPlanningStatus(
  items: readonly PlanningStatusItem[],
  event: Extract<BuilderSessionStreamEvent, { type: "status" }>
): PlanningStatusItem[] {
  const nextItem: PlanningStatusItem = {
    detail: event.detail,
    id: event.stage,
    label: event.label,
    status: event.status,
  };
  const existingIndex = items.findIndex((item) => item.id === event.stage);
  if (existingIndex === -1) {
    return [...items, nextItem].slice(-6);
  }
  return items.map((item, index) =>
    index === existingIndex ? nextItem : item
  );
}

const FALLBACK_PLANNING_STATUSES: readonly PlanningStatusItem[] = [
  {
    id: "fallback-intent",
    label: "Decomposing the prompt into requirements",
    status: "running",
  },
  {
    id: "fallback-requirements",
    label: "Checking which requirements are satisfied or unresolved",
    status: "running",
  },
  {
    id: "fallback-catalog",
    label: "Searching native and custom node catalogs",
    status: "running",
  },
  {
    id: "fallback-evaluation",
    label: "Evaluating candidates against the requirements",
    status: "running",
  },
  {
    id: "fallback-preview",
    label: "Projecting preview branches onto the canvas",
    status: "running",
  },
];

function advanceFallbackPlanningStatus(
  items: readonly PlanningStatusItem[]
): PlanningStatusItem[] {
  const fallbackCount = items.filter((item) =>
    item.id.startsWith("fallback-")
  ).length;
  const nextStatus = FALLBACK_PLANNING_STATUSES[fallbackCount];
  if (!nextStatus) {
    return [...items];
  }

  return [
    ...items.map((item) =>
      item.status === "running" ? { ...item, status: "completed" as const } : item
    ),
    nextStatus,
  ].slice(-6);
}

async function readBuilderSessionStream(
  response: Response,
  onStatus: (
    event: Extract<BuilderSessionStreamEvent, { type: "status" }>
  ) => void
): Promise<BuilderProjection> {
  if (!response.body) {
    throw new Error("Builder stream did not include a response body");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (value) {
      buffer += decoder.decode(value, { stream: !done });
      const messages = buffer.split("\n\n");
      buffer = messages.pop() ?? "";

      for (const message of messages) {
        const event = parseBuilderStreamMessage(message);
        if (!event) {
          continue;
        }
        if (event.type === "status") {
          onStatus(event);
        } else if (event.type === "projection") {
          return event.projection;
        } else {
          throw new Error(event.error);
        }
      }
    }

    if (done) {
      break;
    }
  }

  throw new Error("Builder stream ended before returning decisions");
}

export function AIPrompt({ workflowId }: AIPromptProps) {
  const [isGenerating, setIsGenerating] = useAtom(isGeneratingAtom);
  const [prompt, setPrompt] = useState("");
  const [promptHistory, setPromptHistory] = useState<string[]>([]);
  const [historyIndex, setHistoryIndex] = useState<number | null>(null);
  const builderProjectionState = useAtomValue(builderProjectionStateAtom);
  const setBuilderProjectionForWorkflow = useSetAtom(
    setBuilderProjectionForWorkflowAtom
  );
  const clearBuilderProjection = useSetAtom(clearBuilderProjectionAtom);
  const [highlightedOptionId, setHighlightedOptionId] = useState<string | null>(
    null
  );
  const [pendingBuilderActionId, setPendingBuilderActionId] = useState<
    string | null
  >(null);
  const [planningStatusItems, setPlanningStatusItems] = useState<
    PlanningStatusItem[]
  >([]);
  const [previewFitRequest, setPreviewFitRequest] = useState(0);
  const [isExpanded, setIsExpanded] = useState(false);
  const [isFocused, setIsFocused] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const historyDraftRef = useRef("");
  const nodes = useAtomValue(nodesAtom);
  const [edges, setEdges] = useAtom(edgesAtom);
  const setNodes = useSetAtom(nodesAtom);
  const currentWorkflowName = useAtomValue(currentWorkflowNameAtom);
  const { fitView } = useReactFlow();
  const lastProjectedBuilderProjectionRef = useRef<BuilderProjection | null>(
    null
  );
  const builderSourceTextRef = useRef<string | undefined>(undefined);
  const builderProjection =
    workflowId && builderProjectionState.workflowId === workflowId
      ? builderProjectionState.projection
      : null;

  const setActiveBuilderProjection = useCallback(
    (projection: BuilderProjection | null) => {
      setBuilderProjectionForWorkflow({
        projection,
        workflowId: workflowId ?? null,
      });
    },
    [setBuilderProjectionForWorkflow, workflowId]
  );

  const resizePromptInput = useCallback(() => {
    window.requestAnimationFrame(() => {
      if (!inputRef.current) {
        return;
      }
      inputRef.current.style.height = "auto";
      inputRef.current.style.height = `${inputRef.current.scrollHeight}px`;
    });
  }, []);

  const savePromptHistory = useCallback((history: string[]) => {
    setPromptHistory(history);
    try {
      localStorage.setItem(PROMPT_HISTORY_STORAGE_KEY, JSON.stringify(history));
    } catch {
      toast.error("Failed to save prompt history");
    }
  }, []);

  const persistCommittedProjection = useCallback(
    async (
      projection: BuilderProjection
    ): Promise<RuntimeMaterializedWorkflowGraph | null> => {
      if (!workflowId) {
        return null;
      }

      const committedGraph = materializeBuilderProjectionToRuntime(projection, {
        sourceText: builderSourceTextRef.current,
      });
      const readinessIssues = getRuntimeReadinessIssues(committedGraph);
      if (readinessIssues.length > 0) {
        const firstIssue = readinessIssues[0];
        throw new Error(
          firstIssue
            ? `${firstIssue.nodeLabel}: ${firstIssue.message}`
            : "Builder workflow is not ready to persist"
        );
      }
      const finalEdges = dedupeEdges(
        committedGraph.edges.map((edge) => ({
          ...edge,
          type: "animated",
        }))
      );

      await api.workflow.update(workflowId, {
        edges: finalEdges,
        nodes: committedGraph.nodes,
      });
      return {
        edges: finalEdges,
        nodes: committedGraph.nodes,
      };
    },
    [workflowId]
  );

  const applyBuilderActionProjection = useCallback(
    async (projection: BuilderProjection) => {
      if (hasUnresolvedBuilderWork(projection)) {
        setActiveBuilderProjection(projection);
        setHighlightedOptionId(null);
        return;
      }

      const committedGraph = await persistCommittedProjection(projection);
      if (!committedGraph) {
        return;
      }
      setNodes(committedGraph.nodes);
      setEdges(committedGraph.edges);
      setHighlightedOptionId(null);
      setActiveBuilderProjection(null);
    },
    [persistCommittedProjection, setActiveBuilderProjection, setEdges, setNodes]
  );

  const contextNodes = workflowContextNodesForBuilder(nodes);
  const hasWorkflowContext = hasBuilderWorkflowContext(nodes);

  useEffect(() => {
    setHighlightedOptionId(null);
    setPendingBuilderActionId(null);
    setPlanningStatusItems([]);
    setPreviewFitRequest(0);
    setPrompt("");
    setHistoryIndex(null);
    historyDraftRef.current = "";
    builderSourceTextRef.current = undefined;
  }, [workflowId]);

  useEffect(() => {
    if (
      builderProjectionState.projection &&
      builderProjectionState.workflowId !== workflowId
    ) {
      clearBuilderProjection();
    }
  }, [
    builderProjectionState.projection,
    builderProjectionState.workflowId,
    clearBuilderProjection,
    workflowId,
  ]);

  useEffect(() => {
    if (!builderProjection) {
      return;
    }

    const projected = projectBuilderToCanvas(builderProjection, {
      highlightedOptionId,
      sourceText: builderSourceTextRef.current,
    });
    setNodes(projected.nodes);
    setEdges(projected.edges);
    const shouldFitView =
      lastProjectedBuilderProjectionRef.current !== builderProjection ||
      previewFitRequest > 0;
    lastProjectedBuilderProjectionRef.current = builderProjection;
    if (shouldFitView) {
      window.requestAnimationFrame(() => {
        fitView({ maxZoom: 1, minZoom: 0.1, padding: 0.25, duration: 300 });
      });
    }
  }, [
    builderProjection,
    highlightedOptionId,
    previewFitRequest,
    setNodes,
    setEdges,
    fitView,
  ]);

  const pinBuilderPreview = useCallback((optionId: string) => {
    setHighlightedOptionId(optionId);
    setPreviewFitRequest((current) => current + 1);
  }, []);

  // Focus input when Cmd/Ctrl + K is pressed
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        inputRef.current?.focus();
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, []);

  useEffect(() => {
    try {
      const storedHistory = localStorage.getItem(PROMPT_HISTORY_STORAGE_KEY);
      if (!storedHistory) {
        return;
      }
      const parsedHistory: unknown = JSON.parse(storedHistory);
      if (Array.isArray(parsedHistory)) {
        setPromptHistory(
          parsedHistory
            .filter((item): item is string => typeof item === "string")
            .slice(-MAX_PROMPT_HISTORY_ITEMS)
        );
      }
    } catch {
      setPromptHistory([]);
    }
  }, []);

  const addPromptToHistory = useCallback(
    (submittedPrompt: string) => {
      savePromptHistory(
        promptHistory.at(-1) === submittedPrompt
          ? promptHistory
          : [...promptHistory, submittedPrompt].slice(-MAX_PROMPT_HISTORY_ITEMS)
      );
      setHistoryIndex(null);
      historyDraftRef.current = "";
    },
    [promptHistory, savePromptHistory]
  );

  const handlePromptHistoryKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (promptHistory.length === 0 || e.altKey || e.ctrlKey || e.metaKey) {
        return;
      }

      if (e.key === "ArrowUp") {
        e.preventDefault();
        const nextIndex =
          historyIndex === null
            ? promptHistory.length - 1
            : Math.max(0, historyIndex - 1);
        if (historyIndex === null) {
          historyDraftRef.current = prompt;
        }
        setHistoryIndex(nextIndex);
        setPrompt(promptHistory[nextIndex]);
        resizePromptInput();
        return;
      }

      if (e.key === "ArrowDown" && historyIndex !== null) {
        e.preventDefault();
        if (historyIndex < promptHistory.length - 1) {
          const nextIndex = historyIndex + 1;
          setHistoryIndex(nextIndex);
          setPrompt(promptHistory[nextIndex]);
        } else {
          setHistoryIndex(null);
          setPrompt(historyDraftRef.current);
          historyDraftRef.current = "";
        }
        resizePromptInput();
      }
    },
    [historyIndex, prompt, promptHistory, resizePromptInput]
  );

  const clearPromptHistory = useCallback(() => {
    savePromptHistory([]);
    setHistoryIndex(null);
    historyDraftRef.current = "";
    toast.success("History cleared");
    inputRef.current?.focus();
  }, [savePromptHistory]);

  const handleFocus = () => {
    setIsExpanded(true);
    setIsFocused(true);
  };

  const handleBlur = (e: React.FocusEvent) => {
    // Don't collapse if focus is moving to another element within the container
    if (containerRef.current?.contains(e.relatedTarget as Node)) {
      return;
    }
    setIsFocused(false);
    if (!prompt.trim()) {
      setIsExpanded(false);
    }
  };

  const handleGenerate = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();

      if (!prompt.trim() || isGenerating) {
        return;
      }

      const submittedPrompt = prompt.trim();
      addPromptToHistory(submittedPrompt);
      setIsGenerating(true);
      setPlanningStatusItems([
        {
          id: "request",
          label: "Sending prompt to the builder",
          status: "running",
        },
      ]);
      let receivedServerStatus = false;
      const fallbackStatusTimer = window.setInterval(() => {
        if (receivedServerStatus) {
          return;
        }
        setPlanningStatusItems(advanceFallbackPlanningStatus);
      }, 2500);

      try {
        // Send existing workflow data for context when modifying
        const existingWorkflow = hasWorkflowContext
          ? {
              edges: edges.filter((edge) => !isBuilderPreviewEdge(edge)),
              name: currentWorkflowName,
              nodes: contextNodes,
            }
          : undefined;

        console.log("[AI Prompt] Generating workflow");
        console.log("[AI Prompt] Has workflow context:", hasWorkflowContext);
        console.log("[AI Prompt] Sending existing workflow:", !!existingWorkflow);
        if (existingWorkflow) {
          console.log(
            "[AI Prompt] Existing workflow:",
            existingWorkflow.nodes.length,
            "nodes,",
            existingWorkflow.edges.length,
            "edges"
          );
        }

        const response = await fetch("/api/builder/sessions/stream", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            context: existingWorkflow ? JSON.stringify(existingWorkflow) : undefined,
            prompt: submittedPrompt,
          }),
        });
        if (!response.ok) {
          throw new Error(await response.text());
        }
        const projection = await readBuilderSessionStream(response, (event) => {
          const shouldReplaceFallback = !receivedServerStatus;
          receivedServerStatus = true;
          window.clearInterval(fallbackStatusTimer);
          setPlanningStatusItems((current) =>
            upsertPlanningStatus(shouldReplaceFallback ? [] : current, event)
          );
        });
        setActiveBuilderProjection(projection);
        builderSourceTextRef.current = submittedPrompt;
        setHighlightedOptionId(null);

        console.log("[AI Prompt] Received builder projection");
        console.log("[AI Prompt] Session:", projection.sessionId);
        console.log("[AI Prompt] Options:", projection.options.length);
        console.log("[AI Prompt] Questions:", projection.questions.length);

        // The builder projection is preview state. Persist only after the user
        // accepts an option, rejects an option, or answers an inline question.
        setPrompt("");
        setIsExpanded(false);
        setIsFocused(false);
        inputRef.current?.blur();
      } catch (error) {
        console.error("Failed to generate workflow:", error);
        window.dispatchEvent(
          new CustomEvent("keeperhub:trace-error", {
            detail: {
              attributes: {
                prompt,
                workflowId,
              },
              errorName: error instanceof Error ? error.name : "WorkflowPromptError",
              label: "AI workflow generation failed",
              message:
                error instanceof Error
                  ? error.message
                  : "Failed to generate workflow",
              step: "ai.workflow-prompt.generate",
            },
          })
        );
        toast.error("Failed to generate workflow");
      } finally {
        window.clearInterval(fallbackStatusTimer);
        setIsGenerating(false);
      }
    },
    [
      prompt,
      addPromptToHistory,
      isGenerating,
      workflowId,
      hasWorkflowContext,
      nodes,
      edges,
      setIsGenerating,
      setNodes,
      setEdges,
      fitView,
      currentWorkflowName,
      contextNodes,
      setActiveBuilderProjection,
    ]
  );

  const selectBuilderOption = useCallback(
    async (optionId: string) => {
      if (!builderProjection || pendingBuilderActionId) {
        return;
      }
      setPendingBuilderActionId(`select:${optionId}`);
      try {
        const response = await fetch(
          `/api/builder/sessions/${builderProjection.sessionId}/options/${encodeURIComponent(optionId)}/select`,
          {
            body: JSON.stringify({}),
            headers: { "Content-Type": "application/json" },
            method: "POST",
          }
        );
        if (!response.ok) {
          toast.error(await builderResponseError(response));
          return;
        }
        const nextProjection = (await response.json()) as BuilderProjection;
        await applyBuilderActionProjection(nextProjection);
        toast.success("Selected option");
      } catch (error) {
        toast.error(
          error instanceof Error ? error.message : "Builder action failed"
        );
      } finally {
        setPendingBuilderActionId(null);
      }
    },
    [
      builderProjection,
      applyBuilderActionProjection,
      pendingBuilderActionId,
    ]
  );

  const rejectBuilderOption = useCallback(
    async (optionId: string) => {
      if (!builderProjection || pendingBuilderActionId) {
        return;
      }
      setPendingBuilderActionId(`reject:${optionId}`);
      try {
        const response = await fetch(
          `/api/builder/sessions/${builderProjection.sessionId}/options/${encodeURIComponent(optionId)}/reject`,
          { method: "POST", headers: { "Content-Type": "application/json" } }
        );
        if (!response.ok) {
          toast.error(await builderResponseError(response));
          return;
        }
        const nextProjection = (await response.json()) as BuilderProjection;
        await applyBuilderActionProjection(nextProjection);
        toast.success("Rejected option");
      } catch (error) {
        toast.error(
          error instanceof Error ? error.message : "Builder action failed"
        );
      } finally {
        setPendingBuilderActionId(null);
      }
    },
    [
      builderProjection,
      applyBuilderActionProjection,
      pendingBuilderActionId,
    ]
  );

  const answerBuilderQuestion = useCallback(
    async (questionId: string, answer: string) => {
      if (!builderProjection || pendingBuilderActionId) {
        return;
      }
      setPendingBuilderActionId(`answer:${questionId}:${answer}`);
      try {
        const response = await fetch(
          `/api/builder/sessions/${builderProjection.sessionId}/questions/${questionId}/answer`,
          {
            body: JSON.stringify({ answer }),
            headers: { "Content-Type": "application/json" },
            method: "POST",
          }
        );
        if (!response.ok) {
          toast.error(await builderResponseError(response));
          return;
        }
        const nextProjection = (await response.json()) as BuilderProjection;
        if (questionId === "question-webhook-url") {
          builderSourceTextRef.current = [
            builderSourceTextRef.current,
            `Webhook URL: ${answer}`,
          ]
            .filter(Boolean)
            .join("\n\n");
        }
        await applyBuilderActionProjection(nextProjection);
      } catch (error) {
        toast.error(
          error instanceof Error ? error.message : "Builder action failed"
        );
      } finally {
        setPendingBuilderActionId(null);
      }
    },
    [
      builderProjection,
      applyBuilderActionProjection,
      pendingBuilderActionId,
    ]
  );

  const requestNativeCapability = useCallback(async () => {
    if (!builderProjection) {
      return;
    }
    const response = await fetch(
      `/api/builder/sessions/${builderProjection.sessionId}/feature-requests`,
      {
        body: JSON.stringify({
          context: { source: "builder-ui" },
          expectedInputs: ["capability input"],
          expectedOutputs: ["capability output"],
          id: `missing-${builderProjection.sessionId}`,
          originalIntent: "Request missing native capability from builder UI",
        }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      }
    );
    if (response.ok) {
      setActiveBuilderProjection((await response.json()) as BuilderProjection);
      toast.success("Native capability request recorded");
    }
  }, [builderProjection, setActiveBuilderProjection]);

  return (
    <>
      {/* Always visible prompt input */}
      <div
        ref={containerRef}
        className="pointer-events-none absolute bottom-[calc(1rem+var(--trace-widget-docked-offset,0px))] left-1/2 z-10 -translate-x-1/2 px-4"
        style={{
          width:
            isExpanded || builderProjection ? "min(100%, 48rem)" : "20rem",
          transition: "width 150ms ease-out",
        }}
      >
        <DecisionTray
          isPlanning={isGenerating}
          onAnswerQuestion={answerBuilderQuestion}
          onPreviewFocus={setHighlightedOptionId}
          onPreviewPin={pinBuilderPreview}
          onReject={rejectBuilderOption}
          onRequestNativeCapability={requestNativeCapability}
          onSelect={selectBuilderOption}
          pendingActionId={pendingBuilderActionId}
          planningStatusItems={planningStatusItems}
          projection={builderProjection}
        />
        <form
          aria-busy={isGenerating}
          aria-label="KeeperHub workflow prompt"
          className="pointer-events-auto relative flex cursor-text items-center gap-2 rounded-lg border bg-background py-2 pr-2 pl-3 shadow-lg"
          onClick={(e) => {
            // Focus textarea when clicking anywhere in the form (including padding)
            if (e.target === e.currentTarget || (e.target as HTMLElement).tagName !== 'BUTTON') {
              inputRef.current?.focus();
            }
          }}
          onMouseDown={(e) => {
            // Prevent textarea from losing focus when clicking form padding
            if (e.target === e.currentTarget) {
              e.preventDefault();
            }
          }}
          onSubmit={handleGenerate}
          role="search"
        >
          {isGenerating && prompt ? (
            <Shimmer className="flex-1 text-sm whitespace-pre-wrap" duration={2}>
              {prompt}
            </Shimmer>
          ) : (
            <textarea
              aria-label="Describe your workflow"
              className="flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground resize-none h-[22px] min-h-[22px] max-h-[200px] py-0 leading-[22px]"
              disabled={isGenerating}
              onBlur={handleBlur}
              onChange={(e) => {
                setPrompt(e.target.value);
                setHistoryIndex(null);
                historyDraftRef.current = e.target.value;
                e.target.style.height = 'auto';
                e.target.style.height = `${e.target.scrollHeight}px`;
              }}
              onFocus={handleFocus}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  e.currentTarget.form?.requestSubmit();
                } else if (e.key === 'Escape') {
                  e.preventDefault();
                  setPrompt("");
                  setIsExpanded(false);
                  setIsFocused(false);
                  inputRef.current?.blur();
                } else {
                  handlePromptHistoryKeyDown(e);
                }
              }}
              placeholder={isFocused ? "Describe the workflow plan..." : "Start planning..."}
              ref={inputRef}
              rows={1}
              value={prompt}
            />
          )}
          <div className="sr-only">
            {isGenerating ? "Generating workflow, please wait..." : ""}
          </div>
          <div className="flex shrink-0 items-end gap-1 self-end">
            <div className="relative size-8 shrink-0">
              <Button
                aria-label="Focus prompt input (⌘K)"
                className="absolute inset-0 h-8 px-0 text-xs text-muted-foreground hover:bg-transparent transition-[opacity,filter] ease-out"
                onClick={() => inputRef.current?.focus()}
                style={
                  !prompt.trim() && !isGenerating && !isFocused
                    ? { opacity: 1, filter: "blur(0px)", pointerEvents: "auto", visibility: "visible" }
                    : { opacity: 0, filter: "blur(2px)", pointerEvents: "none", visibility: "hidden" }
                }
                type="button"
                variant="ghost"
              >
                <kbd aria-hidden="true" className="pointer-events-none inline-flex h-5 select-none items-center gap-1 rounded border bg-muted px-1.5 font-mono text-[10px] font-medium text-muted-foreground opacity-100">
                  <span className="text-xs">⌘</span>K
                </kbd>
              </Button>
              <Button
                aria-label={isGenerating ? "Planning workflow..." : "Start planning"}
                className="size-8 transition-[opacity,filter] ease-out shrink-0"
                disabled={!prompt.trim() || isGenerating}
                size="sm"
                style={
                  !prompt.trim() && !isGenerating && !isFocused
                    ? { opacity: 0, filter: "blur(2px)", pointerEvents: "none", visibility: "hidden" }
                    : { opacity: 1, filter: "blur(0px)", pointerEvents: "auto", visibility: "visible" }
                }
                type="submit"
              >
                <ArrowUp aria-hidden="true" className="size-4" />
              </Button>
            </div>
            {promptHistory.length > 0 && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    aria-label="Clear prompt history"
                    className="size-8 text-muted-foreground transition-[opacity,filter] ease-out shrink-0"
                    onClick={clearPromptHistory}
                    size="sm"
                    type="button"
                    variant="ghost"
                  >
                    <Trash2 aria-hidden="true" className="size-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Clear prompt history</TooltipContent>
              </Tooltip>
            )}
          </div>
        </form>
      </div>
    </>
  );
}
