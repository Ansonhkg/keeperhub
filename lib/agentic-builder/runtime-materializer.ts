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

type StatefulPriceDeltaIntent = WebhookPriceLoopIntent & {
  threshold: number;
};

type BuilderRuntimeTraceMetadata = {
  builderSessionId: string;
  sourcePrompt?: string;
  selectedOptionIds: string[];
  selectedCandidateIds: string[];
  openQuestionCount: number;
  validationIssueCount: number;
  materializer: string;
};

function extractFirstUrl(text: string): string | undefined {
  return /\bhttps?:\/\/[^\s"'<>),]+/i.exec(text)?.[0];
}

function extractNumber(text: string, pattern: RegExp): number | undefined {
  const match = pattern.exec(text);
  return match?.[1] ? Number(match[1]) : undefined;
}

function extractCount(text: string): number | undefined {
  const numeric =
    extractNumber(
      text,
      /\b(?:for|do\s+that\s+for|run\s+for)\s+(\d+)\s+times?\b/i
    ) ?? extractNumber(text, /\b(\d+)\s+times?\b/i);
  if (numeric !== undefined) {
    return numeric;
  }
  const wordMatch =
    /\b(?:for|do\s+that\s+for|run\s+for|do\s+this)\s+(one|two|three|four|five|six|seven|eight|nine|ten)\s+times?\b/i.exec(
      text
    ) ??
    /\b(one|two|three|four|five|six|seven|eight|nine|ten)\s+times?\b/i.exec(
      text
    );
  const word = wordMatch?.[1]?.toLowerCase();
  if (!word) {
    return undefined;
  }
  return {
    eight: 8,
    five: 5,
    four: 4,
    nine: 9,
    one: 1,
    seven: 7,
    six: 6,
    ten: 10,
    three: 3,
    two: 2,
  }[word];
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
    repeatCount: extractCount(sourceText) ?? 1,
    webhookUrl,
  };
}

function statefulPriceDeltaIntentFromText(
  sourceText?: string
): StatefulPriceDeltaIntent | null {
  if (!sourceText) {
    return null;
  }
  const normalized = sourceText.toLowerCase();
  if (
    !(
      normalized.includes("webhook") &&
      /\b(?:cache|cached|baseline|constant|reference)\b/.test(normalized) &&
      /\b(?:fresh|current|get|check)\b/.test(normalized) &&
      /\b(?:moves?|changes?|delta|difference)\b/.test(normalized)
    )
  ) {
    return null;
  }
  const webhookUrl = extractFirstUrl(sourceText);
  if (!webhookUrl) {
    return null;
  }
  const threshold =
    extractNumber(
      sourceText,
      /\b(?:moves?|changes?|delta|difference)\s+(?:by\s+)?\$?(\d+(?:\.\d+)?)\b/i
    ) ??
    extractNumber(sourceText, /\$([0-9]+(?:\.[0-9]+)?)\b/) ??
    0;
  if (threshold <= 0) {
    return null;
  }
  const { asset, quote } = extractAssetQuote(sourceText);
  return {
    asset,
    quote,
    intervalSeconds:
      extractNumber(sourceText, /\bevery\s+(\d+)\s+seconds?\b/i) ?? 0,
    repeatCount:
      extractCount(sourceText) ??
      extractNumber(sourceText, /\bfor\s+(\d+)\s+checks?\b/i) ??
      1,
    threshold,
    webhookUrl,
  };
}

