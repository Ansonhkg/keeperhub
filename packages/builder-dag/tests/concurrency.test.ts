import { describe, expect, it } from "vitest";
import { createBranch, selectBranch } from "../src/branch";
import { createLinearSession, patch } from "./test-helpers";

describe("concurrency", () => {
  it("rejects stale expected revisions", () => {
    const session = createBranch(createLinearSession(), {
      id: "branch-1",
      baseCommitId: "a",
      patch: patch("selected"),
      metadata: { label: "native" },
      createdAt: "t2",
    });

    expect(() =>
      selectBranch(session, "branch-1", "selected", "t3", session.revision - 1)
    ).toThrow("Revision conflict");
  });

  it("prevents double-select races", () => {
    let session = createBranch(createLinearSession(), {
      id: "branch-1",
      baseCommitId: "a",
      patch: patch("selected"),
      metadata: { label: "native" },
      createdAt: "t2",
    });
    session = selectBranch(session, "branch-1", "selected-1", "t3");

    expect(() => selectBranch(session, "branch-1", "selected-2", "t4")).toThrow(
      "Branch is terminal: branch-1"
    );
  });
});
