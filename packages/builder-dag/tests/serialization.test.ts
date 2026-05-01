import { describe, expect, it } from "vitest";
import { createBranch } from "../src/branch";
import { dagSessionSchema, parseDagSession } from "../src/schemas";
import { createLinearSession, patch } from "./test-helpers";

describe("serialization", () => {
  it("round-trips JSON through schema validation", () => {
    const session = createBranch(createLinearSession(), {
      id: "branch-1",
      baseCommitId: "a",
      patch: patch("candidate"),
      metadata: { label: "preview" },
      createdAt: "t2",
    });

    expect(parseDagSession(JSON.parse(JSON.stringify(session)))).toEqual(
      session
    );
  });

  it("rejects unknown schema versions", () => {
    const session = { ...createLinearSession(), schemaVersion: 2 };
    expect(dagSessionSchema.safeParse(session).success).toBe(false);
  });

  it("rejects unknown parents and duplicate branch ids", () => {
    const session = {
      ...createLinearSession(),
      commits: [
        {
          id: "orphan",
          parentIds: ["missing"],
          patch: patch("orphan"),
          createdAt: "t0",
        },
      ],
      branches: [
        {
          id: "b",
          baseCommitId: "orphan",
          patch: patch("b"),
          metadata: { label: "b" },
          status: "open",
          createdAt: "t1",
          updatedAt: "t1",
        },
        {
          id: "b",
          baseCommitId: "orphan",
          patch: patch("b"),
          metadata: { label: "b" },
          status: "open",
          createdAt: "t1",
          updatedAt: "t1",
        },
      ],
      headCommitId: "orphan",
    };

    expect(dagSessionSchema.safeParse(session).success).toBe(false);
  });
});
