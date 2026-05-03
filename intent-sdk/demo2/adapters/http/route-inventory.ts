export const EVAL_EXEC_V3_ROUTE_INVENTORY = [
  {
    method: "POST",
    path: "/api/eval-exec/prepare",
    workflow: "eval-exec.prepare",
  },
  { method: "POST", path: "/api/eval-exec/run", workflow: "eval-exec.run" },
  {
    method: "POST",
    path: "/api/graph/workflows/:workflowKey/runs",
    workflow: "eval-exec.prepare",
  },
  {
    method: "POST",
    path: "/api/graph/workflows/:workflowKey/runs",
    workflow: "eval-exec.run",
  },
  {
    method: "POST",
    path: "/api/graph/workflows/eval-exec.run/operations",
    workflow: "eval-exec.run",
  },
];

export default EVAL_EXEC_V3_ROUTE_INVENTORY;
