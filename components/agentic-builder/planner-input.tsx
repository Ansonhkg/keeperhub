"use client";

import { Send } from "lucide-react";

export function PlannerInput(props: {
  readonly prompt: string;
  readonly onPromptChange: (value: string) => void;
  readonly onStartPlanning: () => void;
}) {
  return (
    <section className="rounded-lg border p-3">
      <label className="text-sm font-medium" htmlFor="agentic-builder-prompt">
        Plan workflow
      </label>
      <div className="mt-2 flex gap-2">
        <input
          className="min-w-0 flex-1 rounded-md border px-3 py-2"
          id="agentic-builder-prompt"
          onChange={(event) => props.onPromptChange(event.target.value)}
          placeholder="Get ETH price every 15 mins and notify me"
          value={props.prompt}
        />
        <button
          aria-label="Start planning"
          className="rounded-md border px-3"
          onClick={props.onStartPlanning}
          title="Start planning"
          type="button"
        >
          <Send className="size-4" />
        </button>
      </div>
    </section>
  );
}
