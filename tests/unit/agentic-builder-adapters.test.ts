import type { IntentPlan } from "@keeperhub/agentic-builder/schemas";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { state } = vi.hoisted(() => ({
  state: {
    actions: [] as Array<{
      configFields: unknown[];
      description: string;
      id: string;
      integration?: string;
      label: string;
      outputFields?: Array<{ field: string }>;
      requiresCredentials?: boolean;
      slug?: string;
      stepFunction?: string;
      stepImportPath?: string;
    }>,
    materializations: [] as Array<Record<string, unknown>>,
    workflows: [] as Array<Record<string, unknown>>,
  },
}));

vi.mock("@/plugins/registry", () => ({
  flattenConfigFields: (fields: unknown[]) => fields,
  getAllActions: () => state.actions,
}));

vi.mock("@/lib/protocol-registry", () => ({
  getRegisteredProtocols: () => [
    {
      actions: [
        {
          description: "Read ETH price from Chainlink",
          inputs: [{ name: "asset", required: true }],
          label: "ETH/USD price feed",
          outputs: [{ name: "price" }],
          slug: "eth-usd-price",
          type: "read",
        },
      ],
      description: "Oracle protocol",
      name: "Chainlink",
      slug: "chainlink",
    },
  ],
}));

vi.mock("drizzle-orm", () => ({
  and: (...args: unknown[]) => ({ args, type: "and" }),
  desc: (column: unknown) => ({ column, type: "desc" }),
  eq: (column: unknown, value: unknown) => ({ column, type: "eq", value }),
}));

vi.mock("@/lib/db/schema", () => ({
  builderMaterializations: {
    __name: "builder_materializations",
    idempotencyKey: "idempotency_key",
    inputHash: "input_hash",
    organizationId: "organization_id",
    revision: "revision",
    sessionId: "session_id",
    workflowId: "workflow_id",
  },
  workflows: {
    __name: "workflows",
    description: "description",
    edges: "edges",
    id: "id",
    isAnonymous: "is_anonymous",
    isListed: "is_listed",
    listedAt: "listed_at",
    name: "name",
    nodes: "nodes",
    organizationId: "organization_id",
    updatedAt: "updated_at",
    userId: "user_id",
  },
}));

vi.mock("@/lib/db", () => ({
  db: {
    insert: (table: unknown) => ({
      values: (row: Record<string, unknown>) => ({
        onConflictDoNothing: async () => {
          if (table === "workflows" || "name" in row) {
            if (!state.workflows.some((workflow) => workflow.id === row.id)) {
              state.workflows.push(row);
            }
            return;
          }
          const duplicate = state.materializations.some(
            (materialization) =>
              materialization.organizationId === row.organizationId &&
              materialization.sessionId === row.sessionId &&
              materialization.idempotencyKey === row.idempotencyKey &&
              materialization.inputHash === row.inputHash
          );
          if (!duplicate) {
            state.materializations.push(row);
          }
        },
      }),
    }),
    select: () => ({
      from: (table: unknown) => ({
        orderBy: () => ({
          limit: async () =>
            state.workflows.map((workflow) => ({
              description: workflow.description,
              id: workflow.id,
              name: workflow.name,
            })),
        }),
        where: () => ({
          limit: async () =>
            table &&
            typeof table === "object" &&
            "__name" in table &&
            table.__name === "builder_materializations"
              ? state.materializations.slice(0, 1)
              : state.workflows.slice(0, 1),
          orderBy: () => ({
            limit: async () =>
              state.workflows.map((workflow) => ({
                description: workflow.description,
                id: workflow.id,
                name: workflow.name,
              })),
          }),
        }),
      }),
    }),
    update: () => ({
      set: () => ({ where: async () => undefined }),
    }),
  },
}));

