export function formatTraceDuration(value: number | null | undefined) {
  if (value == null) {
    return "";
  }

  const milliseconds = Number(value);
  if (!Number.isFinite(milliseconds) || milliseconds < 0) {
    return "";
  }

  if (milliseconds < 1000) {
    return `${Math.round(milliseconds)} ms`;
  }

  const totalSeconds = milliseconds / 1000;
  if (totalSeconds < 60) {
    return `${totalSeconds.toFixed(totalSeconds < 10 ? 1 : 0)} s`;
  }

  const minutes = Math.floor(totalSeconds / 60);
  const seconds = Math.round(totalSeconds % 60);
  return seconds ? `${minutes}m ${seconds}s` : `${minutes}m`;
}

export function formatTraceTimestamp(value: string | null | undefined) {
  if (!value) {
    return "";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "";
  }

  return date.toISOString();
}
