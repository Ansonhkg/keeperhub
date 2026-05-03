import { createWorkflow } from "../../src/sdk/index.ts";

import { checkWorkflowGraph, createWorkflowGraph } from "./artifact.ts";
import { workflowCapabilities } from "./capabilities.ts";
import { workflowDomain } from "./domain.ts";
import { runWorkflowGraph } from "./runner.ts";

// createWorkflow is the high-level product builder helper. It hides the common
// harness steps: resolve intent, match capabilities, create artifact, check it,
// and run it.
export const workflow = createWorkflow({
  capabilities: workflowCapabilities,
  checkArtifact: checkWorkflowGraph,
  createArtifact: createWorkflowGraph,
  domain: workflowDomain,
  id: "workflow.builder.v4",
  runArtifact: runWorkflowGraph,
});
