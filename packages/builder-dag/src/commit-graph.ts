import {
  createCommit,
  findCommit,
  hasCommit,
  requireCommit,
  withCommit,
} from "./commit-store";
import type { AppendCommitInput, DagCommit, DagSession } from "./types";

export function createDagSession<TPatch, TBranchMetadata>(
  id: string
): DagSession<TPatch, TBranchMetadata> {
  return {
    schemaVersion: 1,
    id,
    commits: [],
    branches: [],
    revision: 0,
  };
}

export function appendCommit<TPatch, TBranchMetadata>(
  session: DagSession<TPatch, TBranchMetadata>,
  input: AppendCommitInput<TPatch>
): DagSession<TPatch, TBranchMetadata> {
  if (hasCommit(session, input.id)) {
    const existing = requireCommit(session, input.id);
    if (
      input.idempotencyKey &&
      existing.idempotencyKey === input.idempotencyKey
    ) {
      return session;
    }
    throw new Error(`Duplicate commit: ${input.id}`);
  }

  assertUniqueIds(input.parentIds, "Duplicate parent id");
  for (const parentId of input.parentIds) {
    if (parentId === input.id) {
      throw new Error(`Commit cannot parent itself: ${input.id}`);
    }
    requireCommit(session, parentId);
  }

  const commit = createCommit(input);
  const next = withCommit(session, commit, commit.id);
  assertAcyclic(next);
  return next;
}

export function resolveHead<TPatch, TBranchMetadata>(
  session: DagSession<TPatch, TBranchMetadata>
): DagCommit<TPatch> | undefined {
  return session.headCommitId
    ? findCommit(session, session.headCommitId)
    : undefined;
}

export function getAncestors<TPatch, TBranchMetadata>(
  session: DagSession<TPatch, TBranchMetadata>,
  commitId: string
): readonly DagCommit<TPatch>[] {
  const ancestors: DagCommit<TPatch>[] = [];
  const visited = new Set<string>();
  const visit = (currentId: string) => {
    const commit = requireCommit(session, currentId);
    for (const parentId of commit.parentIds) {
      if (!visited.has(parentId)) {
        visited.add(parentId);
        visit(parentId);
        ancestors.push(requireCommit(session, parentId));
      }
    }
  };
  visit(commitId);
  return ancestors;
}

export function pathToHead<TPatch, TBranchMetadata>(
  session: DagSession<TPatch, TBranchMetadata>,
  fromCommitId?: string
): readonly DagCommit<TPatch>[] {
  const head = resolveHead(session);
  if (!head) {
    return [];
  }
  const stopAt = fromCommitId;
  if (stopAt) {
    requireCommit(session, stopAt);
  }

  const path: DagCommit<TPatch>[] = [];
  let current: DagCommit<TPatch> | undefined = head;
  while (current) {
    path.unshift(current);
    if (current.id === stopAt) {
      return path;
    }
    current = current.parentIds[0]
      ? requireCommit(session, current.parentIds[0])
      : undefined;
  }

  if (stopAt) {
    throw new Error(`Commit is not on primary path to head: ${stopAt}`);
  }
  return path;
}

export function pathToCommit<TPatch, TBranchMetadata>(
  session: DagSession<TPatch, TBranchMetadata>,
  commitId: string
): readonly DagCommit<TPatch>[] {
  requireCommit(session, commitId);
  const path: DagCommit<TPatch>[] = [];
  let current: DagCommit<TPatch> | undefined = requireCommit(session, commitId);
  while (current) {
    path.unshift(current);
    current = current.parentIds[0]
      ? requireCommit(session, current.parentIds[0])
      : undefined;
  }
  return path;
}

export function assertAcyclic<TPatch, TBranchMetadata>(
  session: DagSession<TPatch, TBranchMetadata>
): void {
  const visiting = new Set<string>();
  const visited = new Set<string>();

  const visit = (commitId: string) => {
    if (visiting.has(commitId)) {
      throw new Error(`Cycle detected at commit: ${commitId}`);
    }
    if (visited.has(commitId)) {
      return;
    }
    visiting.add(commitId);
    const commit = requireCommit(session, commitId);
    for (const parentId of commit.parentIds) {
      requireCommit(session, parentId);
      visit(parentId);
    }
    visiting.delete(commitId);
    visited.add(commitId);
  };

  for (const commit of session.commits) {
    visit(commit.id);
  }
}

function assertUniqueIds(ids: readonly string[], message: string): void {
  const seen = new Set<string>();
  for (const id of ids) {
    if (seen.has(id)) {
      throw new Error(`${message}: ${id}`);
    }
    seen.add(id);
  }
}
