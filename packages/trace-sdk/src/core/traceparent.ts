import { isSpanId, isTraceId } from "./ids";

const traceparentPattern =
  /^([0-9a-f]{2})-([0-9a-f]{32})-([0-9a-f]{16})-([0-9a-f]{2})$/;
const traceFlagsPattern = /^[0-9a-f]{2}$/;

export type Traceparent = {
  version: "00";
  traceId: string;
  parentSpanId: string;
  traceFlags: string;
};

export function parseTraceparent(value: string): Traceparent | null {
  const match = traceparentPattern.exec(value.trim());
  if (!match) {
    return null;
  }

  const [, version, traceId, parentSpanId, traceFlags] = match;
  if (version !== "00" || !isTraceId(traceId) || !isSpanId(parentSpanId)) {
    return null;
  }

  return {
    parentSpanId,
    traceFlags,
    traceId,
    version,
  };
}

export function formatTraceparent(input: {
  traceId: string;
  parentSpanId: string;
  traceFlags?: string;
}) {
  const traceFlags = input.traceFlags ?? "01";
  if (
    !(
      isTraceId(input.traceId) &&
      isSpanId(input.parentSpanId) &&
      traceFlagsPattern.test(traceFlags)
    )
  ) {
    throw new Error("Invalid traceparent fields");
  }

  return `00-${input.traceId}-${input.parentSpanId}-${traceFlags}`;
}
