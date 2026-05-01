import { describe, expect, it } from "vitest";
import {
  appendCommit,
  assertAcyclic,
  createDagSession,
  getAncestors,
  pathToHead,
  resolveHead,
} from "../src/commit-graph";
import type { DagSession } from "../src/types";
import { patch, type TestBranchMetadata, type TestPatch } from "./test-helpers";

describe("commit graph", () => {
  it("appends root and child commits and resolves head", () => {
    let session = createDagSession<TestPatch, TestBranchMetadata>("session-1");
    session = appendCommit(session, {
      id: "root",
      parentIds: [],
      patch: patch("root"),
      createdAt: "2026-01-01T00:00:00.000Z",
    });
    session = appendCommit(session, {
      id: "child",
      parentIds: ["root"],
      patch: patch("child"),
      createdAt: "2026-01-01T00:01:00.000Z",
    });

    expect(resolveHead(session)?.id).toBe("child");
    expect(session.revision).toBe(2);
  });

  it("rejects missing parents and duplicate commit ids", () => {
    let session = createDagSession<TestPatch, TestBranchMetadata>("session-1");
    expect(() =>
      appendCommit(session, {
        id: "child",
        parentIds: ["missing"],
        patch: patch("child"),
        createdAt: "now",
      })
    ).toThrow("Unknown commit: missing");

    session = appendCommit(session, {
      id: "root",
      parentIds: [],
      patch: patch("root"),
      createdAt: "now",
    });
    expect(() =>
      appendCommit(session, {
        id: "root",
        parentIds: [],
        patch: patch("again"),
        createdAt: "later",
      })
    ).toThrow("Duplicate commit: root");
  });

  it("allows idempotent duplicate append with same idempotency key", () => {
    let session = createDagSession<TestPatch, TestBranchMetadata>("session-1");
    session = appendCommit(session, {
      id: "root",
      parentIds: [],
      patch: patch("root"),
      createdAt: "now",
      idempotencyKey: "idem-1",
    });
    const again = appendCommit(session, {
      id: "root",
      parentIds: [],
      patch: patch("root"),
      createdAt: "now",
      idempotencyKey: "idem-1",
    });

    expect(again).toBe(session);
  });

  it("supports multi-parent commits and deterministic primary path", () => {
    let session = createDagSession<TestPatch, TestBranchMetadata>("session-1");
    session = appendCommit(session, {
      id: "root",
      parentIds: [],
      patch: patch("root"),
      createdAt: "t0",
    });
    session = appendCommit(session, {
      id: "left",
      parentIds: ["root"],
      patch: patch("left"),
      createdAt: "t1",
    });
    session = appendCommit(session, {
      id: "right",
      parentIds: ["root"],
      patch: patch("right"),
      createdAt: "t2",
    });
    session = appendCommit(session, {
      id: "merge",
      parentIds: ["left", "right"],
      patch: patch("merge"),
      createdAt: "t3",
    });

    expect(getAncestors(session, "merge").map((commit) => commit.id)).toEqual([
      "root",
      "left",
      "right",
    ]);
    expect(pathToHead(session).map((commit) => commit.id)).toEqual([
      "root",
      "left",
      "merge",
    ]);
  });

  it("detects cycles in persisted sessions", () => {
    const session: DagSession<TestPatch, TestBranchMetadata> = {
      schemaVersion: 1,
      id: "session-1",
      commits: [
        { id: "a", parentIds: ["b"], patch: patch("a"), createdAt: "t0" },
        { id: "b", parentIds: ["a"], patch: patch("b"), createdAt: "t1" },
      ],
      branches: [],
      headCommitId: "b",
      revision: 2,
    };

    expect(() => assertAcyclic(session)).toThrow("Cycle detected at commit: a");
  });
});
