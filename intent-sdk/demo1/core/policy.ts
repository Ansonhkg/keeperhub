export function isNotificationChannelId(id: string) {
  return id === "channel" || id.includes("notification_channel");
}

export function isNotificationDestinationId(id: string) {
  return (
    id === "notification_destination" ||
    id === "webhook_url" ||
    id === "destination" ||
    id.includes("notification_destination") ||
    id.includes("webhook_url")
  );
}

export function isTargetId(id: string) {
  return (
    id === "target" ||
    id.includes("target") ||
    id.includes("asset") ||
    id.includes("price")
  );
}

export function isCadenceId(id: string) {
  return (
    id === "cadence" ||
    id.includes("cadence") ||
    id.includes("interval") ||
    id.includes("frequency")
  );
}

export function isLoopCountId(id: string) {
  return (
    id === "loop_count" ||
    id.includes("loop_count") ||
    id.includes("repeat") ||
    id.includes("count")
  );
}

export function valueFromRequirements(
  requirements: Map<string, { value: unknown }>,
  ids: string[],
  fallback?: unknown
) {
  for (const id of ids) {
    const exact = requirements.get(id)?.value;
    if (hasValue(exact)) {
      return exact;
    }
    for (const [requirementId, requirement] of requirements) {
      if (
        (requirementId.endsWith(`_${id}`) || requirementId.includes(id)) &&
        hasValue(requirement.value)
      ) {
        return requirement.value;
      }
    }
  }
  return fallback;
}

export function normalizeAsset(value: unknown) {
  if (typeof value !== "string") {
    return value;
  }
  return (
    /\b(ETH|BTC|SOL|USDC|DAI|MATIC)\b/i.exec(value)?.[1]?.toUpperCase() ?? value
  );
}

export function parseSeconds(value: unknown) {
  if (typeof value === "number") {
    return value;
  }
  if (typeof value !== "string") {
    return value;
  }
  const match = /\b(\d+)\s*seconds?\b/i.exec(value);
  return match?.[1] ? Number(match[1]) : value;
}

export function parseCount(value: unknown) {
  if (typeof value === "number") {
    return value;
  }
  if (typeof value !== "string") {
    return value;
  }
  const match = /\b(\d+)\b/.exec(value);
  return match?.[1] ? Number(match[1]) : value;
}

function hasValue(value: unknown) {
  return value !== undefined && value !== null && value !== "";
}
