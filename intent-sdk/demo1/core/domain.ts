import { domain, primitive } from "../../src/sdk/index.ts";

import {
  isNotificationChannelId,
  isNotificationDestinationId,
} from "./policy.ts";

// The semantic domain is the meaning vocabulary the LLM may use while reading
// the prompt. These are not executable nodes; they describe what the user wants.
export const workflowDomain = domain({
  id: "workflow-automation",
  intent: {
    baseUrl: "http://localhost:1111",
    instructions: [
      "The contract kind should be workflow_automation_intent.",
      "If the prompt asks for repeated work, represent the cadence as a trigger requirement and the repetition count as a loop requirement.",
      "If the prompt asks to check, fetch, read, observe, or monitor data, represent the target as a read requirement; do not create executable nodes.",
      "If the prompt says notify me but does not specify a channel, mark notification_channel as missing.",
      "If a notification channel is known but its destination is not provided, mark notification_destination as missing.",
    ],
    kind: "workflow_automation_intent",
    questionConstraintsForRequirement({ contract, requirement }) {
      if (isNotificationChannelId(requirement.id)) {
        return {
          id: requirement.id,
          options: [
            { label: "Webhook", value: "webhook" },
            { label: "Slack", value: "slack" },
            { label: "Email", value: "email" },
            { label: "Telegram", value: "telegram" },
          ],
          requirementId: requirement.id,
          title: "Choose notification channel",
          type: "choice",
        };
      }
      if (isNotificationDestinationId(requirement.id)) {
        const channel = contract.requirements.find((item) =>
          isNotificationChannelId(item.id)
        )?.value;
        return {
          fallbackPrompt:
            channel === "webhook"
              ? "What webhook URL should receive the notification?"
              : "Where should notifications be sent?",
          id: requirement.id,
          requirementId: requirement.id,
          title:
            channel === "webhook" ? "Webhook URL" : "Notification destination",
          type: "text",
        };
      }
      return {
        fallbackPrompt: `What value should be used for ${requirement.label}?`,
        id: requirement.id,
        requirementId: requirement.id,
        title: requirement.label,
        type: "text",
      };
    },
  },
  primitives: [
    primitive({
      id: "trigger",
      description: "Starts a workflow from time, event, or manual input.",
      examples: ["every 15 seconds", "when a webhook is received"],
    }),
    primitive({
      id: "read",
      description: "Fetches or observes data.",
      examples: ["check ETH price", "read wallet balance"],
    }),
    primitive({
      id: "loop",
      description: "Repeats work a fixed number of times or until a condition.",
      examples: ["do this three times"],
    }),
    primitive({
      id: "notify",
      description: "Sends information to a person, service, or channel.",
      examples: ["send a webhook", "notify Slack"],
    }),
  ],
});
