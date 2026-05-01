import { requireBranch } from "./branch";
import { pathToCommit, pathToHead } from "./commit-graph";
import type { DagBranch, DagSession, ProjectionReducer } from "./types";

export function projectHead<TState, TPatch, TBranchMetadata>(
  session: DagSession<TPatch, TBranchMetadata>,
  initialState: TState,
  reducer: ProjectionReducer<TState, TPatch>,
  fromCommitId?: string
): TState {
  return pathToHead(session, fromCommitId).reduce(
    (state, commit) => reducer(state, commit.patch, commit),
    initialState
  );
}

export function projectBranch<TState, TPatch, TBranchMetadata>(
  session: DagSession<TPatch, TBranchMetadata>,
  branchId: string,
  initialState: TState,
  reducer: ProjectionReducer<TState, TPatch>
): TState {
  const branch = requireBranch(session, branchId);
  const committed = pathToCommit(session, branch.baseCommitId).reduce(
    (state, commit) => reducer(state, commit.patch, commit),
    initialState
  );
  return reducer(committed, branch.patch, branch as DagBranch<TPatch, unknown>);
}

export function orderedTimeline<TPatch, TBranchMetadata>(
  session: DagSession<TPatch, TBranchMetadata>
): readonly {
  readonly id: string;
  readonly kind: "commit" | "branch";
  readonly createdAt: string;
}[] {
  return [
    ...session.commits.map((commit) => ({
      id: commit.id,
      kind: "commit" as const,
      createdAt: commit.createdAt,
    })),
    ...session.branches.map((branch) => ({
      id: branch.id,
      kind: "branch" as const,
      createdAt: branch.createdAt,
    })),
  ].sort(
    (left, right) =>
      left.createdAt.localeCompare(right.createdAt) ||
      left.id.localeCompare(right.id)
  );
}
