export function createEvalExecV3WebClient(baseUrl = "") {
  return {
    async listWorkflows() {
      const response = await fetch(`${baseUrl}/api/workflows`);
      return response.json();
    },
    async run(request: unknown) {
      const response = await fetch(`${baseUrl}/api/eval-exec/run`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(request),
      });
      return response.json();
    },
  };
}
