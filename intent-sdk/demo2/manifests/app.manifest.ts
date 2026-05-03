import { evalExecPrepareWorkflowManifest } from "../core/workflows/eval-exec.prepare/workflow.manifest.ts";
import { evalExecRunWorkflowManifest } from "../core/workflows/eval-exec.run/workflow.manifest.ts";

export const pluginMetadata = {
  key: "eval-exec-loop-v3",
  title: "Eval Exec Loop v3",
  version: "0.1.0",
  description: "TypeScript-first, Zod-backed, graph-native eval-exec loop.",
  role: "workflow-runtime",
  defaultPort: 4323,
  supports: ["cli", "http", "mcp"],
  loading: { mode: "mountable" },
  runtimeEntry: "./demo2/plugin/module.ts",
};

export const appManifest = {
  appKey: pluginMetadata.key,
  title: pluginMetadata.title,
  description: pluginMetadata.description,
  version: pluginMetadata.version,
  defaultPort: pluginMetadata.defaultPort,
  environments: pluginMetadata.supports,
  workflows: [evalExecPrepareWorkflowManifest, evalExecRunWorkflowManifest],
};
