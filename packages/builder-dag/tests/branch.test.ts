import { describe, expect, it } from "vitest";
import {
  createBranch,
  isBranchStale,
  rejectBranch,
  requireBranch,
  selectBranch,
} from "../src/branch";
import { appendCommit } from "../src/commit-graph";
import { createLinearSession, patch } from "./test-helpers";

describe("branches", () => {
  it("creates branches with metadata and isolates them from head", () => {
    const session = createBranch(createLinearSession(), {
      id: "branch-1",
      baseCommitId: "a",
      patch: patch("preview"),
      metadata: { label: "native" },
      createdAt: "2026-01-01T00:02:00.000Z",
    });

    expect(session.headCommitId).toBe("a");
    expect(requireBranch(session, "branch-1").metadata).toEqual({
      label: "native",
    });
  });

  it("rejects branches without moving head", () => {
    let session = createBranch(createLinearSession(), {
      id: "branch-1",
      baseCommitId: "a",
      patch: patch("preview"),
      metadata: { label: "native" },
      createdAt: "t2",
    });
    session = rejectBranch(session, "branch-1", "t3", "not needed");

    expect(session.headCommitId).toBe("a");
    expect(requireBranch(session, "branch-1").status).toBe("rejected");
    expect(() => selectBranch(session, "branch-1", "selected", "t4")).toThrow(
      "Branch is terminal: branch-1"
    );
  });

  it("selects an open branch into one commit", () => {
    let session = createBranch(createLinearSession(), {
      id: "branch-1",
      baseCommitId: "a",
      patch: patch("selected"),
      metadata: { label: "native" },
      createdAt: "t2",
    });
    session = selectBranch(
      session,
      "branch-1",
      "commit-selected",
      "t3",
      session.revision
    );

    expect(session.headCommitId).toBe("commit-selected");
    expect(
      session.commits.filter((commit) => commit.id === "commit-selected")
    ).toHaveLength(1);
    expect(requireBranch(session, "branch-1").selectedCommitId).toBe(
      "commit-selected"
    );
  });

  it("detects stale branches after head changes", () => {
    let session = createBranch(createLinearSession(), {
      id: "branch-1",
      baseCommitId: "a",
      patch: patch("preview"),
      metadata: { label: "native" },
      createdAt: "t2",
    });
    session = appendCommit(session, {
      id: "b",
      parentIds: ["a"],
      patch: patch("b"),
      createdAt: "t3",
    });

    const branch = requireBranch(session, "branch-1");
    expect(isBranchStale(session, branch)).toBe(true);
    expect(() => selectBranch(session, "branch-1", "selected", "t4")).toThrow(
      "Stale branch base: a"
    );
  });
});
