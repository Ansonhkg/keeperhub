import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

export function textResult(payload: unknown, isError = false): CallToolResult {
  return {
    isError,
    content: [{ type: "text", text: JSON.stringify(payload, null, 2) }],
  };
}

export function objectInput(
  args: Record<string, unknown> | undefined
): Record<string, unknown> {
  return args && typeof args === "object" ? args : {};
}
