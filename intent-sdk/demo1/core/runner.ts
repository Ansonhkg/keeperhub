import type { EventPayload } from "../../src/sdk/index.ts";

import type { WorkflowGraph } from "./artifact.ts";

// Running the artifact is product-owned execution. This demo performs real
// side effects: it fetches live asset prices and posts webhook payloads.
export async function runWorkflowGraph({
  artifact,
  emit,
}: {
  artifact: WorkflowGraph;
  emit: (event: EventPayload) => void;
}) {
  const runId = "run_v4_demo";
  const trigger = artifact.nodes.find((node) => node.type === "trigger");
  const loop = artifact.nodes.find(
    (node) => node.data.config.actionType === "loop.repeat"
  );
  const read = artifact.nodes.find(
    (node) => node.data.config.actionType === "price.check"
  );
  const notify = artifact.nodes.find(
    (node) => node.data.config.actionType === "webhook.send"
  );
  const everySeconds = Number(trigger?.data.config.everySeconds ?? 0);
  const count = Math.max(1, Number(loop?.data.config.count ?? 1));
  const asset = String(read?.data.config.asset ?? "ETH");
  const quote = String(read?.data.config.quote ?? "USD");
  const destination = String(notify?.data.config.destination ?? "");

  emit({
    artifactRunId: runId,
    message: `Run ${runId} started.`,
    type: "artifact.run.started",
  });

  try {
    for (let iteration = 1; iteration <= count; iteration += 1) {
      if (
        iteration > 1 &&
        process.env.V4_REAL_WAIT === "1" &&
        everySeconds > 0
      ) {
        await new Promise((resolve) =>
          setTimeout(resolve, everySeconds * 1000)
        );
      }
      emit({
        message:
          iteration === 1
            ? `Schedule fired immediately; requested cadence is every ${everySeconds} seconds.`
            : `Schedule fired for iteration ${iteration}/${count}.`,
        nodeId: "node_trigger",
        type: "run.node.completed",
      });
      emit({
        message: `Loop iteration ${iteration}/${count}.`,
        nodeId: "node_loop",
        type: "run.node.completed",
      });
      const price = await fetchPrice(asset, quote);
      emit({
        message: `Checked ${asset}/${quote} price: ${quote} ${price}.`,
        nodeId: "node_read",
        type: "run.node.completed",
      });
      const response = await fetch(destination, {
        body: JSON.stringify({
          asset,
          iteration,
          price,
          quote,
          total: count,
        }),
        headers: { "content-type": "application/json" },
        method: "POST",
      });
      if (!response.ok) {
        const error = `Webhook notification ${iteration}/${count} failed with HTTP ${response.status}.`;
        emit({
          message: error,
          nodeId: "node_notify",
          type: "run.node.failed",
        });
        emit({
          artifactRunId: runId,
          message: `Run ${runId} failed.`,
          type: "artifact.run.failed",
        });
        return { error, runId, status: "failed" };
      }
      emit({
        message: `Posted webhook notification ${iteration}/${count} with HTTP ${response.status}.`,
        nodeId: "node_notify",
        type: "run.node.completed",
      });
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    emit({
      artifactRunId: runId,
      message,
      type: "artifact.run.failed",
    });
    return { error: message, runId, status: "failed" };
  }

  emit({
    artifactRunId: runId,
    message: `Run ${runId} completed.`,
    type: "artifact.run.completed",
  });

  return { runId, status: "completed" };
}

async function fetchPrice(asset: string, quote: string) {
  const response = await fetch(
    `https://api.coinbase.com/v2/prices/${asset}-${quote}/spot`
  );
  if (!response.ok) {
    throw new Error(`Price request failed with HTTP ${response.status}.`);
  }
  const json = (await response.json()) as {
    data?: { amount?: string };
  };
  const price = Number(json.data?.amount);
  if (!Number.isFinite(price)) {
    throw new Error("Price response did not include a numeric amount.");
  }
  return price;
}
