export type DagBranchStatus = "open" | "rejected" | "selected" | "stale";

export type DagForkMode = "after_commit" | "replace_commit" | "from_commit";

export type DagRecord = Record<string, unknown>;

export type DagCommit<TPatch> = {
  readonly id: string;
  readonly parentIds: readonly string[];
  readonly patch: TPatch;
  readonly createdAt: string;
  readonly idempotencyKey?: string;
  readonly metadata?: DagRecord;
};

export type DagBranch<TPatch, TBranchMetadata> = {
  readonly id: string;
  readonly baseCommitId: string;
  readonly patch: TPatch;
  readonly metadata: TBranchMetadata;
  readonly status: DagBranchStatus;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly selectedCommitId?: string;
  readonly rejectionReason?: string;
  readonly staleReason?: string;
};

export type DagSession<TPatch, TBranchMetadata> = {
  readonly schemaVersion: 1;
  readonly id: string;
  readonly commits: readonly DagCommit<TPatch>[];
  readonly branches: readonly DagBranch<TPatch, TBranchMetadata>[];
  readonly headCommitId?: string;
  readonly revision: number;
};

export type AppendCommitInput<TPatch> = {
  readonly id: string;
  readonly parentIds: readonly string[];
  readonly patch: TPatch;
  readonly createdAt: string;
  readonly idempotencyKey?: string;
  readonly metadata?: DagRecord;
};

export type CreateBranchInput<TPatch, TBranchMetadata> = {
  readonly id: string;
  readonly baseCommitId: string;
  readonly patch: TPatch;
  readonly metadata: TBranchMetadata;
  readonly createdAt: string;
};

export type ForkFromCommitInput<TPatch> = {
  readonly id: string;
  readonly mode: DagForkMode;
  readonly commitId: string;
  readonly patch: TPatch;
  readonly createdAt: string;
  readonly idempotencyKey?: string;
  readonly metadata?: DagRecord;
};

export type ProjectionReducer<TState, TPatch> = (
  state: TState,
  patch: TPatch,
  commit: DagCommit<TPatch> | DagBranch<TPatch, unknown>
) => TState;
