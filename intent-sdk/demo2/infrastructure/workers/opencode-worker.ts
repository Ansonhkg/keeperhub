import { spawn } from "node:child_process";
import readline from "node:readline";
import type { ZodType } from "zod";
import type {
  EvalExecWorkerPort,
  WorkerInvocationContext,
} from "../../core/providers.js";
import {
  type Attempt,
  AttemptSchema,
  type Evaluation,
  EvaluationSchema,
  FixerOutputSchema,
  type FixInput,
  type PrepareRequest,
  type RunRequest,
  type RunRequestDraft,
  RunRequestDraftSchema,
  type WorkerItemKind,
  type WorkerStreamEvent,
} from "../../core/schemas.js";
import { extractJsonBlock } from "../../core/services/json-output.js";
import {
  buildEvaluatorPrompt,
  buildExecutorPrompt,
  buildFixerPrompt,
  buildPreparePrompt,
} from "../../core/services/prompt-builder.js";

export type OpencodeWorkerOptions = {
  workdir: string;
  model?: string;
  binary?: string;
  timeoutMs?: number;
};

const DEFAULT_TIMEOUT_MS = 240_000;

export class OpencodeWorker implements EvalExecWorkerPort {
  readonly name = "opencode";
  private readonly workdir: string;
  private readonly model?: string;
  private readonly binary: string;
  private readonly timeoutMs: number;

