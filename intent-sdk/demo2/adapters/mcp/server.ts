import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { EvalExecLoopV3 } from "../../core/services/eval-exec-loop.js";
import { EVAL_EXEC_PREPARE_WORKFLOW_KEY } from "../../core/workflows/eval-exec.prepare/contract.js";
import { EVAL_EXEC_RUN_WORKFLOW_KEY } from "../../core/workflows/eval-exec.run/contract.js";
import { createEvalExecRuntime } from "../../runtime/services.js";
import {
  invokeWorkflow,
  invokeWorkflowWithOperation,
} from "../../runtime/workflows/invoker.js";
import { objectInput, textResult } from "./format.js";

const runRequestProperties = {
  task: { type: "string" },
  workdir: { type: "string" },
  responseFormat: { type: "string", enum: ["human", "json", "both"] },
  successCriteria: { type: "array", items: { type: "string" } },
  evaluationMode: { type: "string", enum: ["pass_fail", "score", "exact"] },
  scoreThreshold: { type: "number", minimum: 0, maximum: 1 },
  expectedAnswer: { type: "string" },
  rubric: { type: "array", items: { type: "string" } },
  maxExecutionRounds: { type: "integer", minimum: 1 },
  maxFixRounds: { type: "integer", minimum: 0 },
  maxDepth: { type: "integer", minimum: 1 },
  executorModel: { type: "string" },
  evaluatorModel: { type: "string" },
  fixerModel: { type: "string" },
};

const server = new Server(
  { name: "eval-exec-loop-v3-mcp", version: "0.1.0" },
  { capabilities: { tools: {} } }
);

const runtime = createEvalExecRuntime();
const loop = new EvalExecLoopV3(
  runtime.worker,
  runtime.runStore,
  runtime.config
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "eval_exec_v3_prepare",
      description:
        "Prepare an eval-exec v3 run request from intent or a partial request object.",
      inputSchema: {
        type: "object",
        additionalProperties: false,
        properties: {
          intent: { type: "string" },
          request: {
            type: "object",
            additionalProperties: false,
            properties: runRequestProperties,
          },
          workdir: { type: "string" },
          model: { type: "string" },
        },
      },
    },
    {
      name: "eval_exec_v3_run",
      description:
        "Run the graph-native eval-exec v3 loop synchronously and return the final result.",
      inputSchema: {
        type: "object",
        additionalProperties: false,
        properties: runRequestProperties,
      },
    },
    {
      name: "eval_exec_v3_start",
      description:
        "Start a non-blocking eval-exec v3 run and return its run id.",
      inputSchema: {
        type: "object",
        additionalProperties: false,
        properties: {
          input: { type: "string" },
          request: {
            type: "object",
            additionalProperties: false,
            properties: runRequestProperties,
          },
        },
      },
    },
    {
      name: "eval_exec_v3_status",
      description:
        "Get the current status for a non-blocking eval-exec v3 run.",
      inputSchema: {
        type: "object",
        required: ["runId"],
        additionalProperties: false,
        properties: { runId: { type: "string" } },
      },
    },
    {
      name: "eval_exec_v3_result",
      description:
        "Get the current or final result for a non-blocking eval-exec v3 run.",
      inputSchema: {
        type: "object",
        required: ["runId"],
        additionalProperties: false,
        properties: { runId: { type: "string" } },
      },
    },
    {
      name: "eval_exec_v3_cancel",
      description: "Cancel a non-blocking eval-exec v3 run.",
      inputSchema: {
        type: "object",
        required: ["runId"],
        additionalProperties: false,
        properties: { runId: { type: "string" } },
      },
    },
  ],
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const toolName = request.params.name;
  const args = objectInput(
    request.params.arguments as Record<string, unknown> | undefined
  );

  try {
    if (toolName === "eval_exec_v3_prepare") {
      return textResult(
        await invokeWorkflow(EVAL_EXEC_PREPARE_WORKFLOW_KEY, args)
      );
    }
    if (toolName === "eval_exec_v3_run") {
      return textResult(
        await invokeWorkflowWithOperation(
          EVAL_EXEC_RUN_WORKFLOW_KEY,
          args,
          "mcp"
        )
      );
    }
    if (toolName === "eval_exec_v3_start") {
      return textResult(await loop.start(parseStartInput(args)));
    }
    if (toolName === "eval_exec_v3_status") {
      return textResult(await loop.status(parseRunId(args)));
    }
    if (toolName === "eval_exec_v3_result") {
      return textResult(await loop.result(parseRunId(args)));
    }
    if (toolName === "eval_exec_v3_cancel") {
      return textResult(await loop.cancel(parseRunId(args)));
    }
    return textResult({ error: `Unknown tool: ${toolName}` }, true);
  } catch (error) {
    return textResult(
      { error: error instanceof Error ? error.message : String(error) },
      true
    );
  }
});

const transport = new StdioServerTransport();
await server.connect(transport);

function parseStartInput(
  args: Record<string, unknown>
): string | Record<string, unknown> {
  if (typeof args.input === "string" && args.input.trim()) return args.input;
  if (
    args.request &&
    typeof args.request === "object" &&
    !Array.isArray(args.request)
  ) {
    return args.request as Record<string, unknown>;
  }
  return args;
}

function parseRunId(args: Record<string, unknown>): string {
  if (typeof args.runId !== "string" || !args.runId.trim()) {
    throw new Error("tool requires string 'runId'");
  }
  return args.runId;
}
