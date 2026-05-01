import { createStore } from "jotai/vanilla";
import { describe, expect, it } from "vitest";

import type {
  BuilderPreviewEdge,
  BuilderPreviewNode,
  BuilderProjection,
} from "@/lib/agentic-builder/projection/contracts";
import {
  answerBuilderProjectionQuestionAtom,
  builderProjectionAtom,
  clearBuilderProjectionAtom,
  clearBuilderProjectionHighlightAtom,
  rejectBuilderProjectionOptionAtom,
  renderedWorkflowEdgesAtom,
  renderedWorkflowNodesAtom,
  selectBuilderProjectionOptionAtom,
  setBuilderProjectionHighlightAtom,
  setBuilderProjectionAtom,
} from "@/lib/agentic-builder/projection/store";
import {
  edgesAtom,
  nodesAtom,
  type WorkflowNode,
} from "@/lib/workflow/store";

describe("agentic builder projection store", () => {
  it("keeps projection state separate from real workflow atoms", () => {
    const store = createStore();
    store.set(nodesAtom, [node("trigger_1", "trigger")]);
    store.set(edgesAtom, []);

    store.set(setBuilderProjectionAtom, projection());

    expect(store.get(builderProjectionAtom)?.branches[0]).toMatchObject({
      optionGroupId: "option_group_1",
      capabilityMatchIds: ["match_1"],
      customProposalIds: ["custom_1"],
    });
    expect(store.get(nodesAtom).map((item) => item.id)).toEqual(["trigger_1"]);
    expect(store.get(edgesAtom)).toEqual([]);
    expect(store.get(renderedWorkflowNodesAtom).map((item) => item.id)).toEqual([
      "trigger_1",
      "preview_action_1",
    ]);
    expect(store.get(renderedWorkflowEdgesAtom).map((item) => item.id)).toEqual([
      "preview_edge_1",
    ]);
  });

  it("updates projection lifecycle without mutating workflow graph", () => {
    const store = createStore();
    store.set(nodesAtom, [node("trigger_1", "trigger")]);
    store.set(edgesAtom, []);
    store.set(setBuilderProjectionAtom, projection());

    store.set(answerBuilderProjectionQuestionAtom, {
      questionId: "question_1",
      answer: "5%",
    });
    store.set(selectBuilderProjectionOptionAtom, "option_1");

    expect(store.get(builderProjectionAtom)).toMatchObject({
      status: "accepted",
      selectedOptionId: "option_1",
      questions: [{ id: "question_1", answer: "5%" }],
    });
    expect(store.get(nodesAtom).map((item) => item.id)).toEqual(["trigger_1"]);
  });

  it("projects hover and focus highlight state onto preview graph", () => {
    const store = createStore();
    store.set(setBuilderProjectionAtom, projection());

    store.set(setBuilderProjectionHighlightAtom, { optionId: "option_1" });

    expect(
      (
        store.get(renderedWorkflowNodesAtom)[0]?.data as Record<string, unknown>
      ).builderHighlighted
    ).toBe(true);
    expect(
      store.get(renderedWorkflowEdgesAtom)[0]?.data?.builderHighlighted
    ).toBe(true);

    store.set(clearBuilderProjectionHighlightAtom);

    expect(
      (
        store.get(renderedWorkflowNodesAtom)[0]?.data as Record<string, unknown>
      ).builderHighlighted
    ).toBe(false);
  });

  it("rejects option branches and clears projection state", () => {
    const store = createStore();
    store.set(setBuilderProjectionAtom, projection());

    store.set(rejectBuilderProjectionOptionAtom, "option_1");

    expect(store.get(builderProjectionAtom)).toMatchObject({
      status: "rejected",
      rejectedOptionIds: ["option_1"],
      branches: [],
    });

    store.set(clearBuilderProjectionAtom);

    expect(store.get(builderProjectionAtom)).toBeNull();
  });
});

function node(id: string, type: "trigger" | "action"): WorkflowNode {
  return {
    id,
    type,
    position: { x: 0, y: 0 },
    data: {
      label: id,
      type,
    },
  };
}

function previewNode(id: string): BuilderPreviewNode {
  return {
    ...node(id, "action"),
    data: {
      label: id,
      type: "action",
      builderPreview: true,
      builderProjectionId: "projection_1",
      builderBranchId: "branch_1",
      builderOptionId: "option_1",
      builderRequirementIds: ["req_1"],
    },
  };
}

function previewEdge(id: string): BuilderPreviewEdge {
  return {
    id,
    source: "trigger_1",
    target: "preview_action_1",
    data: {
      builderPreview: true,
      builderProjectionId: "projection_1",
      builderBranchId: "branch_1",
      builderOptionId: "option_1",
      builderRequirementIds: ["req_1"],
    },
  };
}

function projection(): BuilderProjection {
  return {
    id: "projection_1",
    workflowId: "workflow_1",
    sourcePrompt: "Slack me when ETH moves",
    status: "ready",
    baseGraph: {
      nodeIds: ["trigger_1"],
      edgeIds: [],
      capturedAt: "2026-05-01T00:00:00.000Z",
    },
    intent: {
      schemaVersion: "agentic-builder.intent.v1",
      prompt: "Slack me when ETH moves",
      clauses: [],
      unresolved: [],
      assumptions: [],
    },
    evaluation: {
      requirements: [],
      unresolved: [],
      tasks: [],
      optionGroups: [],
      capabilityMatches: [],
      customNodeProposals: [],
    },
    branches: [
      {
        id: "branch_1",
        optionId: "option_1",
        optionGroupId: "option_group_1",
        title: "Notify through Slack",
        risk: "low",
        requirementIds: ["req_1"],
        capabilityMatchIds: ["match_1"],
        customProposalIds: ["custom_1"],
        previewNodes: [previewNode("preview_action_1")],
        previewEdges: [previewEdge("preview_edge_1")],
      },
    ],
    questions: [
      {
        id: "question_1",
        requirementId: "req_1",
        question: "What movement should trigger this workflow?",
        blocksMaterialization: true,
      },
    ],
    validationIssues: [],
    rejectedOptionIds: [],
  };
}
