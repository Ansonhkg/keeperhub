import type { Question } from "../../src/sdk/index.ts";

import {
  isCadenceId,
  isLoopCountId,
  isNotificationChannelId,
  isNotificationDestinationId,
  isTargetId,
} from "./policy.ts";

export const DEMO_FIXED_ANSWERS = {
  cadence: "every 15 seconds",
  loopCount: "3",
  notificationChannel: "webhook",
  notificationDestination:
    process.env.V4_WEBHOOK_URL ?? "https://httpbin.org/post",
  target: "ETH price",
} as const;

export function answerFixtureQuestion(question: Question) {
  if (isTargetId(question.id)) {
    return DEMO_FIXED_ANSWERS.target;
  }
  if (isCadenceId(question.id)) {
    return DEMO_FIXED_ANSWERS.cadence;
  }
  if (isLoopCountId(question.id)) {
    return DEMO_FIXED_ANSWERS.loopCount;
  }
  if (isNotificationChannelId(question.id)) {
    return DEMO_FIXED_ANSWERS.notificationChannel;
  }
  if (isNotificationDestinationId(question.id)) {
    return DEMO_FIXED_ANSWERS.notificationDestination;
  }
  throw new Error(
    `No demo fixture answer configured for question '${question.id}'. ` +
      "Run with --interactive or add the fixture in v4/demo1/core/fixtures.ts."
  );
}
