import { readFileSync } from "node:fs";
import { createInterface } from "node:readline/promises";

import type { WorkflowEvent } from "../../src/sdk/index.ts";

import { answerFixtureQuestion, DEMO_FIXED_ANSWERS } from "../core/fixtures.ts";
import { workflow } from "../core/workflow.ts";

export const DEFAULT_PROMPT =
  "For every 15 seconds, check ETH price and notify me. Do that 3 times.";

export type RunDemoOptions = {
  interactive?: boolean;
  liveLog?: boolean;
};

export async function runDemo(
  prompt = DEFAULT_PROMPT,
  options: RunDemoOptions = {}
) {
  const events: WorkflowEvent[] = [];
  const answeredQuestions: Array<{
    answer: unknown;
    id: string;
    prompt: string;
    title?: string;
  }> = [];
  const interactive = options.interactive ?? false;
  const liveLog = options.liveLog ?? true;
  const scriptedAnswers =
    interactive && !process.stdin.isTTY
      ? readFileSync(0, "utf8").split(/\r?\n/)
      : undefined;
  const readline =
    interactive && !scriptedAnswers
      ? createInterface({
          input: process.stdin,
          output: process.stdout,
        })
      : undefined;

  if (liveLog) {
    console.log(`Mode: ${interactive ? "interactive" : "fixture answers"}`);
    if (!interactive) {
      console.log(`Fixtures: ${JSON.stringify(DEMO_FIXED_ANSWERS)}`);
    }
    console.log("");
  }

  let result: Awaited<ReturnType<typeof workflow.run>>;
  try {
    result = await workflow.run({
      async onQuestion(question) {
        const answer = interactive
          ? await askQuestion({ readline, scriptedAnswers }, question)
          : answerFixtureQuestion(question);
        answeredQuestions.push({
          answer,
          id: question.id,
          prompt: question.prompt,
          title: question.title,
        });
        if (liveLog) {
          console.log(`[question.answered] ${question.id}: ${String(answer)}`);
        }
        return answer;
      },
      onEvent(event) {
        events.push(event);
        if (liveLog) {
          logEvent(event);
        }
      },
      prompt,
    });
  } finally {
    readline?.close();
  }

  printSection("Prompt", prompt);
  printSection("Status", result.status);
  printSection("Questions Answered", answeredQuestions);
  printSection("Intent", result.intent);
  printSection("Capability Plan", result.plan);
  printSection("Workflow Artifact", result.artifact);
  printSection("Events", events);

  return result;
}

async function askQuestion(
  input: {
    readline?: ReturnType<typeof createInterface>;
    scriptedAnswers?: string[];
  },
  question: {
    options?: Array<{ label: string; value: string }>;
    prompt: string;
    title?: string;
    type: "choice" | "multi" | "text" | "confirm";
  }
) {
  console.log("");
  console.log(`? ${question.title ?? "Question"}`);
  console.log(question.prompt);

  if (question.options?.length) {
    question.options.forEach((option, index) => {
      console.log(`  ${index + 1}. ${option.label} (${option.value})`);
    });
  }

  const raw = input.scriptedAnswers
    ? (input.scriptedAnswers.shift() ?? "").trim()
    : ((await input.readline?.question("> ")) ?? "").trim();
  if (input.scriptedAnswers) {
    console.log(`> ${raw}`);
  }
  if (!raw) {
    return undefined;
  }
  if (question.type === "confirm") {
    return ["y", "yes", "true", "1"].includes(raw.toLowerCase());
  }
  if (question.type === "multi") {
    return raw
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);
  }
  const selectedByNumber = question.options?.[Number(raw) - 1];
  return selectedByNumber?.value ?? raw;
}

function logEvent(event: WorkflowEvent) {
  const step = "stepId" in event && event.stepId ? ` ${event.stepId}` : "";
  const node = "nodeId" in event && event.nodeId ? ` ${event.nodeId}` : "";
  const message = event.message ? ` - ${event.message}` : "";
  console.log(`[${event.type}]${step}${node}${message}`);
}

function printSection(title: string, value: unknown) {
  console.log(title);
  if (typeof value === "string") {
    console.log(value);
  } else {
    console.log(JSON.stringify(value, null, 2));
  }
  console.log("");
}