  constructor(options: OpencodeWorkerOptions) {
    this.workdir = options.workdir;
    this.model = options.model;
    this.binary =
      options.binary ?? process.env.OPENCODE_BIN?.trim() ?? "opencode";
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  async prepare(
    input: PrepareRequest,
    resolvedWorkdir: string,
    context?: WorkerInvocationContext
  ): Promise<RunRequestDraft> {
    const output = await this.runJson(
      buildPreparePrompt(input, resolvedWorkdir),
      input.model ?? this.model,
      RunRequestDraftSchema,
      context
    );
    try {
      return RunRequestDraftSchema.parse(output);
    } catch (error) {
      throw enrichAdapterSchemaError("prepare", error, output);
    }
  }

  async execute(
    request: RunRequest,
    prompt: string,
    round: number,
    context?: WorkerInvocationContext
  ): Promise<Attempt> {
    const output = await this.runJson(
      buildExecutorPrompt(request, prompt, round),
      request.executorModel ?? this.model,
      AttemptSchema,
      context
    );
    try {
      return AttemptSchema.parse(output);
    } catch (error) {
      throw enrichAdapterSchemaError("execute", error, output);
    }
  }

  async evaluate(
    request: RunRequest,
    attempt: Attempt,
    round: number,
    context?: WorkerInvocationContext
  ): Promise<Evaluation> {
    const output = await this.runJson(
      buildEvaluatorPrompt(request, attempt, round),
      request.evaluatorModel ?? this.model,
      EvaluationSchema,
      context
    );
    try {
      return EvaluationSchema.parse(output);
    } catch (error) {
      throw enrichAdapterSchemaError("evaluate", error, output);
    }
  }

  async fix(
    request: RunRequest,
    input: FixInput,
    context?: WorkerInvocationContext
  ): Promise<string> {
    const output = await this.runJson(
      buildFixerPrompt(request, input),
      request.fixerModel ?? this.model,
      FixerOutputSchema,
      context
    );
    try {
      return FixerOutputSchema.parse(output).prompt;
    } catch (error) {
      throw enrichAdapterSchemaError("fix", error, output);
    }
  }

  private async runJson(
    prompt: string,
    model: string | undefined,
    outputSchema: ZodType,
    context?: WorkerInvocationContext
  ): Promise<unknown> {
    const args = ["run", prompt, "--format", "json"];
    if (process.env.EVAL_EXEC_V3_OPENCODE_SKIP_PERMISSIONS === "true") {
      args.push("--dangerously-skip-permissions");
    }
    if (model) args.push("--model", model);

    return await new Promise<unknown>((resolve, reject) => {
      const child = spawn(this.binary, args, {
        cwd: this.workdir,
        env: process.env,
        stdio: ["ignore", "pipe", "pipe"],
      });

      let settled = false;
      let rawStdout = "";
      let rawStderr = "";
      const textParts: string[] = [];
      const stdoutRl = readline.createInterface({ input: child.stdout });
      const stderrRl = readline.createInterface({ input: child.stderr });
      const emitter = createWorkerEventEmitter(this.name, context, prompt);
      let killTimer: ReturnType<typeof setTimeout> | null = null;
      let timeoutExpired = false;

      const cleanup = () => {
        stdoutRl.close();
        stderrRl.close();
        emitter.cancel();
        clearTimeout(timer);
        if (killTimer && !timeoutExpired) clearTimeout(killTimer);
      };
      const fail = async (error: Error) => {
        if (settled) return;
        settled = true;
        await emitter.emitFailure(error.message);
        await emitter.flush();
        cleanup();
        reject(error);
      };
      const succeed = async (value: unknown) => {
        if (settled) return;
        settled = true;
        await emitter.flush();
        cleanup();
        resolve(value);
      };

      const timer = setTimeout(() => {
        timeoutExpired = true;
        child.kill("SIGTERM");
        killTimer = setTimeout(() => {
          if (!settled) child.kill("SIGKILL");
        }, 5000);
        killTimer.unref?.();
        void fail(new Error(`opencode timed out after ${this.timeoutMs}ms`));
      }, this.timeoutMs);

      stdoutRl.on("line", (line) => {
        rawStdout += `${line}\n`;
        try {
          const event = JSON.parse(line);
          emitter.handle(event);
          const text = readOpenCodeTextPart(event);
          if (text) {
            textParts.push(text);
          }
        } catch {
          // Non-JSON stdout is still captured for final JSON extraction.
        }
      });
      stderrRl.on("line", (line) => {
        rawStderr += `${line}\n`;
      });
      child.on("error", (error) => {
        void fail(error);
      });
      child.on("close", (code, signal) => {
        void (async () => {
          const text =
            textParts.join("").trim() || rawStdout.trim() || rawStderr.trim();
          if (code !== 0) {
            await fail(
              new Error(
                `opencode failed with code ${code ?? "null"} signal ${signal ?? "null"}: ${text}`
              )
            );
            return;
          }
          let parseError: unknown;
          try {
            await succeed(
              JSON.parse(
                extractJsonBlock(
                  text,
                  (value) => outputSchema.safeParse(value).success
                )
              )
            );
            return;
          } catch (error) {
            parseError = error;
          }
          const toolError = readOpenCodeToolError(rawStdout);
          if (toolError) {
            await fail(
              new Error(
                `${toolError}\n\nOpenCode output excerpt:\n${truncateLog(text)}`
              )
            );
            return;
          }
          const message =
            parseError instanceof Error
              ? parseError.message
              : String(parseError);
          await fail(
            new Error(
              `${message}\n\nOpenCode output excerpt:\n${truncateLog(text)}`
            )
          );
        })();
      });
    });
  }
}

function createWorkerEventEmitter(
  provider: string,
  context: WorkerInvocationContext | undefined,
  prompt: string
) {
  let queue = Promise.resolve();
  const deltaItems = new Map<
    string,
    { preview: string; timer: ReturnType<typeof setTimeout> | null }
  >();

  const emit = (event: WorkerStreamEvent) => {
    queue = queue.then(() => context?.emit?.(event)).catch(() => undefined);
  };

  const makeEvent = (
    type: WorkerStreamEvent["type"],
    itemId: string,
    itemKind: WorkerItemKind,
    title: string,
    preview: string,
    options: {
      error?: string;
      input?: unknown;
      output?: unknown;
      parentItemId?: string;
      providerRefs?: WorkerStreamEvent["providerRefs"];
      raw?: unknown;
      rawType?: string;
      text?: string;
    } = {}
  ): WorkerStreamEvent | null => {
    if (!context) return null;
    return {
      type,
      provider,
      nodeId: context.nodeId,
      phase: context.phase,
      round: context.round,
      itemId,
      ...(options.parentItemId ? { parentItemId: options.parentItemId } : {}),
      ...(options.providerRefs ? { providerRefs: options.providerRefs } : {}),
      itemKind,
      title,
      preview: oneLine(preview),
      ...(options.text ? { text: options.text } : {}),
      ...(options.input === undefined
        ? {}
        : { input: boundedRaw(options.input) }),
      ...(options.output === undefined
        ? {}
        : { output: boundedRaw(options.output) }),
      ...(options.rawType ? { rawType: options.rawType } : {}),
      ...(options.raw === undefined ? {} : { raw: boundedRaw(options.raw) }),
      ...(options.error ? { error: oneLine(options.error) } : {}),
    };
  };

  const flushDelta = (itemId: string) => {
    const pending = deltaItems.get(itemId);
    if (!pending) return;
    if (pending.timer) clearTimeout(pending.timer);
    deltaItems.delete(itemId);
    if (!pending.preview) return;
    const event = makeEvent(
      "worker.item.delta",
      itemId,
      "assistant_message",
      `${phaseLabel(context)} is writing output`,
      pending.preview,
      {
        raw: { preview: pending.preview },
        rawType: "message",
        text: pending.preview,
      }
    );
    if (event) emit(event);
  };

  const flushAllDeltas = () => {
    for (const itemId of [...deltaItems.keys()]) {
      flushDelta(itemId);
    }
  };

  return {
    handle(event: unknown) {
      if (!(context && isRecord(event))) return;
      const eventType = typeof event.type === "string" ? event.type : "unknown";
      const part = isRecord(event.part) ? event.part : {};
      const itemId = readItemId(event, part);
      const providerRefs = readProviderRefs(event, part);
      const parentItemId =
        typeof part.messageID === "string" ? part.messageID : undefined;
      if (eventType === "step_start") {
        flushAllDeltas();
        const workerEvent = makeEvent(
          "worker.item.started",
          itemId,
          "model_step",
          `${phaseLabel(context)} started a model step`,
          `${phaseLabel(context)} started a model step`,
          {
            input: { message: prompt },
            parentItemId,
            providerRefs,
            raw: event,
            rawType: eventType,
          }
        );
        if (workerEvent) emit(workerEvent);
        return;
      }
      if (eventType === "step_finish") {
        flushAllDeltas();
        const workerEvent = makeEvent(
          "worker.item.completed",
          itemId,
          "model_step",
          `${phaseLabel(context)} finished a model step`,
          `${phaseLabel(context)} finished a model step`,
          { parentItemId, providerRefs, raw: event, rawType: eventType }
        );
        if (workerEvent) emit(workerEvent);
        return;
      }
      if (eventType === "tool_use" || part.type === "tool") {
        flushAllDeltas();
        const tool = typeof part.tool === "string" ? part.tool : "tool";
        const state = isRecord(part.state) ? part.state : {};
        const status =
          typeof state.status === "string" ? state.status : "running";
        const error = typeof state.error === "string" ? state.error : undefined;
        const input = state.input;
        const output = state.output;
        const mappedType =
          status === "error"
            ? "worker.item.failed"
            : status === "completed" || status === "success"
              ? "worker.item.completed"
              : "worker.item.started";
        const verb =
          mappedType === "worker.item.failed"
            ? "failed"
            : mappedType === "worker.item.completed"
              ? "completed"
              : "is using";
        const preview = `${phaseLabel(context)} ${verb} ${tool}`;
        const workerEvent = makeEvent(
          mappedType,
          itemId,
          "tool_call",
          preview,
          preview,
          {
            error,
            input,
            output,
            parentItemId,
            providerRefs,
            raw: event,
            rawType: eventType,
          }
        );
        if (workerEvent) emit(workerEvent);
        return;
      }
      const text = readOpenCodeTextPart(event);
      if (text) {
        const pending = deltaItems.get(itemId) ?? { preview: "", timer: null };
        pending.preview = oneLine(`${pending.preview}${text}`).slice(-240);
        if (!pending.timer) {
          pending.timer = setTimeout(() => flushDelta(itemId), 300);
        }
        deltaItems.set(itemId, pending);
      }
    },
    async emitFailure(message: string) {
      flushAllDeltas();
      const event = makeEvent(
        "worker.item.failed",
        `failure-${Date.now()}`,
        "model_step",
        `${phaseLabel(context)} failed`,
        `${phaseLabel(context)} failed: ${message}`,
        {
          error: message,
          raw: { message },
          rawType: "worker.failure",
          text: message,
        }
      );
      if (event) emit(event);
    },
    async flush() {
      flushAllDeltas();
      await queue;
    },
    cancel() {
      for (const pending of deltaItems.values()) {
        if (pending.timer) clearTimeout(pending.timer);
      }
      deltaItems.clear();
    },
  };
}

function phaseLabel(context?: WorkerInvocationContext): string {
  const phase = context?.phase ?? "worker";
  return phase.slice(0, 1).toUpperCase() + phase.slice(1).replace(/-/g, " ");
}

function readItemId(
  event: Record<string, unknown>,
  part: Record<string, unknown>
): string {
  for (const value of [
    part.id,
    part.callID,
    part.messageID,
    event.id,
    event.timestamp,
  ]) {
    if (typeof value === "string" && value) return value;
    if (typeof value === "number") return String(value);
  }
  return `item-${crypto.randomUUID()}`;
}

function readProviderRefs(
  event: Record<string, unknown>,
  part: Record<string, unknown>
): WorkerStreamEvent["providerRefs"] {
  const metadata = isRecord(part.metadata) ? part.metadata : {};
  const openai = isRecord(metadata.openai) ? metadata.openai : {};
  const refs: NonNullable<WorkerStreamEvent["providerRefs"]> = {};
  if (typeof event.sessionID === "string") refs.sessionId = event.sessionID;
  if (typeof part.sessionID === "string") refs.sessionId = part.sessionID;
  if (typeof part.messageID === "string") refs.messageId = part.messageID;
  if (typeof part.id === "string") refs.partId = part.id;
  if (typeof part.callID === "string") refs.callId = part.callID;
  if (typeof openai.itemId === "string") refs.itemId = openai.itemId;
  return Object.keys(refs).length ? refs : undefined;
}

function oneLine(value: string): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized.length > 240
    ? `${normalized.slice(0, 237)}...`
    : normalized;
}

