import type { BuilderProjection } from "@keeperhub/agentic-builder/schemas";
import { atom } from "jotai";

type BuilderProjectionState = {
  projection: BuilderProjection | null;
  workflowId: string | null;
};

export const builderProjectionStateAtom = atom<BuilderProjectionState>({
  projection: null,
  workflowId: null,
});

export const builderProjectionAtom = atom(
  (get) => get(builderProjectionStateAtom).projection,
  (_get, set, projection: BuilderProjection | null) => {
    set(builderProjectionStateAtom, {
      projection,
      workflowId: null,
    });
  }
);

export const setBuilderProjectionForWorkflowAtom = atom(
  null,
  (
    _get,
    set,
    next: { projection: BuilderProjection | null; workflowId: string | null }
  ) => {
    set(builderProjectionStateAtom, next);
  }
);

export const clearBuilderProjectionAtom = atom(null, (_get, set) => {
  set(builderProjectionStateAtom, {
    projection: null,
    workflowId: null,
  });
});

export const regenerateBuilderNodeAtom = atom(
  null,
  async (get, set, nodeId: string) => {
    const state = get(builderProjectionStateAtom);
    const projection = state.projection;
    if (!projection) {
      return null;
    }

    const response = await fetch(
      `/api/builder/sessions/${projection.sessionId}/regenerate-from-node`,
      {
        body: JSON.stringify({ kind: "after_node", nodeId }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      }
    );
    if (!response.ok) {
      throw new Error(await response.text());
    }

    const nextProjection = (await response.json()) as BuilderProjection;
    set(builderProjectionStateAtom, {
      projection: nextProjection,
      workflowId: state.workflowId,
    });
    return nextProjection;
  }
);
