import type { AppendCommitInput, DagCommit, DagSession } from "./types";

export function findCommit<TPatch, TBranchMetadata>(
  session: DagSession<TPatch, TBranchMetadata>,
  commitId: string
): DagCommit<TPatch> | undefined {
  return session.commits.find((commit) => commit.id === commitId);
}

export function requireCommit<TPatch, TBranchMetadata>(
  session: DagSession<TPatch, TBranchMetadata>,
  commitId: string
): DagCommit<TPatch> {
  const commit = findCommit(session, commitId);
  if (!commit) {
    throw new Error(`Unknown commit: ${commitId}`);
  }
  return commit;
}

export function hasCommit<TPatch, TBranchMetadata>(
  session: DagSession<TPatch, TBranchMetadata>,
  commitId: string
): boolean {
  return findCommit(session, commitId) !== undefined;
}

export function createCommit<TPatch>(
  input: AppendCommitInput<TPatch>
): DagCommit<TPatch> {
  return {
    id: input.id,
    parentIds: [...input.parentIds],
    patch: input.patch,
    createdAt: input.createdAt,
    idempotencyKey: input.idempotencyKey,
    metadata: input.metadata,
  };
}

export function withCommit<TPatch, TBranchMetadata>(
  session: DagSession<TPatch, TBranchMetadata>,
  commit: DagCommit<TPatch>,
  headCommitId: string
): DagSession<TPatch, TBranchMetadata> {
  return {
    ...session,
    commits: [...session.commits, commit],
    headCommitId,
    revision: session.revision + 1,
  };
}

export function updateHead<TPatch, TBranchMetadata>(
  session: DagSession<TPatch, TBranchMetadata>,
  headCommitId: string
): DagSession<TPatch, TBranchMetadata> {
  requireCommit(session, headCommitId);
  return {
    ...session,
    headCommitId,
    revision: session.revision + 1,
  };
}
