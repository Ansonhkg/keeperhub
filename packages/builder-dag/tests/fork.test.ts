import { describe, expect, it } from "vitest";
import { createBranch, requireBranch } from "../src/branch";
import {
  abandonDownstreamBranches,
  downstreamCommitIds,
  forkFromCommit,
} from "../src/fork";
import { createLinearSession, patch } from "./test-helpers";

describe("forks", () => {
  it("forks after a commit", () => {
    const session = forkFromCommit(createLinearSession(), {
      id: "fork-a",
      mode: "after_commit",
      commitId: "a",
      patch: patch("fork"),
      createdAt: "t2",
    });

    expect(session.headCommitId).toBe("fork-a");
    expect(session.commits.at(-1)?.parentIds).toEqual(["a"]);
  });

  it("replaces a commit by using original parents", () => {
    const session = forkFromCommit(createLinearSession(), {
      id: "replace-a",
      mode: "replace_commit",
      commitId: "a",
      patch: patch("replace"),
      createdAt: "t2",
    });

    expect(session.commits.at(-1)?.parentIds).toEqual(["root"]);
  });

  it("finds downstream commits and stales downstream branches", () => {
    let session = createBranch(createLinearSession(), {
      id: "branch-a",
      baseCommitId: "a",
      patch: patch("preview"),
      metadata: { label: "preview" },
      createdAt: "t2",
    });
    session = forkFromCommit(session, {
      id: "b",
      mode: "after_commit",
      commitId: "a",
      patch: patch("b"),
      createdAt: "t3",
    });
    session = createBranch(session, {
      id: "branch-b",
      baseCommitId: "b",
      patch: patch("preview-b"),
      metadata: { label: "preview-b" },
      createdAt: "t4",
    });

    expect(downstreamCommitIds(session, "a")).toEqual(["b"]);
    const abandoned = abandonDownstreamBranches(session, "a", "t5");
    expect(requireBranch(abandoned, "branch-a").status).toBe("stale");
    expect(requireBranch(abandoned, "branch-b").status).toBe("stale");
  });
});
