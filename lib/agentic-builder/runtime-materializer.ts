import type { BuilderProjection } from "@keeperhub/agentic-builder/schemas";
import {
  type BuilderCanvasProjection,
  filterBuilderPreviewGraph,
  projectBuilderToCanvas,
} from "@/lib/agentic-builder/canvas-projection";
import { sanitizeWorkflowData } from "@/lib/workflow/sanitize-nodes";
import type { WorkflowEdge, WorkflowNode } from "@/lib/workflow-store";
import { findActionById } from "@/plugins/registry";

const BUILDER_RUNTIME_METADATA_KEYS = new Set([
  "builderConditionNeedsAnswer",
  "builderHighlighted",
  "builderOptionIndex",
  "builderOptionLane",
  "builderPreview",
  "builderPreviewOptionId",
  "builderStepKind",
]);

export type RuntimeMaterializedWorkflowGraph = {
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
};

type WebhookPriceLoopIntent = {
  asset: string;
  quote: string;
  intervalSeconds: number;
  repeatCount: number;
  webhookUrl: string;
};

function extractFirstUrl(text: string): string | undefined {
  return /\bhttps?:\/\/[^\s"'<>),]+/i.exec(text)?.[0];
}

function extractNumber(text: string, pattern: RegExp): number | undefined {
  const match = pattern.exec(text);
  return match?.[1] ? Number(match[1]) : undefined;
}

function extractAssetQuote(text: string): { asset: string; quote: string } {
  const intentText = text.replace(/\bhttps?:\/\/\S+/gi, " ");
  const pairMatch = /\b([A-Z]{2,12})\s*\/\s*([A-Z]{2,12})\b/i.exec(intentText);
  if (pairMatch?.[1] && pairMatch[2]) {
    return {
      asset: pairMatch[1].toUpperCase(),
      quote: pairMatch[2].toUpperCase(),
    };
  }

  const assetMatch =
    /\b(?:price\s+of|price\s+for|check\s+(?:the\s+)?price\s+of)\s+([a-z0-9]{2,12})\b/i.exec(
      intentText
    ) ?? /\b(eth|btc|sol|usdc|dai)\b/i.exec(intentText);
  const quoteMatch = /\b(?:in|to|against)\s+(usd|usdc|dai|eur)\b/i.exec(
    intentText
  );
  return {
    asset: (assetMatch?.[1] ?? "ETH").toUpperCase(),
    quote: (quoteMatch?.[1] ?? "USD").toUpperCase(),
  };
}

function webhookPriceLoopIntentFromText(
  sourceText?: string
): WebhookPriceLoopIntent | null {
  if (!sourceText) {
    return null;
  }
  const normalized = sourceText.toLowerCase();
  if (
    !(
      normalized.includes("webhook") &&
      /\bprice\b/.test(normalized) &&
      /\b(?:every|repeat|times?)\b/.test(normalized)
    )
  ) {
    return null;
  }

  const webhookUrl = extractFirstUrl(sourceText);
  if (!webhookUrl) {
    return null;
  }

  const { asset, quote } = extractAssetQuote(sourceText);
  return {
    asset,
    quote,
    intervalSeconds:
      extractNumber(sourceText, /\bevery\s+(\d+)\s+seconds?\b/i) ?? 0,
    repeatCount:
      extractNumber(
        sourceText,
        /\b(?:for|do\s+that\s+for|run\s+for)\s+(\d+)\s+times?\b/i
      ) ??
      extractNumber(sourceText, /\b(\d+)\s+times?\b/i) ??
      1,
    webhookUrl,
  };
}

function node(
  id: string,
  label: string,
  type: "trigger" | "action",
  position: { x: number; y: number },
  config: Record<string, unknown>
): WorkflowNode {
  return {
    id,
    data: {
      config,
      enabled: true,
      label,
      status: "idle",
      type,
    },
    position,
    type,
  };
}

function priceLoopCode({
  asset,
  intervalSeconds,
  quote,
}: Pick<
  WebhookPriceLoopIntent,
  "asset" | "intervalSeconds" | "quote"
>): string {
  const pair = `${asset}-${quote}`;
  const delayMs = Math.max(0, intervalSeconds) * 1000;
  return [
    "const iteration = {{@repeat-price-checks:Repeat price checks.index}} + 1;",
    "const total = {{@repeat-price-checks:Repeat price checks.totalItems}};",
    `const delayMs = ${delayMs};`,
    "if (iteration > 1 && delayMs > 0) {",
    "  await new Promise((resolve) => setTimeout(resolve, delayMs));",
    "}",
    `const response = await fetch("https://api.coinbase.com/v2/prices/${pair}/spot");`,
    "if (!response.ok) {",
    "  throw new Error('Price request failed with HTTP ' + response.status);",
    "}",
    "const json = await response.json();",
    "const rawPrice = json && json.data ? json.data.amount : null;",
    "const price = rawPrice === null ? null : Number(rawPrice);",
    `const message = "${asset}/${quote} price check " + iteration + "/" + total + ": " + (price === null ? "price unavailable" : "${quote} " + price);`,
    "return { message };",
  ].join("\n");
}

function materializeWebhookPriceLoop(
  intent: WebhookPriceLoopIntent
): RuntimeMaterializedWorkflowGraph {
  const formatPayloadLabel = `Fetch ${intent.asset}/${intent.quote} price and format webhook payload`;
  const nodes: WorkflowNode[] = [
    node(
      "manual-trigger",
      `Run ${intent.asset}/${intent.quote} price checks`,
      "trigger",
      { x: 0, y: 120 },
      { triggerType: "Manual" }
    ),
    node(
      "repeat-price-checks",
      `Repeat ${intent.repeatCount} price checks`,
      "action",
      { x: 320, y: 120 },
      {
        actionType: "For Each",
        arraySource: JSON.stringify(
          Array.from({ length: intent.repeatCount }, (_, index) => index + 1)
        ),
        concurrency: "sequential",
        maxIterations: intent.repeatCount,
      }
    ),
    node(
      "format-webhook-payload",
      formatPayloadLabel,
      "action",
      { x: 660, y: 120 },
      {
        actionType: "code/run-code",
        code: priceLoopCode(intent),
        timeout: Math.max(60, intent.intervalSeconds + 30),
      }
    ),
    node(
      "send-webhook-update",
      "Send price update to webhook",
      "action",
      { x: 1000, y: 120 },
      {
        actionType: "webhook/send-webhook",
        webhookHeaders: JSON.stringify({ "Content-Type": "application/json" }),
        webhookMethod: "POST",
        webhookPayload: `{{@format-webhook-payload:${formatPayloadLabel}.result}}`,
        webhookUrl: intent.webhookUrl,
      }
    ),
  ];
  const edges: WorkflowEdge[] = [
    {
      id: "edge-manual-trigger-repeat-price-checks",
      source: "manual-trigger",
      target: "repeat-price-checks",
      type: "animated",
    },
    {
      id: "edge-repeat-price-checks-format-webhook-payload",
      source: "repeat-price-checks",
      target: "format-webhook-payload",
      type: "animated",
    },
    {
      id: "edge-format-webhook-payload-send-webhook-update",
      source: "format-webhook-payload",
      target: "send-webhook-update",
      type: "animated",
    },
  ];

  return sanitizeWorkflowData(nodes, edges) as RuntimeMaterializedWorkflowGraph;
}

function runtimeConfigForNode(node: WorkflowNode): Record<string, unknown> {
  const config = node.data.config ?? {};
  const runtimeConfig = Object.fromEntries(
    Object.entries(config).filter(
      ([key]) => !BUILDER_RUNTIME_METADATA_KEYS.has(key)
    )
  );
  const actionType = runtimeConfig.actionType;
  if (typeof actionType === "string") {
    const action = findActionById(actionType);
    if (action) {
      runtimeConfig.actionType = action.id;
    }
  }
  return runtimeConfig;
}

function runtimeNodeForCanvasNode(node: WorkflowNode): WorkflowNode {
  return {
    ...node,
    data: {
      ...node.data,
      config: runtimeConfigForNode(node),
      status: "idle",
    },
    selected: false,
  };
}

export function materializeBuilderCanvasGraphToRuntime({
  edges,
  nodes,
}: BuilderCanvasProjection): RuntimeMaterializedWorkflowGraph {
  const runtimeGraph = {
    edges,
    nodes: nodes.map(runtimeNodeForCanvasNode),
  };
  return sanitizeWorkflowData(
    runtimeGraph.nodes,
    runtimeGraph.edges
  ) as RuntimeMaterializedWorkflowGraph;
}

export function materializeBuilderProjectionToRuntime(
  projection: BuilderProjection,
  options: { sourceText?: string } = {}
): RuntimeMaterializedWorkflowGraph {
  const webhookPriceLoopIntent = webhookPriceLoopIntentFromText(
    options.sourceText
  );
  if (webhookPriceLoopIntent) {
    return materializeWebhookPriceLoop(webhookPriceLoopIntent);
  }

  return materializeBuilderCanvasGraphToRuntime(
    filterBuilderPreviewGraph(
      projectBuilderToCanvas(projection, { sourceText: options.sourceText })
    )
  );
}
