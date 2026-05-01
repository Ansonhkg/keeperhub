import { createRequire } from "node:module";
import type { BuilderProjection } from "@keeperhub/agentic-builder/schemas";
import { createStore } from "jotai";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { DecisionTray } from "@/components/agentic-builder/decision-tray";
import {
  filterBuilderPreviewGraph,
  isBuilderPreviewNode,
  projectBuilderToCanvas,
} from "@/lib/agentic-builder/canvas-projection";
import {
  builderProjectionAtom,
  builderProjectionStateAtom,
  clearBuilderProjectionAtom,
  setBuilderProjectionForWorkflowAtom,
} from "@/lib/agentic-builder/store";

const require = createRequire(import.meta.url);
const { JSDOM } = require("jsdom") as {
  JSDOM: new (
    html: string
  ) => {
    window: Window & typeof globalThis;
  };
};

const projection: BuilderProjection = {
  candidateBranches: [
    {
      baseCommitId: "commit-1",
      branchId: "branch-1",
      dashedEdges: [{ fromStepId: "step-1", toStepId: "future-1" }],
      greyNodes: [
        {
          dependsOn: ["step-1"],
          id: "future-1",
          kind: "notify",
          label: "Future notification",
          requiredEntityIds: [],
          status: "planned",
        },
      ],
      optionId: "option-1",
      status: "open",
    },
  ],
  committed: {
    edges: [],
    id: "session-1",
    nodes: [
      {
        dependsOn: [],
        id: "step-1",
        kind: "trigger",
        label: "Run every 15 minutes",
        requiredEntityIds: [],
        status: "ready",
      },
    ],
  },
  headCommitId: "commit-1",
  options: [
    {
      candidateIds: ["native-price"],
      confidence: 0.9,
      id: "option-1",
      patch: {
        id: "patch-1",
        ops: [
          {
            op: "add_step",
            step: {
              dependsOn: ["step-1"],
              id: "future-1",
              kind: "notify",
              label: "Future notification",
              requiredEntityIds: [],
              status: "planned",
            },
          },
        ],
        summary: "Use native price",
      },
      rationale: "Most reliable route",
      requiredInputs: [],
      risk: "low",
      stepId: "step-1",
      strategy: "native_action",
      title: "Use native price feed",
    },
  ],
  questions: [],
  sessionId: "session-1",
  timeline: [],
  validation: { issues: [], valid: true },
};

