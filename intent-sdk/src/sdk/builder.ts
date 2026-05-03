import type {
  IntentContract,
  IntentRequirement,
  IntentStep,
  Question,
} from "./intent";

export type CapabilityMatchContext = {
  intent: IntentContract;
  requirement(id: string): IntentRequirement | undefined;
  requirementValue(ids: string | string[], fallback?: unknown): unknown;
  requirements: Map<string, IntentRequirement>;
  step: IntentStep;
};

export type Capability<TPrimitiveId extends string = string> = {
  description?: string;
  id: string;
  input?: unknown;
  mapInput?: (context: CapabilityMatchContext) => Record<string, unknown>;
  match?: (context: CapabilityMatchContext) => boolean;
  metadata?: Record<string, unknown>;
  order?: number;
  primitive: TPrimitiveId;
  title: string;
};

export function capability<const TPrimitiveId extends string>(
  input: Capability<TPrimitiveId>
): Capability<TPrimitiveId> {
  return input;
}

export type PlanItem = {
  capabilityId: string;
  id: string;
  input: Record<string, unknown>;
  kind: "trigger" | "action";
  primitive: string;
  title: string;
};

export type PlanEdge = {
  branch?: string;
  from: string;
  id: string;
  to: string;
};

export type CapabilityPlan = {
  edges: PlanEdge[];
  items: PlanItem[];
};

export type MissingCapability = {
  label: string;
  primitive: string;
  stepId: string;
};

export type CapabilityMatch = {
  missingCapabilities: MissingCapability[];
  plan: CapabilityPlan;
  questions: Question[];
};

export type CapabilityCatalog = {
  items: Capability[];
  match(intent: IntentContract): Promise<CapabilityMatch>;
};

export function capabilities(input: {
  items: Capability[];
}): CapabilityCatalog {
  return {
    items: input.items,
    async match(intent) {
      const missingQuestions = intent.requirements.flatMap((requirement) =>
        requirement.required &&
        requirement.status !== "satisfied" &&
        requirement.question
          ? [requirement.question]
          : []
      );
      if (missingQuestions.length > 0) {
        return {
          missingCapabilities: [],
          plan: { edges: [], items: [] },
          questions: missingQuestions,
        };
      }

      const requirements = new Map(
        intent.requirements.map((item) => [item.id, item])
      );
      const missingCapabilities = orderedIntentSteps(intent, input.items)
        .filter(
          (intentStep) =>
            !selectCapability(input.items, intentStep, intent, requirements)
        )
        .map((intentStep) => ({
          label: intentStep.label,
          primitive: intentStep.primitive,
          stepId: intentStep.id,
        }));
      const items = plannedItems(input.items, intent);
      const edges = items.slice(1).map((item, index) => ({
        from: items[index].id,
        id: `edge_${items[index].id}_${item.id}`,
        to: item.id,
      }));
      return {
        missingCapabilities,
        plan: { edges, items },
        questions: [],
      };
    },
  };
}

export type ArtifactFactory<TArtifact = unknown> = {
  create(plan: CapabilityPlan): Promise<TArtifact> | TArtifact;
};

export type RunnerCheck = {
  ok: boolean;
  reason?: string;
};

export type RunnerRun = {
  runId: string;
  status: "running" | "completed" | "paused" | "cancelled" | "failed";
};

export type RunnerTraceEvent = {
  message: string;
  nodeId?: string;
  type: string;
};

export type ArtifactRunner<TArtifact = unknown> = {
  cancel?(runId: string): Promise<RunnerRun> | RunnerRun;
  check(artifact: TArtifact): Promise<RunnerCheck> | RunnerCheck;
  pause?(runId: string): Promise<RunnerRun> | RunnerRun;
  resume?(runId: string): Promise<RunnerRun> | RunnerRun;
  run(artifact: TArtifact): Promise<RunnerRun> | RunnerRun;
  trace?(runId: string): AsyncIterable<RunnerTraceEvent>;
};

function plannedItems(
  capabilityItems: Capability[],
  intent: IntentContract
): PlanItem[] {
  const requirements = new Map(
    intent.requirements.map((item) => [item.id, item])
  );
  return orderedIntentSteps(intent, capabilityItems).flatMap((intentStep) => {
    const selected = selectCapability(
      capabilityItems,
      intentStep,
      intent,
      requirements
    );
    if (!selected) {
      return [];
    }
    const context = createMatchContext(intentStep, intent, requirements);
    return [
      {
        capabilityId: selected.id,
        id: `node_${intentStep.primitive}`,
        input: selected.mapInput?.(context) ?? {},
        kind: intentStep.primitive === "trigger" ? "trigger" : "action",
        primitive: intentStep.primitive,
        title: selected.title,
      },
    ];
  });
}

function orderedIntentSteps(
  intent: IntentContract,
  capabilityItems: Capability[]
) {
  const primitiveOrder = new Map<string, number>();
  for (const item of capabilityItems) {
    if (item.order === undefined || primitiveOrder.has(item.primitive)) {
      continue;
    }
    primitiveOrder.set(item.primitive, item.order);
  }
  return [...intent.steps].sort((left, right) => {
    const leftOrder =
      primitiveOrder.get(left.primitive) ?? Number.MAX_SAFE_INTEGER;
    const rightOrder =
      primitiveOrder.get(right.primitive) ?? Number.MAX_SAFE_INTEGER;
    if (leftOrder !== rightOrder) return leftOrder - rightOrder;
    return intent.steps.indexOf(left) - intent.steps.indexOf(right);
  });
}

function selectCapability(
  capabilityItems: Capability[],
  step: IntentStep,
  intent: IntentContract,
  requirements: Map<string, IntentRequirement>
) {
  const context = createMatchContext(step, intent, requirements);
  return capabilityItems.find((item) => {
    if (item.primitive !== step.primitive) return false;
    return item.match ? item.match(context) : true;
  });
}

function createMatchContext(
  step: IntentStep,
  intent: IntentContract,
  requirements: Map<string, IntentRequirement>
) {
  return {
    intent,
    requirement(id: string) {
      return requirements.get(id);
    },
    requirementValue(ids: string | string[], fallback?: unknown) {
      return valueFor(requirements, Array.isArray(ids) ? ids : [ids], fallback);
    },
    requirements,
    step,
  };
}

function valueFor(
  requirements: Map<string, IntentRequirement>,
  ids: string[],
  fallback?: unknown
) {
  for (const id of ids) {
    const value = requirements.get(id)?.value;
    if (value !== undefined && value !== null && value !== "") {
      return value;
    }
  }
  return fallback;
}
