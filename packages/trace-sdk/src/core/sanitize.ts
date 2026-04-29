import type { TraceJsonObject, TraceJsonValue } from "../types";

const sensitiveKeyPattern =
  /authorization|api[-_]?key|token|secret|password|passwd|credential|private[-_]?key/i;

export type TraceSanitizeOptions = {
  maxArrayLength?: number;
  maxDepth?: number;
  maxStringLength?: number;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function sanitizeError(value: Error): TraceJsonObject {
  return {
    message: value.message,
    name: value.name,
    stack: value.stack ?? null,
  };
}

function sanitizeValue(
  value: unknown,
  options: Required<TraceSanitizeOptions>,
  depth: number
): TraceJsonValue {
  if (value === null || typeof value === "boolean") {
    return value;
  }

  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }

  if (typeof value === "string") {
    return value.length > options.maxStringLength
      ? `${value.slice(0, options.maxStringLength)}...`
      : value;
  }

  if (typeof value === "bigint") {
    return value.toString();
  }

  if (
    typeof value === "undefined" ||
    typeof value === "function" ||
    typeof value === "symbol"
  ) {
    return null;
  }

  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value.toISOString();
  }

  if (value instanceof Error) {
    return sanitizeError(value);
  }

  if (depth >= options.maxDepth) {
    return "[max depth reached]";
  }

  if (Array.isArray(value)) {
    const items = value
      .slice(0, options.maxArrayLength)
      .map((item) => sanitizeValue(item, options, depth + 1));
    const remaining = value.length - items.length;
    return remaining > 0 ? [...items, `[${remaining} more items]`] : items;
  }

  if (!isRecord(value)) {
    return String(value);
  }

  const result: TraceJsonObject = {};
  for (const [key, childValue] of Object.entries(value)) {
    result[key] = sensitiveKeyPattern.test(key)
      ? "[redacted]"
      : sanitizeValue(childValue, options, depth + 1);
  }

  return result;
}

export function sanitizeTraceValue(
  value: unknown,
  options: TraceSanitizeOptions = {}
): TraceJsonValue {
  return sanitizeValue(
    value,
    {
      maxArrayLength: options.maxArrayLength ?? 25,
      maxDepth: options.maxDepth ?? 8,
      maxStringLength: options.maxStringLength ?? 2048,
    },
    0
  );
}

export function sanitizeTraceObject(
  value: unknown,
  options?: TraceSanitizeOptions
): TraceJsonObject | null {
  const sanitized = sanitizeTraceValue(value, options);
  return isRecord(sanitized) ? sanitized : null;
}
