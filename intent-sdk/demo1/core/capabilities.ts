import { capability } from "../../src/sdk/index.ts";

import {
  normalizeAsset,
  parseCount,
  parseSeconds,
  valueFromRequirements,
} from "./policy.ts";

// Real capabilities are the concrete things this demo product can actually do.
// The LLM can describe intent with primitives, but execution only happens after
// intent maps to these product-supported capabilities.
export const workflowCapabilities = [
  capability({
    id: "timer.every",
    mapInput: ({ requirements }) => ({
      everySeconds: parseSeconds(
        valueFromRequirements(requirements, [
          "interval_seconds",
          "schedule_seconds",
          "every_seconds",
          "interval",
          "cadence",
        ])
      ),
    }),
    order: 10,
    primitive: "trigger",
    title: "Run on interval",
  }),
  capability({
    id: "loop.repeat",
    mapInput: ({ requirements }) => ({
      count: parseCount(
        valueFromRequirements(requirements, [
          "repeat_count",
          "loop_count",
          "repetition_count",
          "times",
        ])
      ),
    }),
    order: 20,
    primitive: "loop",
    title: "Repeat steps",
  }),
  capability({
    id: "price.check",
    mapInput: ({ requirements }) => ({
      asset: normalizeAsset(
        valueFromRequirements(requirements, [
          "asset",
          "asset_symbol",
          "asset_to_check",
          "price_asset",
          "read_target",
          "data_target",
          "target",
          "subject",
        ])
      ),
      quote: valueFromRequirements(
        requirements,
        ["quote", "quote_currency", "currency"],
        "USD"
      ),
    }),
    order: 30,
    primitive: "read",
    title: "Check asset price",
  }),
  capability({
    id: "webhook.send",
    mapInput: ({ requirements }) => ({
      channel: valueFromRequirements(requirements, [
        "notification_channel",
        "channel",
      ]),
      destination: valueFromRequirements(requirements, [
        "notification_destination",
        "webhook_url",
        "destination",
      ]),
      message: "Latest {{asset}} price: {{price}}",
    }),
    match: ({ requirements }) =>
      valueFromRequirements(requirements, [
        "notification_channel",
        "channel",
      ]) === "webhook",
    order: 40,
    primitive: "notify",
    title: "Send webhook",
  }),
];
