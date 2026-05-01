import { appendCommit, createDagSession } from "../src/commit-graph";
import type { DagSession } from "../src/types";

export type TestPatch = { readonly value: string };
export type TestBranchMetadata = { readonly label: string };

export function patch(value: string): TestPatch {
  return { value };
}

export function createLinearSession(): DagSession<
  TestPatch,
  TestBranchMetadata
> {
  let session = createDagSession<TestPatch, TestBranchMetadata>("session-1");
  session = appendCommit(session, {
    id: "root",
    parentIds: [],
    patch: patch("root"),
    createdAt: "2026-01-01T00:00:00.000Z",
  });
  session = appendCommit(session, {
    id: "a",
    parentIds: ["root"],
    patch: patch("a"),
    createdAt: "2026-01-01T00:01:00.000Z",
  });
  return session;
}
