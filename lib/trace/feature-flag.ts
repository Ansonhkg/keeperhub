function isTruthyFlag(value: string | undefined) {
  return value?.toLowerCase() === "true";
}

export function isTraceEnabled() {
  return (
    isTruthyFlag(process.env.KEEPERHUB_FEATURE_TRACE) ||
    isTruthyFlag(process.env.NEXT_PUBLIC_KEEPERHUB_FEATURE_TRACE)
  );
}
