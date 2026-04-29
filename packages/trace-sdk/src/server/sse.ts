const newlinePattern = /\r?\n/;

export type SseEventInput = {
  id?: string;
  event?: string;
  retry?: number;
  data: unknown;
};

function stringifySseData(data: unknown) {
  return typeof data === "string" ? data : JSON.stringify(data ?? null);
}

export function formatSseEvent(input: SseEventInput) {
  const lines: string[] = [];
  if (input.id) {
    lines.push(`id: ${input.id}`);
  }
  if (input.event) {
    lines.push(`event: ${input.event}`);
  }
  if (input.retry != null) {
    lines.push(`retry: ${input.retry}`);
  }

  for (const line of stringifySseData(input.data).split(newlinePattern)) {
    lines.push(`data: ${line}`);
  }

  return `${lines.join("\n")}\n\n`;
}

export function formatSseHeartbeat() {
  return ": heartbeat\n\n";
}
