import { appendCommit } from "./commit-graph";
import { requireCommit } from "./commit-store";
import type { CreateBranchInput, DagBranch, DagSession } from "./types";

export function createBranch<TPatch, TBranchMetadata>(
  session: DagSession<TPatch, TBranchMetadata>,
  input: CreateBranchInput<TPatch, TBranchMetadata>
): DagSession<TPatch, TBranchMetadata> {
  if (session.branches.some((branch) => branch.id === input.id)) {
    throw new Error(`Duplicate branch: ${input.id}`);
  }
  requireCommit(session, input.baseCommitId);
  return {
    ...session,
    branches: [
      ...session.branches,
      {
        id: input.id,
        baseCommitId: input.baseCommitId,
        patch: input.patch,
        metadata: input.metadata,
        status: "open",
        createdAt: input.createdAt,
        updatedAt: input.createdAt,
      },
    ],
    revision: session.revision + 1,
  };
}

export function rejectBranch<TPatch, TBranchMetadata>(
  session: DagSession<TPatch, TBranchMetadata>,
  branchId: string,
  rejectedAt: string,
  rejectionReason?: string
): DagSession<TPatch, TBranchMetadata> {
  return updateBranch(session, branchId, (branch) => {
    assertOpenBranch(branch);
    return {
      ...branch,
      status: "rejected",
      updatedAt: rejectedAt,
      rejectionReason,
    };
  });
}

export function markBranchStale<TPatch, TBranchMetadata>(
  session: DagSession<TPatch, TBranchMetadata>,
  branchId: string,
  staleAt: string,
  staleReason?: string
): DagSession<TPatch, TBranchMetadata> {
  return updateBranch(session, branchId, (branch) => {
    if (branch.status === "selected" || branch.status === "rejected") {
      return branch;
    }
    return { ...branch, status: "stale", updatedAt: staleAt, staleReason };
  });
}

export function selectBranch<TPatch, TBranchMetadata>(
  session: DagSession<TPatch, TBranchMetadata>,
  branchId: string,
  commitId: string,
  selectedAt: string,
  expectedRevision?: number
): DagSession<TPatch, TBranchMetadata> {
  if (expectedRevision !== undefined && session.revision !== expectedRevision) {
    throw new Error(
      `Revision conflict: expected ${expectedRevision}, got ${session.revision}`
    );
  }
  const branch = requireBranch(session, branchId);
  assertOpenBranch(branch);
  if (session.headCommitId !== branch.baseCommitId) {
    throw new Error(`Stale branch base: ${branch.baseCommitId}`);
  }

  const withSelectedCommit = appendCommit(session, {
    id: commitId,
    parentIds: [branch.baseCommitId],
    patch: branch.patch,
    createdAt: selectedAt,
    metadata: { branchId },
  });

  return updateBranch(withSelectedCommit, branchId, (current) => ({
    ...current,
    status: "selected",
    updatedAt: selectedAt,
    selectedCommitId: commitId,
  }));
}

export function isBranchStale<TPatch, TBranchMetadata>(
  session: DagSession<TPatch, TBranchMetadata>,
  branch: DagBranch<TPatch, TBranchMetadata>
): boolean {
  return (
    branch.status === "open" && session.headCommitId !== branch.baseCommitId
  );
}

export function requireBranch<TPatch, TBranchMetadata>(
  session: DagSession<TPatch, TBranchMetadata>,
  branchId: string
): DagBranch<TPatch, TBranchMetadata> {
  const branch = session.branches.find(
    (candidate) => candidate.id === branchId
  );
  if (!branch) {
    throw new Error(`Unknown branch: ${branchId}`);
  }
  return branch;
}

function updateBranch<TPatch, TBranchMetadata>(
  session: DagSession<TPatch, TBranchMetadata>,
  branchId: string,
  update: (
    branch: DagBranch<TPatch, TBranchMetadata>
  ) => DagBranch<TPatch, TBranchMetadata>
): DagSession<TPatch, TBranchMetadata> {
  let found = false;
  const branches = session.branches.map((branch) => {
    if (branch.id !== branchId) {
      return branch;
    }
    found = true;
    return update(branch);
  });
  if (!found) {
    throw new Error(`Unknown branch: ${branchId}`);
  }
  return { ...session, branches, revision: session.revision + 1 };
}

function assertOpenBranch<TPatch, TBranchMetadata>(
  branch: DagBranch<TPatch, TBranchMetadata>
): void {
  if (branch.status !== "open") {
    throw new Error(`Branch is terminal: ${branch.id}`);
  }
}
