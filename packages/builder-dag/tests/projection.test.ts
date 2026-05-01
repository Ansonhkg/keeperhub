import { describe, expect, it } from "vitest";
import { createBranch } from "../src/branch";
import { orderedTimeline, projectBranch, projectHead } from "../src/projection";
import { createLinearSession, patch, type TestPatch } from "./test-helpers";

const reducer = (state: readonly string[], nextPatch: TestPatch) => [
  ...state,
  nextPatch.value,
];

describe("projection", () => {
  it("projects committed head deterministically", () => {
    const projected = projectHead(
      createLinearSession(),
      [] as readonly string[],
      reducer
    );
    expect(projected).toEqual(["root", "a"]);
  });

  it("projects candidate branch without mutating committed head", () => {
    const session = createBranch(createLinearSession(), {
      id: "branch-1",
      baseCommitId: "a",
      patch: patch("candidate"),
      metadata: { label: "preview" },
      createdAt: "t2",
    });

    expect(
      projectBranch(session, "branch-1", [] as readonly string[], reducer)
    ).toEqual(["root", "a", "candidate"]);
    expect(projectHead(session, [] as readonly string[], reducer)).toEqual([
      "root",
      "a",
    ]);
  });

  it("orders timeline reproducibly", () => {
    const session = createBranch(createLinearSession(), {
      id: "branch-1",
      baseCommitId: "a",
      patch: patch("candidate"),
      metadata: { label: "preview" },
      createdAt: "2026-01-01T00:00:30.000Z",
    });

    expect(orderedTimeline(session).map((item) => item.id)).toEqual([
      "root",
      "branch-1",
      "a",
    ]);
  });
});
