import { chmod, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, test } from "vitest";

import { OpencodeWorker } from "./opencode-worker.js";

describe("OpencodeWorker", () => {
  test("accepts schema JSON emitted after a recoverable tool error", async () => {
    const dir = await mkdtemp(
      path.join(tmpdir(), "eval-exec-opencode-worker-")
    );
    const binary = path.join(dir, "fake-opencode");
    await writeFile(
      binary,
      [
        "#!/usr/bin/env sh",
        'printf \'%s\\n\' \'{"type":"tool_use","part":{"type":"tool","tool":"read","state":{"status":"error","input":{"filePath":"/tmp/project","offset":0,"limit":200},"error":"offset must be greater than or equal to 1"}}}\'',
        'printf \'%s\\n\' \'{"type":"message","part":{"text":"{\\"output\\":\\"created app\\",\\"evidence\\":[\\"wrote Program.cs\\"],\\"missingRequirements\\":[],\\"complete\\":true}"}}\'',
      ].join("\n")
    );
    await chmod(binary, 0o755);

    const worker = new OpencodeWorker({ workdir: dir, binary });
    await expect(
      worker.execute(
        {
          task: "create app",
          workdir: dir,
          responseFormat: "human",
          successCriteria: ["Complete the requested task."],
          evaluationMode: "score",
          scoreThreshold: 0.995,
          rubric: ["The implementation must satisfy the task."],
          maxExecutionRounds: 1,
          maxFixRounds: 0,
          maxDepth: 1,
          manualStepMode: false,
        },
        "create app",
        1
      )
    ).resolves.toEqual({
      output: "created app",
      evidence: ["wrote Program.cs"],
      missingRequirements: [],
      complete: true,
    });
  });

  test("emits normalized worker item events from OpenCode JSONL", async () => {
    const dir = await mkdtemp(
      path.join(tmpdir(), "eval-exec-opencode-worker-")
    );
    const binary = path.join(dir, "fake-opencode");
    await writeFile(
      binary,
      [
        "#!/usr/bin/env sh",
        'printf \'%s\\n\' \'{"type":"step_start","timestamp":1,"part":{"id":"step-1"}}\'',
        'printf \'%s\\n\' \'{"type":"tool_use","timestamp":2,"part":{"type":"tool","id":"tool-1","tool":"read","state":{"status":"running","input":{"filePath":"/tmp/project"}}}}\'',
        'printf \'%s\\n\' \'{"type":"tool_use","timestamp":3,"part":{"type":"tool","id":"tool-1","tool":"read","state":{"status":"completed"}}}\'',
        'printf \'%s\\n\' \'{"type":"message","part":{"id":"msg-1","text":"planning next step"}}\'',
        'printf \'%s\\n\' \'{"type":"message","part":{"id":"msg-2","text":"{\\"output\\":\\"created app\\",\\"evidence\\":[\\"wrote file\\"],\\"missingRequirements\\":[],\\"complete\\":true}"}}\'',
        'printf \'%s\\n\' \'{"type":"step_finish","timestamp":4,"part":{"id":"step-1"}}\'',
      ].join("\n")
    );
    await chmod(binary, 0o755);

    const events: unknown[] = [];
    const worker = new OpencodeWorker({ workdir: dir, binary });
    await worker.execute(
      {
        task: "create app",
        workdir: dir,
        responseFormat: "human",
        successCriteria: ["Complete the requested task."],
        evaluationMode: "score",
        scoreThreshold: 0.995,
        rubric: ["The implementation must satisfy the task."],
        maxExecutionRounds: 1,
        maxFixRounds: 0,
        maxDepth: 1,
        manualStepMode: false,
      },
      "create app",
      1,
      {
        nodeId: "executor",
        phase: "executor",
        round: 1,
        emit: (event) => {
          events.push(event);
        },
      }
    );

    expect(events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "worker.item.started",
          itemKind: "model_step",
          preview: "Executor started a model step",
          input: { message: expect.stringContaining("## Task prompt") },
        }),
        expect.objectContaining({
          type: "worker.item.started",
          itemKind: "tool_call",
          preview: "Executor is using read",
        }),
        expect.objectContaining({
          type: "worker.item.completed",
          itemKind: "tool_call",
          preview: "Executor completed read",
        }),
        expect.objectContaining({
          type: "worker.item.completed",
          itemKind: "model_step",
          preview: "Executor finished a model step",
        }),
      ])
    );
    expect(
      events.filter(
        (
          event
        ): event is {
          type: string;
          itemId: string;
          preview: string;
          text?: string;
          raw?: { preview?: string };
        } =>
          typeof event === "object" &&
          event !== null &&
          (event as { type?: unknown }).type === "worker.item.delta"
      )
    ).toEqual([
      expect.objectContaining({
        itemId: "msg-1",
        preview: "planning next step",
        raw: { preview: "planning next step" },
        text: "planning next step",
      }),
      expect.objectContaining({
        itemId: "msg-2",
        text: '{"output":"created app","evidence":["wrote file"],"missingRequirements":[],"complete":true}',
      }),
    ]);
  });

  test("emits worker failures before fatal adapter errors", async () => {
    const dir = await mkdtemp(
      path.join(tmpdir(), "eval-exec-opencode-worker-")
    );
    const binary = path.join(dir, "fake-opencode");
    await writeFile(
      binary,
      [
        "#!/usr/bin/env sh",
        'printf \'%s\\n\' \'{"type":"step_start","timestamp":1,"part":{"id":"step-1"}}\'',
        "printf '%s\\n' 'not eval exec json'",
      ].join("\n")
    );
    await chmod(binary, 0o755);

    const events: Array<{ type: string; preview: string }> = [];
    const worker = new OpencodeWorker({ workdir: dir, binary });
    await expect(
      worker.execute(
        {
          task: "create app",
          workdir: dir,
          responseFormat: "human",
          successCriteria: ["Complete the requested task."],
          evaluationMode: "score",
          scoreThreshold: 0.995,
          rubric: ["The implementation must satisfy the task."],
          maxExecutionRounds: 1,
          maxFixRounds: 0,
          maxDepth: 1,
          manualStepMode: false,
        },
        "create app",
        1,
        {
          nodeId: "executor",
          phase: "executor",
          round: 1,
          emit: (event) => {
            events.push({ type: event.type, preview: event.preview });
          },
        }
      )
    ).rejects.toThrow();

    expect(events.at(-1)).toMatchObject({
      type: "worker.item.failed",
    });
  });

  test("hard-fails timed out OpenCode processes even if close is delayed", async () => {
    const dir = await mkdtemp(
      path.join(tmpdir(), "eval-exec-opencode-worker-")
    );
    const binary = path.join(dir, "fake-opencode");
    await writeFile(
      binary,
      [
        "#!/usr/bin/env sh",
        'printf \'%s\\n\' \'{"type":"step_start","timestamp":1,"part":{"id":"step-1"}}\'',
        "exec node -e \"process.on('SIGTERM', () => {}); setInterval(() => {}, 1000)\"",
      ].join("\n")
    );
    await chmod(binary, 0o755);

    const events: Array<{ type: string; text?: string }> = [];
    const worker = new OpencodeWorker({ workdir: dir, binary, timeoutMs: 10 });
    await expect(
      worker.execute(
        {
          task: "create app",
          workdir: dir,
          responseFormat: "human",
          successCriteria: ["Complete the requested task."],
          evaluationMode: "score",
          scoreThreshold: 0.995,
          rubric: ["The implementation must satisfy the task."],
          maxExecutionRounds: 1,
          maxFixRounds: 0,
          maxDepth: 1,
          manualStepMode: false,
        },
        "create app",
        1,
        {
          nodeId: "executor",
          phase: "executor",
          round: 1,
          emit: (event) => {
            events.push({ type: event.type, text: event.text });
          },
        }
      )
    ).rejects.toThrow("opencode timed out after 10ms");

    expect(events.at(-1)).toMatchObject({
      type: "worker.item.failed",
      text: "opencode timed out after 10ms",
    });
  });
});
