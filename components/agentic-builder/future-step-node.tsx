import type { IntentStep } from "@keeperhub/agentic-builder/schemas";

export function FutureStepNode({ step }: { readonly step: IntentStep }) {
  return (
    <div className="rounded border border-dashed bg-muted/30 p-2 text-muted-foreground">
      {step.label}
    </div>
  );
}
