import { describe, expect, it } from "vitest";
import { createBranch, rejectBranch, selectBranch } from "../src/branch";
import { assertAcyclic } from "../src/commit-graph";
import { projectBranch, projectHead } from "../src/projection";
import { createLinearSession, patch, type TestPatch } from "./test-helpers";

const reducer = (state: readonly string[], nextPatch: TestPatch) => [
  ...state,
  nextPatch.value,
];

describe("invariants", () => {
  it("keeps graph acyclic with known unique commits", () => {
    const session = createLinearSession();
    expect(() => assertAcyclic(session)).not.toThrow();
    expect(new Set(session.commits.map((commit) => commit.id)).size).toBe(
      session.commits.length
    );
  });

  it("treats rejected branches as terminal", () => {
    let session = createBranch(createLinearSession(), {
      id: "branch-1",
      baseCommitId: "a",
      patch: patch("candidate"),
      metadata: { label: "candidate" },
      createdAt: "t2",
    });
    session = rejectBranch(session, "branch-1", "t3");

    expect(() => selectBranch(session, "branch-1", "selected", "t4")).toThrow(
      "Branch is terminal: branch-1"
    );
  });

  it("selected branch creates exactly one commit", () => {
    let session = createBranch(createLinearSession(), {
      id: "branch-1",
      baseCommitId: "a",
      patch: patch("candidate"),
      metadata: { label: "candidate" },
      createdAt: "t2",
    });
    session = selectBranch(session, "branch-1", "selected", "t3");

    expect(
      session.commits.filter(
        (commit) => commit.metadata?.branchId === "branch-1"
      )
    ).toHaveLength(1);
  });

  it("keeps preview projection isolated from committed projection", () => {
    const session = createBranch(createLinearSession(), {
      id: "branch-1",
      baseCommitId: "a",
      patch: patch("candidate"),
      metadata: { label: "candidate" },
      createdAt: "t2",
    });

    expect(
      projectBranch(session, "branch-1", [] as readonly string[], reducer)
    ).toContain("candidate");
    expect(
      projectHead(session, [] as readonly string[], reducer)
    ).not.toContain("candidate");
  });
});
