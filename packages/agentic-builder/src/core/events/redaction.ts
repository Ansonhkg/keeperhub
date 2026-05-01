export function redactRecord(
  input: Readonly<Record<string, unknown>>
): Readonly<Record<string, unknown>> {
  const redacted: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input)) {
    redacted[key] = /secret|token|password|key/i.test(key)
      ? "[redacted]"
      : value;
  }
  return redacted;
}