function simpleWebhookIntentFromText(
  sourceText?: string
): { message: string; webhookUrl: string } | null {
  if (!sourceText) {
    return null;
  }
  const normalized = sourceText.toLowerCase();
  if (!(normalized.includes("webhook") && extractFirstUrl(sourceText))) {
    return null;
  }
  if (/\bprice\b|\bevery\b|\brepeat\b|\btimes?\b/.test(normalized)) {
    return null;
  }
  const message =
    /\bmessage\s+["“]([^"”]+)["”]/i.exec(sourceText)?.[1] ??
    /\bwith\s+message\s+(.+?)(?:\.|$)/i.exec(sourceText)?.[1]?.trim() ??
    "KeeperHub webhook notification";
  return {
    message,
    webhookUrl: extractFirstUrl(sourceText) ?? "",
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

function priceFetchCode(asset: string, quote: string): string {
  const pair = `${asset}-${quote}`;
  return [
    `const response = await fetch("https://api.coinbase.com/v2/prices/${pair}/spot");`,
    "if (!response.ok) {",
    "  throw new Error('Price request failed with HTTP ' + response.status);",
    "}",
    "const json = await response.json();",
    "const rawPrice = json && json.data ? json.data.amount : null;",
    "const price = rawPrice === null ? null : Number(rawPrice);",
    "if (!Number.isFinite(price)) {",
    "  throw new Error('Price response did not include a numeric amount');",
    "}",
    `return { asset: "${asset}", quote: "${quote}", price };`,
  ].join("\n");
}

function comparePriceDeltaCode(intent: StatefulPriceDeltaIntent): string {
  const pair = `${intent.asset}-${intent.quote}`;
  const delayMs = Math.max(0, intent.intervalSeconds) * 1000;
  return [
    "const iteration = {{@repeat-fresh-price-checks:Repeat fresh price checks.index}} + 1;",
    "const total = {{@repeat-fresh-price-checks:Repeat fresh price checks.totalItems}};",
    `const delayMs = ${delayMs};`,
    "if (iteration > 1 && delayMs > 0) {",
    "  await new Promise((resolve) => setTimeout(resolve, delayMs));",
    "}",
    "const baseline = Number({{@read-baseline-price:Read baseline ETH/USD price.result.price}});",
    `const response = await fetch("https://api.coinbase.com/v2/prices/${pair}/spot");`,
    "if (!response.ok) {",
    "  throw new Error('Fresh price request failed with HTTP ' + response.status);",
    "}",
    "const json = await response.json();",
    "const rawPrice = json && json.data ? json.data.amount : null;",
    "const fresh = rawPrice === null ? null : Number(rawPrice);",
    "if (!Number.isFinite(fresh)) {",
    "  throw new Error('Fresh price response did not include a numeric amount');",
    "}",
    "const delta = Math.abs(fresh - baseline);",
    `const moved = delta >= ${intent.threshold};`,
    `const message = "${intent.asset}/${intent.quote} moved $" + delta.toFixed(4) + " from cached baseline " + baseline + " to " + fresh + " on check " + iteration + "/" + total;`,
    "return { baseline, delta, fresh, iteration, message, moved, total };",
  ].join("\n");
}

function materializeStatefulPriceDelta(
  intent: StatefulPriceDeltaIntent
): RuntimeMaterializedWorkflowGraph {
  const nodes: WorkflowNode[] = [
    node(
      "manual-trigger",
      "Run stateful ETH price monitor",
      "trigger",
      { x: 0, y: 120 },
      { triggerType: "Manual" }
    ),
    node(
      "read-baseline-price",
      `Read baseline ${intent.asset}/${intent.quote} price`,
      "action",
      { x: 320, y: 120 },
      {
        actionType: "code/run-code",
        code: priceFetchCode(intent.asset, intent.quote),
        timeout: 60,
      }
    ),
    node(
      "repeat-fresh-price-checks",
      "Repeat fresh price checks",
      "action",
      { x: 660, y: 120 },
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
      "compare-fresh-price",
      `Compare fresh ${intent.asset}/${intent.quote} price to cached baseline`,
      "action",
      { x: 1000, y: 120 },
      {
        actionType: "code/run-code",
        code: comparePriceDeltaCode(intent),
        timeout: Math.max(60, intent.intervalSeconds + 30),
      }
    ),
    node(
      "price-delta-condition",
      `Check whether ${intent.asset}/${intent.quote} moved by at least $${intent.threshold}`,
      "action",
      { x: 1340, y: 120 },
      {
        actionType: "Condition",
        condition:
          "{{@compare-fresh-price:Compare fresh ETH/USD price to cached baseline.result.moved}} === true",
      }
    ),
    node(
      "send-threshold-webhook",
      "Send threshold alert to webhook",
      "action",
      { x: 1680, y: 20 },
      {
        actionType: "webhook/send-webhook",
        webhookHeaders: JSON.stringify({ "Content-Type": "application/json" }),
        webhookMethod: "POST",
        webhookPayload:
          "{{@compare-fresh-price:Compare fresh ETH/USD price to cached baseline.result}}",
        webhookUrl: intent.webhookUrl,
      }
    ),
    node(
      "log-below-threshold",
      "Log price check below threshold",
      "action",
      { x: 1680, y: 220 },
      {
        actionType: "code/run-code",
        code: "return { logged: true, reason: 'ETH price delta was below the configured threshold' };",
        timeout: 30,
      }
    ),
  ];
  const edges: WorkflowEdge[] = [
    {
      id: "edge-manual-trigger-read-baseline-price",
      source: "manual-trigger",
      target: "read-baseline-price",
      type: "animated",
    },
    {
      id: "edge-read-baseline-price-repeat-fresh-price-checks",
      source: "read-baseline-price",
      target: "repeat-fresh-price-checks",
      type: "animated",
    },
    {
      id: "edge-repeat-fresh-price-checks-compare-fresh-price",
      source: "repeat-fresh-price-checks",
      target: "compare-fresh-price",
      type: "animated",
    },
    {
      id: "edge-compare-fresh-price-price-delta-condition",
      source: "compare-fresh-price",
      target: "price-delta-condition",
      type: "animated",
    },
    {
      id: "edge-price-delta-condition-send-threshold-webhook",
      source: "price-delta-condition",
      sourceHandle: "true",
      target: "send-threshold-webhook",
      type: "animated",
    },
    {
      id: "edge-price-delta-condition-log-below-threshold",
      source: "price-delta-condition",
      sourceHandle: "false",
      target: "log-below-threshold",
      type: "animated",
    },
  ];

  return sanitizeWorkflowData(nodes, edges) as RuntimeMaterializedWorkflowGraph;
}

function materializeSimpleWebhook({
  message,
  webhookUrl,
}: {
  message: string;
  webhookUrl: string;
}): RuntimeMaterializedWorkflowGraph {
  const nodes: WorkflowNode[] = [
    node(
      "manual-trigger",
      "Run webhook notification",
      "trigger",
      { x: 0, y: 120 },
      { triggerType: "Manual" }
    ),
    node(
      "send-webhook-notification",
      "Send webhook notification",
      "action",
      { x: 340, y: 120 },
      {
        actionType: "webhook/send-webhook",
        webhookHeaders: JSON.stringify({ "Content-Type": "application/json" }),
        webhookMethod: "POST",
        webhookPayload: JSON.stringify({ message }),
        webhookUrl,
      }
    ),
  ];
  const edges: WorkflowEdge[] = [
    {
      id: "edge-manual-trigger-send-webhook-notification",
      source: "manual-trigger",
      target: "send-webhook-notification",
      type: "animated",
    },
  ];
  return sanitizeWorkflowData(nodes, edges) as RuntimeMaterializedWorkflowGraph;
}

function builderTraceMetadata(
  projection: BuilderProjection,
  sourceText: string | undefined,
  materializer: string
): BuilderRuntimeTraceMetadata {
  const selectedBranches = projection.candidateBranches.filter(
    (branch) => branch.status === "selected"
  );
  const selectedOptionIds = selectedBranches.map((branch) => branch.optionId);
  const selectedCandidateIds = projection.options
    .filter((option) => selectedOptionIds.includes(option.id))
    .flatMap((option) => option.candidateIds);
  return {
    builderSessionId: projection.sessionId,
    materializer,
    openQuestionCount: projection.questions.filter(
      (question) => question.status === "open"
    ).length,
    selectedCandidateIds: [...new Set(selectedCandidateIds)],
    selectedOptionIds,
    sourcePrompt: sourceText,
    validationIssueCount: projection.validation.issues.filter(
      (issue) => issue.severity === "error"
    ).length,
  };
}

function withBuilderTraceMetadata(
  graph: RuntimeMaterializedWorkflowGraph,
  metadata: BuilderRuntimeTraceMetadata
): RuntimeMaterializedWorkflowGraph {
  return {
    edges: graph.edges,
    nodes: graph.nodes.map((runtimeNode) => ({
      ...runtimeNode,
      data: {
        ...runtimeNode.data,
        config: {
          ...(runtimeNode.data.config ?? {}),
          builderTrace: metadata,
        },
      },
    })),
  };
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
  const statefulPriceDeltaIntent = statefulPriceDeltaIntentFromText(
    options.sourceText
  );
  if (statefulPriceDeltaIntent) {
    return withBuilderTraceMetadata(
      materializeStatefulPriceDelta(statefulPriceDeltaIntent),
      builderTraceMetadata(
        projection,
        options.sourceText,
        "intent-ir-stateful-price-delta"
      )
    );
  }

  const webhookPriceLoopIntent = webhookPriceLoopIntentFromText(
    options.sourceText
  );
  if (webhookPriceLoopIntent) {
    return withBuilderTraceMetadata(
      materializeWebhookPriceLoop(webhookPriceLoopIntent),
      builderTraceMetadata(
        projection,
        options.sourceText,
        "intent-ir-webhook-price-loop"
      )
    );
  }

  const simpleWebhookIntent = simpleWebhookIntentFromText(options.sourceText);
  if (simpleWebhookIntent && projection.committed.nodes.length <= 1) {
    return withBuilderTraceMetadata(
      materializeSimpleWebhook(simpleWebhookIntent),
      builderTraceMetadata(
        projection,
        options.sourceText,
        "intent-ir-simple-webhook"
      )
    );
  }

  return withBuilderTraceMetadata(
    materializeBuilderCanvasGraphToRuntime(
      filterBuilderPreviewGraph(
        projectBuilderToCanvas(projection, { sourceText: options.sourceText })
      )
    ),
    builderTraceMetadata(projection, options.sourceText, "canvas-projection")
  );
}
