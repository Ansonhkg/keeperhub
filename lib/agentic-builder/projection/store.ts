import { atom } from "jotai";
import type {
  BuilderProjectionHighlight,
  BuilderProjection,
  BuilderProjectionIssue,
  BuilderProjectionQuestion,
  WorkflowGraph,
} from "./contracts";
import { materializeBuilderProjection } from "@/lib/agentic-builder/materialization/materializer";
import { projectWorkflowGraph } from "./graph";
import {
  autosaveAtom,
  edgesAtom,
  hasUnsavedChangesAtom,
  nodesAtom,
} from "@/lib/workflow/store";

export const builderProjectionAtom = atom<BuilderProjection | null>(null);
export const builderProjectionHighlightAtom = atom<BuilderProjectionHighlight>({});

export const renderedWorkflowGraphAtom = atom<WorkflowGraph>((get) =>
  projectWorkflowGraph(
    { nodes: get(nodesAtom), edges: get(edgesAtom) },
    get(builderProjectionAtom),
    get(builderProjectionHighlightAtom)
  )
);

export const renderedWorkflowNodesAtom = atom(
  (get) => get(renderedWorkflowGraphAtom).nodes
);

export const renderedWorkflowEdgesAtom = atom(
  (get) => get(renderedWorkflowGraphAtom).edges
);

export const setBuilderProjectionAtom = atom(
  null,
  (_get, set, projection: BuilderProjection) => {
    set(builderProjectionAtom, projection);
    set(builderProjectionHighlightAtom, {});
  }
);

export const clearBuilderProjectionAtom = atom(null, (_get, set) => {
  set(builderProjectionAtom, null);
  set(builderProjectionHighlightAtom, {});
});

export const setBuilderProjectionHighlightAtom = atom(
  null,
  (_get, set, highlight: BuilderProjectionHighlight) => {
    set(builderProjectionHighlightAtom, highlight);
  }
);

export const clearBuilderProjectionHighlightAtom = atom(null, (_get, set) => {
  set(builderProjectionHighlightAtom, {});
});

export const answerBuilderProjectionQuestionAtom = atom(
  null,
  (get, set, input: { questionId: string; answer: string }) => {
    const projection = get(builderProjectionAtom);
    if (!projection) {
      return;
    }

    set(builderProjectionAtom, {
      ...projection,
      questions: projection.questions.map((question) =>
        question.id === input.questionId
          ? { ...question, answer: input.answer }
          : question
      ),
    });
  }
);

export const selectBuilderProjectionOptionAtom = atom(
  null,
  (get, set, optionId: string) => {
    const projection = get(builderProjectionAtom);
    if (!projection) {
      return;
    }

    set(builderProjectionAtom, {
      ...projection,
      selectedOptionId: optionId,
      status: "accepted",
    });
    set(builderProjectionHighlightAtom, {});
  }
);

export const commitBuilderProjectionOptionAtom = atom(
  null,
  (get, set, optionId: string) => {
    const projection = get(builderProjectionAtom);
    if (!projection) {
      return;
    }

    const result = materializeBuilderProjection({
      projection: {
        ...projection,
        selectedOptionId: optionId,
        status: "accepted",
      },
      realGraph: {
        nodes: get(nodesAtom),
        edges: get(edgesAtom),
      },
      optionId,
    });

    if (!result.validation.valid) {
      set(builderProjectionAtom, {
        ...projection,
        selectedOptionId: optionId,
        status: "invalid",
        validationIssues: result.validation.issues.map(toProjectionIssue),
      });
      set(builderProjectionHighlightAtom, {});
      return;
    }

    set(nodesAtom, result.graph.nodes);
    set(edgesAtom, result.graph.edges);
    set(builderProjectionAtom, null);
    set(builderProjectionHighlightAtom, {});
    set(hasUnsavedChangesAtom, true);
    set(autosaveAtom, { immediate: true });
  }
);

export const rejectBuilderProjectionOptionAtom = atom(
  null,
  (get, set, optionId: string) => {
    const projection = get(builderProjectionAtom);
    if (!projection) {
      return;
    }

    set(builderProjectionAtom, {
      ...projection,
      rejectedOptionIds: appendUnique(projection.rejectedOptionIds, optionId),
      branches: projection.branches.filter((branch) => branch.optionId !== optionId),
      status: "rejected",
    });
    set(builderProjectionHighlightAtom, {});
  }
);

function appendUnique(values: string[], value: string): string[] {
  return values.includes(value) ? values : [...values, value];
}

function toProjectionIssue(issue: {
  id: string;
  severity: "info" | "warning" | "error";
  message: string;
  requirementIds?: string[];
}): BuilderProjectionIssue {
  return {
    id: issue.id,
    severity: issue.severity,
    message: issue.message,
    requirementIds: issue.requirementIds,
  };
}

export function questionsFromProjection(
  projection: BuilderProjection
): BuilderProjectionQuestion[] {
  return projection.questions;
}