function boundedRaw(value: unknown): unknown {
  const text = JSON.stringify(value);
  if (text.length <= 12_000) return value;
  return { truncated: true, preview: `${text.slice(0, 11_997)}...` };
}

function readOpenCodeTextPart(event: unknown): string | null {
  if (!isRecord(event)) return null;
  const part = event.part;
  if (!isRecord(part)) return null;
  if (typeof part.text === "string") return part.text;
  if (typeof part.content === "string") return part.content;
  if (Array.isArray(part.content)) {
    const text = part.content
      .map((item) => {
        if (typeof item === "string") return item;
        if (isRecord(item) && typeof item.text === "string") return item.text;
        return "";
      })
      .join("");
    return text || null;
  }
  return null;
}

function readOpenCodeToolError(output: string): string | null {
  for (const line of output.split("\n")) {
    if (!line.trim()) continue;
    try {
      const event = JSON.parse(line);
      if (!isRecord(event)) continue;
      const part = event.part;
      if (!isRecord(part)) continue;
      const state = part.state;
      if (!isRecord(state) || state.status !== "error") continue;
      const message =
        typeof state.error === "string"
          ? state.error
          : "OpenCode tool call failed.";
      const tool = typeof part.tool === "string" ? part.tool : "unknown";
      const input = isRecord(state.input)
        ? ` Input: ${JSON.stringify(state.input)}`
        : "";
      return `OpenCode ${tool} tool failed before producing eval-exec JSON: ${message}.${input}`;
    } catch {
      // Ignore non-JSON lines; they are still included in the output excerpt.
    }
  }
  return null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function enrichAdapterSchemaError(
  phase: string,
  error: unknown,
  output: unknown
): Error {
  const message = error instanceof Error ? error.message : String(error);
  return new Error(
    `${phase} output did not match eval-exec schema: ${message}\n\nParsed OpenCode output:\n${truncateLog(JSON.stringify(output, null, 2))}`
  );
}

function truncateLog(value: string): string {
  return value.length > 4000
    ? `${value.slice(0, 4000)}\n...<truncated>`
    : value;
}
