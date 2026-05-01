import { atom } from "jotai";
import type {
  BuilderProjection,
  BuilderProjectionQuestion,
  WorkflowGraph,
} from "./contracts";
import { projectWorkflowGraph } from "./graph";
import { edgesAtom, nodesAtom } from "@/lib/workflow/store";

export const builderProjectionAtom = atom<BuilderProjection | null>(null);

export const renderedWorkflowGraphAtom = atom<WorkflowGraph>((get) =>
  projectWorkflowGraph(
    { nodes: get(nodesAtom), edges: get(edgesAtom) },
    get(builderProjectionAtom)
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
  }
);

export const clearBuilderProjectionAtom = atom(null, (_get, set) => {
  set(builderProjectionAtom, null);
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
  }
);

function appendUnique(values: string[], value: string): string[] {
  return values.includes(value) ? values : [...values, value];
}

export function questionsFromProjection(
  projection: BuilderProjection
): BuilderProjectionQuestion[] {
  return projection.questions;
}
