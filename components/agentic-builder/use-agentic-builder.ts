"use client";

import type { BuilderProjection } from "@keeperhub/agentic-builder/schemas";
import { useReactFlow } from "@xyflow/react";
import { useAtom, useAtomValue, useSetAtom } from "jotai";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import type { PlanningStatusItem } from "@/components/agentic-builder/decision-tray";
import {
  isBuilderPreviewEdge,
  projectBuilderToCanvas,
} from "@/lib/agentic-builder/canvas-projection";
import {
  materializeBuilderProjectionToRuntime,
  type RuntimeMaterializedWorkflowGraph,
} from "@/lib/agentic-builder/runtime-materializer";
import { getRuntimeReadinessIssues } from "@/lib/agentic-builder/runtime-readiness";
import {
  builderProjectionStateAtom,
  clearBuilderProjectionAtom,
  setBuilderProjectionForWorkflowAtom,
} from "@/lib/agentic-builder/store";
import {
  hasBuilderWorkflowContext,
  workflowContextNodesForBuilder,
} from "@/lib/agentic-builder/workflow-context";
import { api } from "@/lib/api-client";
import { dedupeEdges } from "@/lib/workflow/edge-helpers";
import {
  currentWorkflowNameAtom,
  edgesAtom,
  isGeneratingAtom,
  nodesAtom,
} from "@/lib/workflow-store";

type UseAgenticBuilderInput = {
  readonly workflowId?: string;
};

type BuilderSessionStreamEvent =
  | {
      readonly detail?: string;
      readonly label: string;
      readonly stage: string;
      readonly status: "running" | "completed";
      readonly type: "status";
    }
  | { readonly projection: BuilderProjection; readonly type: "projection" }
  | { readonly error: string; readonly type: "error" };

function hasUnresolvedBuilderWork(projection: BuilderProjection): boolean {
  return (
    projection.candidateBranches.some((branch) => branch.status === "open") ||
    projection.questions.some((question) => question.status === "open") ||
    projection.validation.issues.some((issue) => issue.severity === "error")
  );
}

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

function parseBuilderStreamMessage(
  message: string
): BuilderSessionStreamEvent | null {
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
      item.status === "running"
        ? { ...item, status: "completed" as const }
        : item
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

export function useAgenticBuilder({ workflowId }: UseAgenticBuilderInput) {
  const [isGenerating, setIsGenerating] = useAtom(isGeneratingAtom);
  const builderProjectionState = useAtomValue(builderProjectionStateAtom);
  const setBuilderProjectionForWorkflow = useSetAtom(
    setBuilderProjectionForWorkflowAtom
  );
  const clearBuilderProjection = useSetAtom(clearBuilderProjectionAtom);
  const nodes = useAtomValue(nodesAtom);
  const [edges, setEdges] = useAtom(edgesAtom);
  const setNodes = useSetAtom(nodesAtom);
  const currentWorkflowName = useAtomValue(currentWorkflowNameAtom);
  const { fitView } = useReactFlow();
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
        fitView({ duration: 300, maxZoom: 1, minZoom: 0.1, padding: 0.25 });
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

  const startBuilderPlanning = useCallback(
    async (submittedPrompt: string) => {
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
        const existingWorkflow = hasWorkflowContext
          ? {
              edges: edges.filter((edge) => !isBuilderPreviewEdge(edge)),
              name: currentWorkflowName,
              nodes: contextNodes,
            }
          : undefined;

        const response = await fetch("/api/builder/sessions/stream", {
          body: JSON.stringify({
            context: existingWorkflow
              ? JSON.stringify(existingWorkflow)
              : undefined,
            prompt: submittedPrompt,
          }),
          headers: { "Content-Type": "application/json" },
          method: "POST",
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
      } finally {
        window.clearInterval(fallbackStatusTimer);
        setIsGenerating(false);
      }
    },
    [
      contextNodes,
      currentWorkflowName,
      edges,
      hasWorkflowContext,
      setActiveBuilderProjection,
      setIsGenerating,
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
    [applyBuilderActionProjection, builderProjection, pendingBuilderActionId]
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
          { headers: { "Content-Type": "application/json" }, method: "POST" }
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
    [applyBuilderActionProjection, builderProjection, pendingBuilderActionId]
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
    [applyBuilderActionProjection, builderProjection, pendingBuilderActionId]
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

  return {
    answerBuilderQuestion,
    builderProjection,
    highlightedOptionId,
    isGenerating,
    pendingBuilderActionId,
    pinBuilderPreview,
    planningStatusItems,
    rejectBuilderOption,
    requestNativeCapability,
    selectBuilderOption,
    setHighlightedOptionId,
    startBuilderPlanning,
  };
}
