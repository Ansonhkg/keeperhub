import { appendCommit, getAncestors } from "./commit-graph";
import { requireCommit } from "./commit-store";
import type { DagSession, ForkFromCommitInput } from "./types";

export function forkFromCommit<TPatch, TBranchMetadata>(
  session: DagSession<TPatch, TBranchMetadata>,
  input: ForkFromCommitInput<TPatch>
): DagSession<TPatch, TBranchMetadata> {
  requireCommit(session, input.commitId);
  const parentIds =
    input.mode === "replace_commit"
      ? parentIdsForReplacement(session, input.commitId)
      : [input.commitId];
  return appendCommit(session, {
    id: input.id,
    parentIds,
    patch: input.patch,
    createdAt: input.createdAt,
    idempotencyKey: input.idempotencyKey,
    metadata: {
      ...input.metadata,
      forkMode: input.mode,
      forkCommitId: input.commitId,
    },
  });
}

export function downstreamCommitIds<TPatch, TBranchMetadata>(
  session: DagSession<TPatch, TBranchMetadata>,
  commitId: string
): readonly string[] {
  requireCommit(session, commitId);
  const downstream = new Set<string>();
  let changed = true;
  while (changed) {
    changed = false;
    for (const commit of session.commits) {
      if (commit.id === commitId || downstream.has(commit.id)) {
        continue;
      }
      if (
        commit.parentIds.includes(commitId) ||
        commit.parentIds.some((parentId) => downstream.has(parentId))
      ) {
        downstream.add(commit.id);
        changed = true;
      }
    }
  }
  return [...downstream];
}

export function abandonDownstreamBranches<TPatch, TBranchMetadata>(
  session: DagSession<TPatch, TBranchMetadata>,
  commitId: string,
  staleAt: string,
  staleReason = "downstream_abandoned"
): DagSession<TPatch, TBranchMetadata> {
  const abandoned = new Set([
    commitId,
    ...downstreamCommitIds(session, commitId),
  ]);
  return {
    ...session,
    branches: session.branches.map((branch) => {
      if (branch.status !== "open" || !abandoned.has(branch.baseCommitId)) {
        return branch;
      }
      return { ...branch, status: "stale", updatedAt: staleAt, staleReason };
    }),
    revision: session.revision + 1,
  };
}

function parentIdsForReplacement<TPatch, TBranchMetadata>(
  session: DagSession<TPatch, TBranchMetadata>,
  commitId: string
): readonly string[] {
  const commit = requireCommit(session, commitId);
  if (commit.parentIds.length > 0) {
    return commit.parentIds;
  }
  const ancestors = getAncestors(session, commitId);
  const previous = ancestors.at(-1);
  return previous ? [previous.id] : [];
}