describe("agentic builder canvas-native UI", () => {
  it("scopes builder projection state to the active workflow", () => {
    const store = createStore();

    store.set(setBuilderProjectionForWorkflowAtom, {
      projection,
      workflowId: "workflow-a",
    });

    const activeState = store.get(builderProjectionStateAtom);
    expect(activeState.projection).toBe(projection);
    expect(activeState.workflowId).toBe("workflow-a");

    const staleForNextWorkflow =
      activeState.workflowId === "workflow-b" ? activeState.projection : null;
    expect(staleForNextWorkflow).toBeNull();

    store.set(clearBuilderProjectionAtom);
    expect(store.get(builderProjectionAtom)).toBeNull();
    expect(store.get(builderProjectionStateAtom).workflowId).toBeNull();
  });

  it("projects committed and preview branches into workflow canvas graph elements", () => {
    const canvasProjection = projectBuilderToCanvas({
      ...projection,
      candidateBranches: [
        {
          ...projection.candidateBranches[0],
          dashedEdges: [{ fromStepId: "step-2", toStepId: "future-1" }],
        },
      ],
      committed: {
        ...projection.committed,
        edges: [{ fromStepId: "step-1", toStepId: "step-2" }],
        nodes: [
          ...projection.committed.nodes,
          {
            dependsOn: ["step-1"],
            id: "step-2",
            kind: "read",
            label: "Read ETH price",
            requiredEntityIds: [],
            status: "ready",
          },
        ],
      },
      options: [
        {
          ...projection.options[0],
          patch: {
            id: "patch-1",
            ops: [
              {
                changes: {
                  label: "Use native price feed",
                  status: "ready",
                },
                op: "update_step",
                stepId: "step-2",
              },
            ],
            summary: "Use native price",
          },
          stepId: "step-2",
        },
      ],
    });

    expect(canvasProjection.nodes).toHaveLength(3);
    expect(canvasProjection.edges).not.toContainEqual(
      expect.objectContaining({ target: "step-2" })
    );
    expect(canvasProjection.edges).toContainEqual(
      expect.objectContaining({
        data: expect.objectContaining({
          builderOptionIndex: 1,
          builderOptionLane: true,
          builderPreviewOptionId: "option-1",
        }),
        source: "step-1",
        target: "builder-option-option-1",
        type: "temporary",
      })
    );
    expect(canvasProjection.edges).toContainEqual(
      expect.objectContaining({
        data: expect.objectContaining({
          builderPreview: true,
          builderPreviewOptionId: "option-1",
        }),
        source: "builder-option-option-1",
        target: "future-1",
        type: "temporary",
      })
    );
    const previewNode = canvasProjection.nodes.find(
      (node) => node.id === "future-1"
    );
    const committedNode = canvasProjection.nodes.find(
      (node) => node.id === "step-1"
    );
    const optionNode = canvasProjection.nodes.find(
      (node) => node.id === "builder-option-option-1"
    );
    expect(previewNode).toBeDefined();
    expect(committedNode).toBeDefined();
    expect(optionNode?.data.config).toMatchObject({
      builderHighlighted: true,
      builderOptionIndex: 1,
      builderOptionLane: true,
      builderPreview: true,
      builderPreviewOptionId: "option-1",
    });
    expect(optionNode?.position.x).toBeGreaterThan(
      committedNode?.position.x ?? 0
    );
    expect(previewNode ? isBuilderPreviewNode(previewNode) : false).toBe(true);
    expect(previewNode?.position.x).toBeGreaterThan(
      optionNode?.position.x ?? 0
    );
    expect(filterBuilderPreviewGraph(canvasProjection).nodes).toHaveLength(1);
  });

  it("spaces builder preview lanes and condition branches far enough apart", () => {
    const canvasProjection = projectBuilderToCanvas({
      ...projection,
      candidateBranches: [
        {
          ...projection.candidateBranches[0],
          branchId: "branch-1",
          optionId: "option-1",
        },
        {
          ...projection.candidateBranches[0],
          branchId: "branch-2",
          optionId: "option-2",
        },
        {
          ...projection.candidateBranches[0],
          branchId: "branch-3",
          optionId: "option-3",
        },
      ],
      committed: {
        ...projection.committed,
        edges: [
          { fromStepId: "step-1", toStepId: "step-condition" },
          {
            fromStepId: "step-condition",
            sourceHandle: "true",
            toStepId: "step-notify",
          },
          {
            fromStepId: "step-condition",
            sourceHandle: "false",
            toStepId: "step-log",
          },
        ],
        nodes: [
          ...projection.committed.nodes,
          {
            dependsOn: ["step-1"],
            id: "step-condition",
            kind: "condition",
            label: "Compare ETH price movement",
            requiredEntityIds: [],
            status: "ready",
          },
          {
            dependsOn: ["step-condition"],
            id: "step-notify",
            kind: "notify",
            label: "Send Telegram notification",
            requiredEntityIds: [],
            status: "ready",
          },
          {
            dependsOn: ["step-condition"],
            id: "step-log",
            kind: "transform",
            label: "Log unchanged price",
            requiredEntityIds: [],
            status: "ready",
          },
        ],
      },
      options: [
        {
          ...projection.options[0],
          id: "option-1",
          stepId: "step-condition",
          title: "Use Chronicle price source",
        },
        {
          ...projection.options[0],
          id: "option-2",
          stepId: "step-condition",
          title: "Use Chainlink price source",
        },
        {
          ...projection.options[0],
          id: "option-3",
          stepId: "step-condition",
          title: "Use fallback price source",
        },
      ],
    });

    const optionLaneYs = ["option-1", "option-2", "option-3"]
      .map(
        (optionId) =>
          canvasProjection.nodes.find(
            (node) => node.id === `builder-option-${optionId}`
          )?.position.y
      )
      .filter((y): y is number => typeof y === "number")
      .sort((left, right) => left - right);

    expect(optionLaneYs[1] - optionLaneYs[0]).toBeGreaterThanOrEqual(220);
    expect(optionLaneYs[2] - optionLaneYs[1]).toBeGreaterThanOrEqual(220);

    const notifyY = canvasProjection.nodes.find(
      (node) => node.id === "step-notify"
    )?.position.y;
    const logY = canvasProjection.nodes.find((node) => node.id === "step-log")
      ?.position.y;

    expect(Math.abs((notifyY ?? 0) - (logY ?? 0))).toBeGreaterThanOrEqual(220);
  });

  it("moves builder option and grey preview nodes into open lanes when columns are occupied", () => {
    const canvasProjection = projectBuilderToCanvas({
      ...projection,
      candidateBranches: [
        {
          ...projection.candidateBranches[0],
          branchId: "branch-price",
          dashedEdges: [{ fromStepId: "step-price", toStepId: "future-price" }],
          greyNodes: [
            {
              dependsOn: ["step-price"],
              id: "future-price",
              kind: "notify",
              label: "Future notification",
              requiredEntityIds: [],
              status: "planned",
            },
          ],
          optionId: "option-price",
        },
      ],
      committed: {
        ...projection.committed,
        edges: [
          { fromStepId: "step-1", toStepId: "step-occupied" },
          { fromStepId: "step-1", toStepId: "step-price" },
          { fromStepId: "step-occupied", toStepId: "step-downstream" },
        ],
        nodes: [
          ...projection.committed.nodes,
          {
            dependsOn: ["step-1"],
            id: "step-occupied",
            kind: "transform",
            label: "Already occupies the option column",
            requiredEntityIds: [],
            status: "ready",
          },
          {
            dependsOn: ["step-1"],
            id: "step-price",
            kind: "read",
            label: "Price source placeholder",
            requiredEntityIds: [],
            status: "ready",
          },
          {
            dependsOn: ["step-occupied"],
            id: "step-downstream",
            kind: "transform",
            label: "Already occupies the grey preview column",
            requiredEntityIds: [],
            status: "ready",
          },
        ],
      },
      options: [
        {
          ...projection.options[0],
          confidence: 0.9,
          id: "option-price",
          stepId: "step-price",
          title: "Use native price source",
        },
      ],
    });

    const previewNodes = canvasProjection.nodes.filter(
      (node) => node.data.config?.builderPreview === true
    );

    for (const previewNode of previewNodes) {
      for (const node of canvasProjection.nodes) {
        if (node.id === previewNode.id) {
          continue;
        }
        const sameColumn =
          Math.abs(node.position.x - previewNode.position.x) < 220;
        const tooCloseVertically =
          Math.abs(node.position.y - previewNode.position.y) < 170;
        expect(sameColumn && tooCloseVertically).toBe(false);
      }
    }
  });

  it("uses step dependencies for left-to-right layout when committed edges are sparse", () => {
    const canvasProjection = projectBuilderToCanvas({
      ...projection,
      candidateBranches: [],
      committed: {
        ...projection.committed,
        edges: [],
        nodes: [
          ...projection.committed.nodes,
          {
            dependsOn: ["step-1"],
            id: "step-cache",
            kind: "transform",
            label: "Cache baseline ETH price",
            requiredEntityIds: [],
            status: "ready",
          },
          {
            dependsOn: ["step-cache"],
            id: "step-read",
            kind: "read",
            label: "Fetch fresh ETH price",
            requiredEntityIds: [],
            status: "ready",
          },
          {
            dependsOn: ["step-read"],
            id: "step-condition",
            kind: "condition",
            label: "Compare fresh price against baseline",
            requiredEntityIds: [],
            status: "ready",
          },
        ],
      },
      options: [],
    });

    const xFor = (nodeId: string) =>
      canvasProjection.nodes.find((node) => node.id === nodeId)?.position.x ??
      Number.NaN;

    expect(xFor("step-cache")).toBeGreaterThan(xFor("step-1"));
    expect(xFor("step-read")).toBeGreaterThan(xFor("step-cache"));
    expect(xFor("step-condition")).toBeGreaterThan(xFor("step-read"));
  });

  it("uses intent step order for layout when committed edges and dependencies are missing", () => {
    const canvasProjection = projectBuilderToCanvas({
      ...projection,
      candidateBranches: [],
      committed: {
        ...projection.committed,
        edges: [],
        nodes: [
          ...projection.committed.nodes,
          {
            dependsOn: [],
            id: "step-cache",
            kind: "transform",
            label: "Cache baseline ETH price",
            requiredEntityIds: [],
            status: "ready",
          },
          {
            dependsOn: [],
            id: "step-read",
            kind: "read",
            label: "Fetch fresh ETH price",
            requiredEntityIds: [],
            status: "ready",
          },
          {
            dependsOn: [],
            id: "step-condition",
            kind: "condition",
            label: "Compare fresh price against baseline",
            requiredEntityIds: [],
            status: "ready",
          },
        ],
      },
      options: [],
    });

    const xFor = (nodeId: string) =>
      canvasProjection.nodes.find((node) => node.id === nodeId)?.position.x ??
      Number.NaN;

    expect(xFor("step-cache")).toBeGreaterThan(xFor("step-1"));
    expect(xFor("step-read")).toBeGreaterThan(xFor("step-cache"));
    expect(xFor("step-condition")).toBeGreaterThan(xFor("step-read"));
  });

  it("uses answered notification-channel questions when projecting action config", () => {
    const canvasProjection = projectBuilderToCanvas({
      ...projection,
      committed: {
        ...projection.committed,
        nodes: [
          ...projection.committed.nodes,
          {
            dependsOn: ["step-1"],
            id: "step-notify",
            kind: "notify",
            label: "Send notification",
            requiredEntityIds: [],
            status: "ready",
          },
        ],
      },
      questions: [
        {
          answer: "Slack",
          answerType: "single_choice",
          choices: ["Slack", "Email", "Telegram"],
          id: "question-notification-channel",
          prompt: "Which notification channel should be used?",
          status: "answered",
          stepId: "step-notify",
        },
      ],
    });

    expect(
      canvasProjection.nodes.find((node) => node.id === "step-notify")?.data
        .config
    ).toMatchObject({ actionType: "Send Slack Message" });
  });

  it("does not project empty condition config while condition criteria is unresolved", () => {
    const canvasProjection = projectBuilderToCanvas({
      ...projection,
      committed: {
        ...projection.committed,
        nodes: [
          ...projection.committed.nodes,
          {
            dependsOn: ["step-1"],
            id: "step-condition",
            kind: "condition",
            label: "Determine whether the ETH move is significant",
            requiredEntityIds: [],
            status: "ready",
          },
        ],
      },
      questions: [
        {
          answerType: "text",
          choices: ["More than 5%", "More than $100"],
          id: "question-condition-criteria-step-condition",
          prompt: "What counts as a significant move for ETH?",
          status: "open",
          stepId: "step-condition",
        },
      ],
    });

    const conditionNode = canvasProjection.nodes.find(
      (node) => node.id === "step-condition"
    );
    expect(conditionNode?.data.status).toBe("error");
    expect(conditionNode?.data.config).toMatchObject({
      actionType: "Condition",
      builderConditionNeedsAnswer: true,
      builderStepKind: "condition",
    });
    expect(conditionNode?.data.config).not.toHaveProperty("condition");
    expect(conditionNode?.data.config).not.toHaveProperty("conditionConfig");
  });

  it("projects answered condition criteria into visual condition config", () => {
    const canvasProjection = projectBuilderToCanvas({
      ...projection,
      committed: {
        ...projection.committed,
        nodes: [
          ...projection.committed.nodes,
          {
            dependsOn: ["step-1"],
            id: "step-condition",
            kind: "condition",
            label: "Determine whether the ETH move is significant",
            requiredEntityIds: [],
            status: "ready",
          },
        ],
      },
      questions: [
        {
          answer: "More than 5% since the previous check",
          answerType: "text",
          id: "question-condition-criteria-step-condition",
          prompt: "What counts as a significant move for ETH?",
          status: "answered",
          stepId: "step-condition",
        },
      ],
    });

    const conditionNode = canvasProjection.nodes.find(
      (node) => node.id === "step-condition"
    );
    const conditionConfig = conditionNode?.data.config?.conditionConfig as
      | { group?: { rules?: Array<Record<string, unknown>> } }
      | undefined;

    expect(conditionConfig?.group?.rules?.[0]).toMatchObject({
      leftOperand: "{{price_change_percent}}",
      operator: ">",
      rightOperand: "5",
    });
  });

  it("projects cached absolute-delta condition labels into visual condition config", () => {
    const canvasProjection = projectBuilderToCanvas({
      ...projection,
      committed: {
        edges: [
          {
            fromStepId: "step-condition",
            sourceHandle: "true",
            toStepId: "step-telegram",
          },
          {
            fromStepId: "step-condition",
            sourceHandle: "false",
            toStepId: "step-log",
          },
        ],
        id: projection.committed.id,
        nodes: [
          ...projection.committed.nodes,
          {
            dependsOn: ["step-1"],
            id: "step-condition",
            kind: "condition",
            label:
              "Determine whether fresh ETH price moved by $0.10 from cached baseline",
            requiredEntityIds: [],
            status: "ready",
          },
          {
            dependsOn: ["step-condition"],
            id: "step-telegram",
            kind: "notify",
            label: "Notify me via Telegram",
            requiredEntityIds: [],
            status: "ready",
          },
          {
            dependsOn: ["step-condition"],
            id: "step-log",
            kind: "transform",
            label: "Log the price when the threshold is not met",
            requiredEntityIds: [],
            status: "blocked",
          },
        ],
      },
      questions: [],
    });

    const conditionNode = canvasProjection.nodes.find(
      (node) => node.id === "step-condition"
    );
    const conditionConfig = conditionNode?.data.config?.conditionConfig as
      | { group?: { rules?: Array<Record<string, unknown>> } }
      | undefined;

    expect(conditionNode?.data.config).not.toHaveProperty(
      "builderConditionNeedsAnswer"
    );
    expect(conditionConfig?.group?.rules?.[0]).toMatchObject({
      leftOperand: "abs({{freshEthPrice}} - {{baselineEthPrice}})",
      operator: ">=",
      rightOperand: "0.10",
    });
    expect(canvasProjection.edges).toContainEqual(
      expect.objectContaining({
        source: "step-condition",
        sourceHandle: "true",
        target: "step-telegram",
      })
    );
    expect(canvasProjection.edges).toContainEqual(
      expect.objectContaining({
        source: "step-condition",
        sourceHandle: "false",
        target: "step-log",
      })
    );
  });

  it("lays committed nodes left-to-right from edges and removes duplicate condition edges", () => {
    const canvasProjection = projectBuilderToCanvas({
      ...projection,
      committed: {
        edges: [
          {
            fromStepId: "step-condition",
            toStepId: "step-telegram",
          },
          {
            fromStepId: "step-condition",
            sourceHandle: "true",
            toStepId: "step-telegram",
          },
          {
            fromStepId: "step-condition",
            sourceHandle: "false",
            toStepId: "step-log",
          },
          {
            fromStepId: "step-fresh",
            toStepId: "step-condition",
          },
          {
            fromStepId: "step-1",
            toStepId: "step-fresh",
          },
        ],
        id: projection.committed.id,
        nodes: [
          {
            dependsOn: ["step-condition"],
            id: "step-telegram",
            kind: "notify",
            label: "Send Telegram Message",
            requiredEntityIds: [],
            status: "ready",
          },
          {
            dependsOn: ["step-1"],
            id: "step-fresh",
            kind: "read",
            label: "Fetch fresh ETH price every 5 seconds",
            requiredEntityIds: [],
            status: "ready",
          },
          projection.committed.nodes[0],
          {
            dependsOn: ["step-fresh"],
            id: "step-condition",
            kind: "condition",
            label: "Check whether price change is at least $0.10",
            requiredEntityIds: [],
            status: "ready",
          },
          {
            dependsOn: ["step-condition"],
            id: "step-log",
            kind: "transform",
            label: "Log if price does not change",
            requiredEntityIds: [],
            status: "blocked",
          },
        ],
      },
      questions: [],
    });

    const positionFor = (id: string) =>
      canvasProjection.nodes.find((node) => node.id === id)?.position;

    expect(positionFor("step-1")?.x).toBeLessThan(
      positionFor("step-fresh")?.x ?? 0
    );
    expect(positionFor("step-fresh")?.x).toBeLessThan(
      positionFor("step-condition")?.x ?? 0
    );
    expect(positionFor("step-condition")?.x).toBeLessThan(
      positionFor("step-telegram")?.x ?? 0
    );
    expect(
      canvasProjection.edges.filter(
        (edge) =>
          edge.source === "step-condition" && edge.target === "step-telegram"
      )
    ).toHaveLength(1);
    expect(canvasProjection.edges).toContainEqual(
      expect.objectContaining({
        source: "step-condition",
        sourceHandle: "true",
        target: "step-telegram",
      })
    );
  });

  it("uses native catalog action ids when an option updates a committed step", () => {
    const canvasProjection = projectBuilderToCanvas({
      ...projection,
      committed: {
        ...projection.committed,
        nodes: [
          {
            dependsOn: [],
            id: "step-1",
            kind: "read",
            label: "Chronicle: Read ETH/USD Value with Age",
            requiredEntityIds: [],
            status: "ready",
          },
        ],
      },
      options: [
        {
          ...projection.options[0],
          candidateIds: ["native-chronicle/eth-usd-read-with-age"],
          id: "option-chronicle",
          patch: {
            id: "patch-chronicle",
            ops: [
              {
                changes: {
                  label: "Chronicle: Read ETH/USD Value with Age",
                  status: "ready",
                },
                op: "update_step",
                stepId: "step-1",
              },
            ],
            summary: "Use Chronicle",
          },
          stepId: "step-1",
          title: "Chronicle: Read ETH/USD Value with Age",
        },
      ],
    });

    expect(canvasProjection.nodes[0]?.data.config).toMatchObject({
      actionType: "chronicle/eth-usd-read-with-age",
      builderStepKind: "read",
    });
  });

  it("dims inactive option lanes and highlights the focused lane", () => {
    const twoOptionProjection: BuilderProjection = {
      ...projection,
      candidateBranches: [
        {
          ...projection.candidateBranches[0],
          branchId: "branch-1",
          dashedEdges: [{ fromStepId: "step-2", toStepId: "future-1" }],
          optionId: "option-1",
        },
        {
          ...projection.candidateBranches[0],
          branchId: "branch-2",
          dashedEdges: [{ fromStepId: "step-2", toStepId: "future-2" }],
          greyNodes: [
            {
              dependsOn: ["step-2"],
              id: "future-2",
              kind: "notify",
              label: "Future notification 2",
              requiredEntityIds: [],
              status: "planned",
            },
          ],
          optionId: "option-2",
        },
      ],
      committed: {
        ...projection.committed,
        nodes: [
          ...projection.committed.nodes,
          {
            dependsOn: ["step-1"],
            id: "step-2",
            kind: "read",
            label: "Read ETH price",
            requiredEntityIds: [],
            status: "ready",
          },
        ],
      },
      options: [
        {
          ...projection.options[0],
          confidence: 0.6,
          id: "option-1",
          patch: {
            id: "patch-1",
            ops: [
              {
                changes: { label: "Chronicle price", status: "ready" },
                op: "update_step",
                stepId: "step-2",
              },
            ],
            summary: "Use Chronicle",
          },
          stepId: "step-2",
          title: "Chronicle price",
        },
        {
          ...projection.options[0],
          confidence: 0.9,
          id: "option-2",
          patch: {
            id: "patch-2",
            ops: [
              {
                changes: { label: "Chainlink price", status: "ready" },
                op: "update_step",
                stepId: "step-2",
              },
            ],
            summary: "Use Chainlink",
          },
          stepId: "step-2",
          title: "Chainlink price",
        },
      ],
    };

    const defaultProjection = projectBuilderToCanvas(twoOptionProjection);
    expect(
      defaultProjection.nodes.find(
        (node) => node.id === "builder-option-option-1"
      )?.data.config
    ).toMatchObject({ builderHighlighted: false, builderOptionIndex: 1 });
    expect(
      defaultProjection.nodes.find(
        (node) => node.id === "builder-option-option-2"
      )?.data.config
    ).toMatchObject({ builderHighlighted: true, builderOptionIndex: 2 });
    expect(defaultProjection.nodes.some((node) => node.id === "future-1")).toBe(
      true
    );
    expect(defaultProjection.nodes.some((node) => node.id === "future-2")).toBe(
      true
    );
    expect(
      defaultProjection.edges.some((edge) => edge.target === "future-1")
    ).toBe(true);
    expect(
      defaultProjection.edges.some((edge) => edge.target === "future-2")
    ).toBe(true);

    const focusedProjection = projectBuilderToCanvas(twoOptionProjection, {
      highlightedOptionId: "option-1",
    });
    expect(
      focusedProjection.nodes.find(
        (node) => node.id === "builder-option-option-1"
      )?.data.config
    ).toMatchObject({ builderHighlighted: true, builderOptionLane: true });
    expect(
      focusedProjection.edges.find(
        (edge) => edge.target === "builder-option-option-1"
      )?.style
    ).toMatchObject({ opacity: 1, stroke: "var(--primary)" });
    expect(
      focusedProjection.edges.find(
        (edge) => edge.target === "builder-option-option-2"
      )?.style
    ).toMatchObject({ opacity: 0.35, stroke: "var(--border)" });
    expect(focusedProjection.nodes.some((node) => node.id === "future-1")).toBe(
      true
    );
    expect(focusedProjection.nodes.some((node) => node.id === "future-2")).toBe(
      true
    );
    expect(
      focusedProjection.edges.some((edge) => edge.target === "future-1")
    ).toBe(true);
    expect(
      focusedProjection.edges.some((edge) => edge.target === "future-2")
    ).toBe(true);
  });

  it("keeps remaining candidate lanes visible after a selection", () => {
    const selectedProjection: BuilderProjection = {
      ...projection,
      candidateBranches: [
        {
          ...projection.candidateBranches[0],
          branchId: "branch-selected",
          optionId: "option-1",
          status: "selected",
        },
        {
          ...projection.candidateBranches[0],
          branchId: "branch-open",
          dashedEdges: [{ fromStepId: "step-2", toStepId: "future-2" }],
          greyNodes: [
            {
              dependsOn: ["step-2"],
              id: "future-2",
              kind: "notify",
              label: "Remaining preview",
              requiredEntityIds: [],
              status: "planned",
            },
          ],
          optionId: "option-2",
          status: "open",
        },
      ],
      committed: {
        ...projection.committed,
        nodes: [
          ...projection.committed.nodes,
          {
            dependsOn: ["step-1"],
            id: "step-2",
            kind: "read",
            label: "Committed selected option",
            requiredEntityIds: [],
            status: "ready",
          },
        ],
      },
      options: [
        projection.options[0],
        {
          ...projection.options[0],
          id: "option-2",
          stepId: "step-2",
          title: "Remaining option",
        },
      ],
    };

    const restingProjection = projectBuilderToCanvas(selectedProjection);
    expect(
      restingProjection.nodes.some((node) =>
        node.id.startsWith("builder-option-")
      )
    ).toBe(true);
    expect(restingProjection.nodes.some((node) => node.id === "future-2")).toBe(
      true
    );

    const focusedProjection = projectBuilderToCanvas(selectedProjection, {
      highlightedOptionId: "option-2",
    });
    expect(
      focusedProjection.nodes.some(
        (node) => node.id === "builder-option-option-2"
      )
    ).toBe(true);
    expect(focusedProjection.nodes.some((node) => node.id === "future-2")).toBe(
      true
    );
  });

  it("renders numbered options with one recommendation and no cockpit debug labels", () => {
    const tray = renderToStaticMarkup(
      <DecisionTray
        isPlanning={false}
        onAnswerQuestion={vi.fn()}
        onPreviewFocus={vi.fn()}
        onPreviewPin={vi.fn()}
        onReject={vi.fn()}
        onRequestNativeCapability={vi.fn()}
        onSelect={vi.fn()}
        projection={{
          ...projection,
          candidateBranches: [
            ...projection.candidateBranches,
            {
              ...projection.candidateBranches[0],
              branchId: "branch-2",
              optionId: "option-2",
            },
          ],
          options: [
            ...projection.options,
            {
              ...projection.options[0],
              confidence: 0.95,
              id: "option-2",
              title: "Use Chainlink feed",
            },
          ],
        }}
      />
    );

    expect(tray).toContain("1.");
    expect(tray).toContain("2.");
    expect(tray).toContain("Use native price feed");
    expect(tray).toContain("Use Chainlink feed");
    expect(tray.match(/Recommended/g) ?? []).toHaveLength(1);
    expect(tray).toContain("Builder decisions");
    expect(tray).toContain("Select");
    expect(tray).toContain("Reject");
    expect(tray).not.toContain("Grey preview: option-1");
    expect(tray).not.toContain("commit_");
    expect(tray).not.toContain("branch:");
  });

  it("renders streamed planning status while builder decisions are loading", () => {
    const tray = renderToStaticMarkup(
      <DecisionTray
        isPlanning={true}
        onAnswerQuestion={vi.fn()}
        onPreviewFocus={vi.fn()}
        onPreviewPin={vi.fn()}
        onReject={vi.fn()}
        onRequestNativeCapability={vi.fn()}
        onSelect={vi.fn()}
        planningStatusItems={[
          {
            detail: "3 candidate nodes found",
            id: "catalog_search",
            label: "Found matching node candidates",
            status: "completed",
          },
          {
            id: "candidate_evaluation",
            label: "Evaluating candidates against the requirements",
            status: "running",
          },
        ]}
        projection={null}
      />
    );

    expect(tray).toContain("Builder decisions");
    expect(tray).toContain("Found matching node candidates");
    expect(tray).toContain("3 candidate nodes found");
    expect(tray).toContain("Evaluating candidates against the requirements");
  });

  it("groups competing options separately from independent next steps", () => {
    const groupedProjection: BuilderProjection = {
      ...projection,
      candidateBranches: [
        {
          ...projection.candidateBranches[0],
          branchId: "branch-price-1",
          optionId: "option-price-1",
        },
        {
          ...projection.candidateBranches[0],
          branchId: "branch-price-2",
          optionId: "option-price-2",
        },
        {
          ...projection.candidateBranches[0],
          branchId: "branch-telegram",
          optionId: "option-telegram",
        },
      ],
      committed: {
        ...projection.committed,
        nodes: [
          ...projection.committed.nodes,
          {
            dependsOn: ["step-1"],
            id: "step-price",
            kind: "read",
            label: "Check current ETH market price",
            requiredEntityIds: [],
            status: "ready",
          },
          {
            dependsOn: ["step-price"],
            id: "step-notify",
            kind: "notify",
            label: "Send Telegram notification",
            requiredEntityIds: [],
            status: "ready",
          },
        ],
      },
      options: [
        {
          ...projection.options[0],
          confidence: 0.95,
          id: "option-price-1",
          stepId: "step-price",
          title: "Chronicle: Read ETH/USD Value with Age",
        },
        {
          ...projection.options[0],
          confidence: 0.8,
          id: "option-price-2",
          stepId: "step-price",
          title: "Chronicle: Read ETH/USD Value",
        },
        {
          ...projection.options[0],
          confidence: 0.9,
          id: "option-telegram",
          stepId: "step-notify",
          title: "Send Telegram Message",
        },
      ],
    };

    const tray = renderToStaticMarkup(
      <DecisionTray
        isPlanning={false}
        onAnswerQuestion={vi.fn()}
        onPreviewFocus={vi.fn()}
        onPreviewPin={vi.fn()}
        onReject={vi.fn()}
        onRequestNativeCapability={vi.fn()}
        onSelect={vi.fn()}
        projection={groupedProjection}
      />
    );

    expect(tray).toContain("Choose price source");
    expect(tray).toContain("Add notification step");
    expect(tray).toContain("Chronicle: Read ETH/USD Value with Age");
    expect(tray).not.toContain("Send Telegram Message");
    expect(tray.match(/Recommended/g) ?? []).toHaveLength(1);
  });

  it("classifies mixed option labels by the requirement they satisfy", () => {
    const semanticProjection: BuilderProjection = {
      ...projection,
      candidateBranches: [
        {
          ...projection.candidateBranches[0],
          branchId: "branch-price-chronicle",
          optionId: "option-price-chronicle",
        },
        {
          ...projection.candidateBranches[0],
          branchId: "branch-price-chainlink",
          optionId: "option-price-chainlink",
        },
        {
          ...projection.candidateBranches[0],
          branchId: "branch-notification",
          optionId: "option-notification",
        },
        {
          ...projection.candidateBranches[0],
          branchId: "branch-fresh-price",
          optionId: "option-fresh-price",
        },
        {
          ...projection.candidateBranches[0],
          branchId: "branch-keep",
          optionId: "option-keep",
        },
        {
          ...projection.candidateBranches[0],
          branchId: "branch-normalization",
          optionId: "option-normalization",
        },
      ],
      committed: {
        ...projection.committed,
        nodes: [
          ...projection.committed.nodes,
          {
            dependsOn: ["step-1"],
            id: "step-price",
            kind: "read",
            label: "Fetch fresh ETH price every 5 seconds",
            requiredEntityIds: [],
            status: "ready",
          },
          {
            dependsOn: ["step-price"],
            id: "step-notify",
            kind: "notify",
            label: "Send Telegram threshold alert",
            requiredEntityIds: [],
            status: "ready",
          },
        ],
      },
      options: [
        {
          ...projection.options[0],
          confidence: 0.9,
          id: "option-price-chronicle",
          rationale: "Best-fit low-risk option using an accepted ETH/USD feed.",
          stepId: "step-price",
          title: "Use Chronicle for ETH price checks and Telegram alerts",
        },
        {
          ...projection.options[0],
          confidence: 0.8,
          id: "option-price-chainlink",
          rationale: "Fallback ETH/USD feed for alerting.",
          stepId: "step-price",
          title: "Use Chainlink price feed with Telegram alerts",
        },
        {
          ...projection.options[0],
          confidence: 0.85,
          id: "option-fresh-price",
          rationale: "Provides the current answer plus timestamps.",
          stepId: "step-price",
          title: "Use Chainlink latest round data for fresh polling",
        },
        {
          ...projection.options[0],
          confidence: 0.84,
          id: "option-notification",
          rationale: "Directly sends the threshold alert.",
          stepId: "step-notify",
          title: "Send Telegram notification on threshold branch",
        },
        {
          ...projection.options[0],
          confidence: 0.7,
          id: "option-keep",
          rationale: "Preserves and finalizes the existing branch only.",
          stepId: "step-notify",
          title: "Keep the existing Telegram notification branch only",
        },
        {
          ...projection.options[0],
          confidence: 0.65,
          id: "option-normalization",
          rationale: "Normalize oracle output before comparisons.",
          stepId: "step-price",
          title: "Add Chainlink decimals lookup to normalize price handling",
        },
      ],
    };

    const tray = renderToStaticMarkup(
      <DecisionTray
        isPlanning={false}
        onAnswerQuestion={vi.fn()}
        onPreviewFocus={vi.fn()}
        onPreviewPin={vi.fn()}
        onReject={vi.fn()}
        onRequestNativeCapability={vi.fn()}
        onSelect={vi.fn()}
        projection={semanticProjection}
      />
    );

    expect(tray).toContain("builder-option-group-semantic-price");
    expect(tray).toContain("builder-option-group-semantic-notification");
    expect(tray).toContain("builder-option-group-semantic-keep");
    expect(tray).toContain("builder-option-group-semantic-price-normalization");
    expect(tray.indexOf("Choose price source")).toBeLessThan(
      tray.indexOf("Use Chronicle for ETH price checks as the price source")
    );
    expect(tray.indexOf("Choose price source")).toBeLessThan(
      tray.indexOf("Use Chainlink latest round data for fresh polling")
    );
    expect(tray).not.toContain(
      "Send Telegram notification on threshold branch"
    );
    expect(tray).not.toContain(
      "Keep the existing Telegram notification branch only"
    );
    expect(tray).not.toContain("Add Chainlink decimals lookup");
  });

  it("focuses the preview from tabs and the whole option row", async () => {
    const dom = new JSDOM('<div id="root"></div>');
    const globals = globalThis as typeof globalThis & {
      document?: Document;
      Event?: typeof Event;
      FocusEvent?: typeof FocusEvent;
      HTMLElement?: typeof HTMLElement;
      IS_REACT_ACT_ENVIRONMENT?: boolean;
      MouseEvent?: typeof MouseEvent;
      Node?: typeof Node;
      cancelAnimationFrame?: typeof cancelAnimationFrame;
      getComputedStyle?: typeof getComputedStyle;
      requestAnimationFrame?: typeof requestAnimationFrame;
      window?: Window;
    };
    const previous = {
      document: globals.document,
      Event: globals.Event,
      FocusEvent: globals.FocusEvent,
      HTMLElement: globals.HTMLElement,
      IS_REACT_ACT_ENVIRONMENT: globals.IS_REACT_ACT_ENVIRONMENT,
      MouseEvent: globals.MouseEvent,
      Node: globals.Node,
      cancelAnimationFrame: globals.cancelAnimationFrame,
      getComputedStyle: globals.getComputedStyle,
      requestAnimationFrame: globals.requestAnimationFrame,
      window: globals.window,
    };
    globals.window = dom.window;
    globals.document = dom.window.document;
    globals.HTMLElement = dom.window.HTMLElement;
    globals.Node = dom.window.Node;
    globals.Event = dom.window.Event;
    globals.MouseEvent = dom.window.MouseEvent;
    globals.FocusEvent = dom.window.FocusEvent;
    globals.getComputedStyle = dom.window.getComputedStyle.bind(dom.window);
    globals.requestAnimationFrame = (callback) =>
      dom.window.setTimeout(() => callback(Date.now()), 16);
    globals.cancelAnimationFrame = (handle) => dom.window.clearTimeout(handle);
    globals.IS_REACT_ACT_ENVIRONMENT = true;

    const onPreviewFocus = vi.fn();
    const onPreviewPin = vi.fn();
    const rootElement = dom.window.document.getElementById("root");
    expect(rootElement).toBeTruthy();
    const root = createRoot(rootElement as Element);

    try {
      await act(async () => {
        root.render(
          <DecisionTray
            isPlanning={false}
            onAnswerQuestion={vi.fn()}
            onPreviewFocus={onPreviewFocus}
            onPreviewPin={onPreviewPin}
            onReject={vi.fn()}
            onRequestNativeCapability={vi.fn()}
            onSelect={vi.fn()}
            projection={projection}
          />
        );
      });

      await act(async () => {
        root.render(
          <DecisionTray
            isPlanning={false}
            onAnswerQuestion={vi.fn()}
            onPreviewFocus={onPreviewFocus}
            onPreviewPin={onPreviewPin}
            onReject={vi.fn()}
            onRequestNativeCapability={vi.fn()}
            onSelect={vi.fn()}
            projection={{
              ...projection,
              candidateBranches: [
                ...projection.candidateBranches,
                {
                  ...projection.candidateBranches[0],
                  branchId: "branch-notification",
                  optionId: "option-notification",
                },
              ],
              committed: {
                ...projection.committed,
                nodes: [
                  ...projection.committed.nodes,
                  {
                    dependsOn: ["step-1"],
                    id: "step-notify",
                    kind: "notify",
                    label: "Send Telegram alert",
                    requiredEntityIds: [],
                    status: "ready",
                  },
                ],
              },
              options: [
                ...projection.options,
                {
                  ...projection.options[0],
                  confidence: 0.95,
                  id: "option-notification",
                  stepId: "step-notify",
                  title: "Send Telegram Message",
                },
              ],
            }}
          />
        );
      });

      const row = dom.window.document.querySelector(
        '[data-testid="builder-option-option-1"]'
      );
      expect(row).toBeTruthy();
      expect(row?.className).toContain("hover:bg-primary/5");
      expect(row?.className).toContain("focus-within:bg-primary/5");

      await act(async () => {
        row?.dispatchEvent(
          new dom.window.MouseEvent("mouseover", {
            bubbles: true,
            relatedTarget: dom.window.document.body,
          })
        );
      });
      expect(onPreviewFocus).toHaveBeenLastCalledWith("option-1");
      expect(onPreviewPin).not.toHaveBeenCalled();

      await act(async () => {
        row?.dispatchEvent(
          new dom.window.FocusEvent("focusin", {
            bubbles: true,
            relatedTarget: dom.window.document.body,
          })
        );
      });
      expect(onPreviewFocus).toHaveBeenLastCalledWith("option-1");
      expect(onPreviewPin).not.toHaveBeenCalled();

      await act(async () => {
        row?.dispatchEvent(
          new dom.window.MouseEvent("mouseout", {
            bubbles: true,
            relatedTarget: dom.window.document.body,
          })
        );
      });
      expect(onPreviewFocus).toHaveBeenLastCalledWith(null);
      expect(onPreviewPin).not.toHaveBeenCalled();

      await act(async () => {
        row?.dispatchEvent(
          new dom.window.MouseEvent("click", {
            bubbles: true,
            relatedTarget: dom.window.document.body,
          })
        );
      });
      expect(onPreviewPin).toHaveBeenLastCalledWith("option-1");
      expect(row?.className).toContain("bg-primary/10");

      await act(async () => {
        row?.dispatchEvent(
          new dom.window.MouseEvent("mouseout", {
            bubbles: true,
            relatedTarget: dom.window.document.body,
          })
        );
      });
      expect(onPreviewPin).toHaveBeenLastCalledWith("option-1");
      expect(onPreviewFocus).toHaveBeenLastCalledWith("option-1");

      const notificationTab = dom.window.document.querySelector(
        '[data-testid="builder-option-tab-semantic-notification"]'
      );
      expect(notificationTab).toBeTruthy();

      await act(async () => {
        notificationTab?.dispatchEvent(
          new dom.window.MouseEvent("click", { bubbles: true })
        );
      });
      expect(onPreviewPin).toHaveBeenLastCalledWith("option-notification");
    } finally {
      await act(async () => {
        root.unmount();
      });
      await new Promise((resolve) => setTimeout(resolve, 0));
      globals.window = previous.window;
      globals.document = previous.document;
      globals.HTMLElement = previous.HTMLElement;
      globals.Node = previous.Node;
      globals.Event = previous.Event;
      globals.MouseEvent = previous.MouseEvent;
      globals.FocusEvent = previous.FocusEvent;
      globals.getComputedStyle = previous.getComputedStyle;
      globals.requestAnimationFrame = previous.requestAnimationFrame;
      globals.cancelAnimationFrame = previous.cancelAnimationFrame;
      globals.IS_REACT_ACT_ENVIRONMENT = previous.IS_REACT_ACT_ENVIRONMENT;
    }
  });

  it("hides selected or rejected options from the decision tray", () => {
    const tray = renderToStaticMarkup(
      <DecisionTray
        isPlanning={false}
        onAnswerQuestion={vi.fn()}
        onPreviewFocus={vi.fn()}
        onPreviewPin={vi.fn()}
        onReject={vi.fn()}
        onRequestNativeCapability={vi.fn()}
        onSelect={vi.fn()}
        projection={{
          ...projection,
          candidateBranches: [
            {
              ...projection.candidateBranches[0],
              status: "rejected",
            },
          ],
        }}
      />
    );

    expect(tray).not.toContain("Use native price feed");
    expect(tray).not.toContain("Suggested next step");
  });

  it("removes temporary preview edges from persisted builder graph output", () => {
    const persisted = filterBuilderPreviewGraph({
      edges: [
        {
          id: "preview-option-1-step-1-step-2",
          source: "step-1",
          target: "step-2",
          type: "temporary",
        },
        {
          id: "accepted-step-1-step-2",
          source: "step-1",
          target: "step-2",
          type: "animated",
        },
      ],
      nodes: [
        {
          data: {
            config: {},
            label: "Start",
            type: "trigger",
          },
          id: "step-1",
          position: { x: 0, y: 0 },
          type: "trigger",
        },
        {
          data: {
            config: {},
            label: "Read",
            type: "action",
          },
          id: "step-2",
          position: { x: 360, y: 0 },
          type: "action",
        },
      ],
    });

    expect(persisted.edges).toEqual([
      expect.objectContaining({ id: "accepted-step-1-step-2" }),
    ]);
  });

  it("hides the decision tray after planning completes with no active decisions", () => {
    const tray = renderToStaticMarkup(
      <DecisionTray
        isPlanning={false}
        onAnswerQuestion={vi.fn()}
        onPreviewFocus={vi.fn()}
        onPreviewPin={vi.fn()}
        onReject={vi.fn()}
        onRequestNativeCapability={vi.fn()}
        onSelect={vi.fn()}
        projection={{
          ...projection,
          candidateBranches: [
            {
              ...projection.candidateBranches[0],
              status: "selected",
            },
          ],
          questions: [
            {
              answer: "Slack",
              answerType: "single_choice",
              choices: ["Slack", "Email", "Telegram"],
              id: "question-notification-channel",
              prompt: "Which notification channel should be used?",
              status: "answered",
              stepId: "step-notify",
            },
          ],
        }}
      />
    );

    expect(tray).toBe("");
  });
});
