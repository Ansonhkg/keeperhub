import path from "node:path";
import { fileURLToPath } from "node:url";

const CURRENT_DIR = path.dirname(fileURLToPath(import.meta.url));
const DEMO_ROOT = path.join(CURRENT_DIR, "..");

export default {
  rootDir: DEMO_ROOT,
  routeInventory: {
    module: "../adapters/http/route-inventory.ts",
    export: "EVAL_EXEC_V3_ROUTE_INVENTORY",
  },
  files: {
    include: ["."],
    ignore: ["node_modules/", ".git/", "data/"],
    extensions: [".ts"],
  },
  layout: {
    requiredPaths: [
      { path: "manifests/app.manifest.ts", kind: "file" },
      { path: "manifests/plugin.json", kind: "file" },
      { path: "graph/graph-structure.ts", kind: "file" },
      { path: "graph/graph-source.config.ts", kind: "file" },
      { path: "core", kind: "directory" },
      { path: "core/providers.ts", kind: "file" },
      { path: "core/provider-manifests.ts", kind: "file" },
      { path: "core/schemas.ts", kind: "file" },
      { path: "core/schema-manifests.ts", kind: "file" },
      { path: "core/domain/eval-exec.ts", kind: "file" },
      { path: "core/request/policy.json", kind: "file" },
      { path: "core/request/policy.ts", kind: "file" },
      { path: "core/services/prepare-request.ts", kind: "file" },
      { path: "core/services/run-loop.ts", kind: "file" },
      { path: "core/services/eval-exec-loop.ts", kind: "file" },
      { path: "core/templates/loader.ts", kind: "file" },
      { path: "core/templates/lint.ts", kind: "file" },
      { path: "core/templates/skills/prepare/SKILL.md", kind: "file" },
      { path: "core/templates/skills/prepare/spec.json", kind: "file" },
      { path: "core/templates/skills/executor/SKILL.md", kind: "file" },
      { path: "core/templates/skills/executor/spec.json", kind: "file" },
      { path: "core/templates/skills/evaluator/SKILL.md", kind: "file" },
      { path: "core/templates/skills/evaluator/spec.json", kind: "file" },
      { path: "core/templates/skills/fixer/SKILL.md", kind: "file" },
      { path: "core/templates/skills/fixer/spec.json", kind: "file" },
      { path: "core/workflows/eval-exec.prepare/contract.ts", kind: "file" },
      {
        path: "core/workflows/eval-exec.prepare/workflow.manifest.ts",
        kind: "file",
      },
      { path: "core/workflows/eval-exec.run/contract.ts", kind: "file" },
      {
        path: "core/workflows/eval-exec.run/workflow.manifest.ts",
        kind: "file",
      },
      {
        path: "core/nodes/operation.eval-exec.prepare/node.manifest.ts",
        kind: "file",
      },
      {
        path: "core/nodes/operation.eval-exec.run-loop/node.manifest.ts",
        kind: "file",
      },
      { path: "core/graphs/eval-exec.prepare/graph.ts", kind: "file" },
      { path: "core/graphs/eval-exec.run/graph.ts", kind: "file" },
      { path: "runtime/services.ts", kind: "file" },
      { path: "runtime/workflows/index.ts", kind: "file" },
      { path: "runtime/workflows/invoker.ts", kind: "file" },
      { path: "runtime/graphs/runner.ts", kind: "file" },
      { path: "runtime/graphs/registry.ts", kind: "file" },
      { path: "runtime/nodes/registry.ts", kind: "file" },
      { path: "adapters/http/routes.ts", kind: "file" },
      { path: "adapters/http/server.ts", kind: "file" },
      { path: "adapters/http/route-inventory.ts", kind: "file" },
      { path: "adapters/cli/main.ts", kind: "file" },
      { path: "adapters/mcp/format.ts", kind: "file" },
      { path: "apps/web/app.ts", kind: "file" },
      { path: "plugin/module.ts", kind: "file" },
      { path: "infrastructure/workers/demo-worker.ts", kind: "file" },
      { path: "infrastructure/workers/opencode-worker.ts", kind: "file" },
      { path: "infrastructure/state/memory-store.ts", kind: "file" },
      { path: "infrastructure/state/file-store.ts", kind: "file" },
    ],
  },
  rules: {
    requiredHandlerCalls: [
      {
        include: ["adapters/http/routes.ts"],
        handlerNamePattern:
          "^(createEvalExecPrepareRoute|createEvalExecRunRoute|createGraphWorkflowRunRoute)$",
        requiredCalls: ["invokeWorkflow"],
        code: "ROUTE_HANDLER_NOT_USING_WORKFLOW_INVOKER",
      },
    ],
  },
};
