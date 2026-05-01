import { describe, expect, it } from "vitest";

import { buildCapabilityCatalog } from "@/lib/agentic-builder/evaluation/catalog";
import { evaluationPolicy } from "@/lib/agentic-builder/evaluation/policy";

describe("agentic builder capability catalog", () => {
  it("derives capability intents from action metadata and generated bindings", () => {
    const catalog = buildCapabilityCatalog({
      actions: [
        {
          id: "slack/send-message",
          slug: "send-message",
          label: "Send Slack Message",
          description: "Send a message to a Slack channel",
          category: "Slack",
          integration: "slack",
        },
      ],
      systemCapabilities: [],
    });

    expect(catalog).toEqual([
      {
        id: "slack/send-message",
        label: "Send Slack Message",
        source: evaluationPolicy.capabilityPolicy.sources.nativeAction,
        description: "Send a message to a Slack channel",
        category: "Slack",
        integration: "slack",
        capabilityIntent: {
          action: "send_message",
          provider: "slack",
          channel: "slack",
        },
      },
    ]);
  });

  it("classifies protocol actions with generated source policy", () => {
    const catalog = buildCapabilityCatalog({
      actions: [
        {
          id: "chronicle/eth-usd-read",
          slug: "eth-usd-read",
          label: "Chronicle: ETH/USD Read",
          description: "Read ETH/USD from Chronicle",
          category: "Chronicle",
          integration: "chronicle",
        },
      ],
      protocolSlugs: ["chronicle"],
      systemCapabilities: [],
    });

    expect(catalog[0]).toMatchObject({
      source: evaluationPolicy.capabilityPolicy.sources.protocolAction,
      capabilityIntent: {
        action: "eth_usd_read",
        provider: "chronicle",
      },
    });
  });

  it("includes generated system capabilities by default", () => {
    const catalog = buildCapabilityCatalog({ actions: [] });

    expect(catalog.map((capability) => capability.source)).toEqual(
      evaluationPolicy.systemCapabilities.map(
        () => evaluationPolicy.capabilityPolicy.sources.systemAction
      )
    );
  });
});