describe("agentic builder KeeperHub adapters", () => {
  beforeEach(() => {
    state.actions = Array.from({ length: 12 }, (_, index) => ({
      configFields: [],
      description: `Action ${index} reads ETH price or sends notification`,
      id: `action-${index}`,
      integration: "native",
      label: `Action ${index}`,
      outputFields: [{ field: "result" }],
      slug: `action-${index}`,
      stepFunction: `action${index}Step`,
      stepImportPath: `action-${index}`,
    }));
    state.actions.push({
      configFields: [],
      description: "Read ETH price from Chainlink",
      id: "chainlink/eth-usd-price",
      integration: "chainlink",
      label: "Chainlink: ETH/USD price feed",
      outputFields: [{ field: "price" }],
      slug: "eth-usd-price",
      stepFunction: "protocolReadStep",
      stepImportPath: "protocol-read",
    });
    state.workflows = [
      {
        description: "Reusable ETH price alert workflow",
        id: "workflow-listed-1",
        name: "ETH price alert",
      },
    ];
    state.materializations = [];
  });

  it("builds catalog candidates from the full plugin registry and listed workflows", async () => {
    const { searchKeeperHubCatalog } = await import(
      "@/lib/agentic-builder/keeperhub-catalog"
    );
    const intentPlan: IntentPlan = {
      entities: [
        {
          canonicalValue: "ETH",
          confidence: 0.9,
          id: "entity-eth",
          kind: "asset",
          label: "ETH",
        },
      ],
      id: "intent-1",
      openQuestionIds: [],
      sourceText: "Track ETH price",
      steps: [],
    };

    const candidates = await searchKeeperHubCatalog(intentPlan);

    expect(
      candidates.filter((candidate) => candidate.provider === "native")
    ).toHaveLength(12);
    expect(
      candidates.some((candidate) => candidate.id === "workflow-listed-1")
    ).toBe(false);
    expect(
      candidates.some(
        (candidate) => candidate.id === "workflow-workflow-listed-1"
      )
    ).toBe(true);
    expect(
      candidates.some((candidate) => candidate.provider === "protocol")
    ).toBe(true);
    expect(
      candidates.find(
        (candidate) => candidate.id === "native-chainlink/eth-usd-price"
      )?.capability
    ).toMatchObject({
      assetPair: { base: "ETH", quote: "USD" },
      kind: "price_feed",
    });
  });

  it("infers catalog metadata for price feeds and native plugin families", async () => {
    const { inferCatalogCandidateCapability } = await import(
      "@/lib/agentic-builder/keeperhub-catalog"
    );
    const capabilityFor = (id: string, label: string, description = label) =>
      inferCatalogCandidateCapability({
        credentialsAvailable: true,
        description,
        id,
        label,
        outputFields: ["result"],
        provider: id.startsWith("protocol-") ? "protocol" : "native",
        requiredInputs: [],
        score: 0.9,
      });

    expect(
      capabilityFor(
        "protocol-chronicle-eth-usd-read-with-age",
        "Chronicle ETH/USD"
      )
    ).toMatchObject({
      assetPair: { base: "ETH", quote: "USD" },
      kind: "price_feed",
    });
    expect(
      capabilityFor(
        "protocol-chainlink-btc-usd-latest-round-data",
        "Chainlink BTC/USD"
      )
    ).toMatchObject({
      assetPair: { base: "BTC", quote: "USD" },
      kind: "price_feed",
    });
    expect(
      capabilityFor("native-slack/send-message", "Send Slack Message")
    ).toMatchObject({ kind: "notification", provider: "slack" });
    expect(
      capabilityFor("native-sendgrid/send-email", "Send Email via SendGrid")
    ).toMatchObject({ contentKind: "email", provider: "sendgrid" });
    expect(
      capabilityFor("native-webhook/send-webhook", "Send Webhook")
    ).toMatchObject({ kind: "http_request", provider: "webhook" });
    expect(capabilityFor("native-code/run-code", "Run Code")).toMatchObject({
      kind: "code_execution",
      provider: "code",
    });
    expect(capabilityFor("native-math/aggregate", "Aggregate")).toMatchObject({
      kind: "numeric_aggregate",
      provider: "math",
    });
    expect(
      capabilityFor("native-clerk/delete-user", "Delete User from Clerk")
    ).toMatchObject({ destructive: true, provider: "clerk" });
    expect(
      capabilityFor("native-webflow/publish-site", "Publish Site in Webflow")
    ).toMatchObject({ operation: "publish", provider: "webflow" });
    expect(
      capabilityFor("native-ai-gateway/generate-image", "Generate Image")
    ).toMatchObject({ contentKind: "image", provider: "ai-gateway" });
    expect(
      capabilityFor("native-v0/create-chat", "Create Chat in v0")
    ).toMatchObject({ kind: "ui_generation", provider: "v0" });
    expect(
      capabilityFor(
        "native-safe/get-pending-transactions",
        "Safe Pending Transactions"
      )
    ).toMatchObject({ kind: "safe_multisig", provider: "safe" });
    expect(
      capabilityFor(
        "native-web3/transfer-native-token",
        "Transfer Native Token"
      )
    ).toMatchObject({ destructive: true, kind: "wallet_write" });
  });

  it("persists idempotent create materializations without duplicate workflows", async () => {
    const { createKeeperHubWorkflowMaterializer } = await import(
      "@/lib/agentic-builder/keeperhub-materializer"
    );
    const materializer = createKeeperHubWorkflowMaterializer();
    const input = {
      auth: {
        actorType: "user" as const,
        organizationId: "org-1",
        scopes: ["builder:write"],
        userId: "user-1",
      },
      idempotencyKey: "idem-1",
      mode: "create" as const,
      name: "ETH alert",
      projection: {
        candidateBranches: [],
        committed: {
          edges: [],
          id: "session-1",
          nodes: [
            {
              dependsOn: [],
              id: "step-1",
              kind: "trigger" as const,
              label: "Run every 15 minutes",
              requiredEntityIds: [],
              status: "ready" as const,
            },
            {
              dependsOn: ["step-1"],
              id: "step-2",
              kind: "notify" as const,
              label: "Send notification",
              requiredEntityIds: [],
              status: "ready" as const,
            },
          ],
        },
        headCommitId: "commit-1",
        options: [],
        questions: [],
        sessionId: "session-1",
        timeline: [],
        validation: { issues: [], valid: true },
      },
      session: { id: "session-1" },
    };

    const first = await materializer.materialize(input as never);
    const second = await materializer.materialize(input as never);

    expect(first.workflowId).toBe(second.workflowId);
    expect(
      state.workflows.filter((workflow) =>
        String(workflow.id).startsWith("builder-")
      )
    ).toHaveLength(1);
    expect(state.materializations).toHaveLength(1);
    const generatedWorkflow = state.workflows.find((workflow) =>
      String(workflow.id).startsWith("builder-")
    );
    expect(generatedWorkflow?.nodes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          data: expect.objectContaining({
            config: { triggerType: "Schedule" },
            label: "Run every 15 minutes",
            type: "trigger",
          }),
        }),
        expect.objectContaining({
          data: expect.objectContaining({
            config: expect.objectContaining({ actionType: "Send Email" }),
            label: "Send notification",
            type: "action",
          }),
        }),
      ])
    );
  });
});
