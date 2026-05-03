export type PrimitiveFieldType =
  | "string"
  | "number"
  | "boolean"
  | "duration"
  | "url"
  | "asset"
  | "enum";

export type PrimitiveField = {
  description: string;
  examples?: unknown[];
  required?: boolean;
  type?: PrimitiveFieldType;
  values?: string[];
};

export type IntentPrimitive<
  TId extends string = string,
  TFields extends Record<string, PrimitiveField> = Record<
    string,
    PrimitiveField
  >,
> = {
  description: string;
  examples?: string[];
  fields?: TFields;
  id: TId;
  title?: string;
};

export function primitive<
  const TId extends string,
  const TFields extends Record<string, PrimitiveField> = Record<
    string,
    PrimitiveField
  >,
>(input: {
  description: string;
  examples?: string[];
  fields?: TFields;
  id: TId;
  title?: string;
}): IntentPrimitive<TId, TFields> {
  return input;
}

export type Domain<
  TId extends string = string,
  TPrimitives extends readonly IntentPrimitive[] = readonly IntentPrimitive[],
> = {
  description?: string;
  id: TId;
  intent?: DomainIntentPolicy;
  primitives: TPrimitives;
  title?: string;
};

export type DomainIntentPolicy = {
  baseUrl?: string;
  instructions?: string[];
  kind?: string;
  model?: string;
  provider?: string;
  questionConstraintsForRequirement?: (context: {
    contract: IntentContract;
    requirement: IntentRequirement;
  }) => QuestionConstraints | undefined;
  /**
   * @deprecated Prefer questionConstraintsForRequirement so the LLM can keep
   * contextual wording while product code only constrains type/options.
   */
  questionForRequirement?: (context: {
    contract: IntentContract;
    requirement: IntentRequirement;
  }) => Question;
  resolve?: <TDomain extends Domain>(
    input: ResolveIntentInput<TDomain>
  ) =>
    | Promise<IntentContract<DomainPrimitiveId<TDomain>>>
    | IntentContract<DomainPrimitiveId<TDomain>>;
};

export function domain<
  const TId extends string,
  const TPrimitives extends readonly IntentPrimitive[],
>(input: {
  description?: string;
  id: TId;
  intent?: DomainIntentPolicy;
  primitives: TPrimitives;
  title?: string;
}): Domain<TId, TPrimitives> {
  return input;
}

export type DomainPrimitiveId<TDomain extends Domain> =
  TDomain["primitives"][number]["id"];

export type QuestionOption = {
  description?: string;
  label: string;
  value: string;
};

export type Question = {
  id: string;
  options?: QuestionOption[];
  prompt: string;
  requirementId?: string;
  title?: string;
  type: "choice" | "multi" | "text" | "confirm";
};

export type QuestionConstraints = {
  fallbackPrompt?: string;
  id?: string;
  options?: QuestionOption[];
  requirementId?: string;
  title?: string;
  type?: Question["type"];
};

export type AnswerInput = {
  questionId: string;
  value: unknown;
};

export type IntentRequirementStatus =
  | "satisfied"
  | "missing"
  | "ambiguous"
  | "unsupported";

export type IntentRequirement = {
  id: string;
  label: string;
  question?: Question;
  required?: boolean;
  status: IntentRequirementStatus;
  type: PrimitiveFieldType | "unknown";
  value: unknown | null;
};

export type IntentStep<TPrimitiveId extends string = string> = {
  id: string;
  label: string;
  primitive: TPrimitiveId;
  requirementIds: string[];
};

export type IntentContract<TPrimitiveId extends string = string> = {
  kind: string;
  requirements: IntentRequirement[];
  steps: IntentStep<TPrimitiveId>[];
};

export type IntentResolutionSnapshot<TPrimitiveId extends string = string> = {
  contract: IntentContract<TPrimitiveId>;
  questions: Question[];
  status: "resolved" | "needs_input" | "failed";
};

export type IntentResolutionSession<TPrimitiveId extends string = string> =
  IntentResolutionSnapshot<TPrimitiveId> & {
    answer(input: AnswerInput): Promise<IntentResolutionSnapshot<TPrimitiveId>>;
    resume(): Promise<IntentResolutionSnapshot<TPrimitiveId>>;
  };

export type ResolveIntentInput<TDomain extends Domain> = {
  answers?: Record<string, unknown>;
  baseUrl?: string;
  context?: string;
  domain: TDomain;
  model?: string;
  prompt: string;
  provider?: string;
  resolver?: "llm" | DomainIntentPolicy["resolve"];
};

export async function resolveIntent<const TDomain extends Domain>(
  input: ResolveIntentInput<TDomain>
): Promise<IntentResolutionSession<DomainPrimitiveId<TDomain>>> {
  const contract =
    typeof input.resolver === "function"
      ? await input.resolver(input)
      : input.domain.intent?.resolve
        ? await input.domain.intent.resolve(input)
        : await createContractWithLlm(input);
  return new IntentResolutionSessionImpl(input, contract);
}

export function renderPrimitiveForPrompt(primitive: IntentPrimitive) {
  return {
    description: primitive.description,
    examples: primitive.examples ?? [],
    fields: Object.entries(primitive.fields ?? {}).map(([id, field]) => ({
      description: field.description,
      id,
      required: field.required ?? false,
      type: field.type ?? "string",
      values: field.values,
    })),
    id: primitive.id,
  };
}

class IntentResolutionSessionImpl<TDomain extends Domain>
  implements IntentResolutionSession<DomainPrimitiveId<TDomain>>
{
  private readonly answers: Record<string, unknown>;
  private contractValue: IntentContract<DomainPrimitiveId<TDomain>>;

  constructor(
    private readonly input: ResolveIntentInput<TDomain>,
    contract: IntentContract<DomainPrimitiveId<TDomain>>
  ) {
    this.answers = { ...(input.answers ?? {}) };
    this.contractValue = contract;
    this.applyAnswers();
  }

  get contract() {
    return this.contractValue;
  }

  get questions() {
    return questionsForContract(this.contractValue);
  }

  get status() {
    return this.questions.length > 0 ? "needs_input" : "resolved";
  }

  async answer(input: AnswerInput) {
    this.answers[input.questionId] = input.value;
    this.applyAnswers();
    return this.snapshot();
  }

  async resume() {
    this.applyAnswers();
    return this.snapshot();
  }

  private snapshot(): IntentResolutionSnapshot<DomainPrimitiveId<TDomain>> {
    return {
      contract: this.contractValue,
      questions: this.questions,
      status: this.status,
    };
  }

  private applyAnswers() {
    this.contractValue = {
      ...this.contractValue,
      requirements: this.contractValue.requirements.map((requirement) => {
        if (!(requirement.id in this.answers)) {
          return requirement;
        }
        const value = this.answers[requirement.id];
        return {
          ...requirement,
          question: undefined,
          status: "satisfied",
          value,
        };
      }),
    };
    this.contractValue = attachQuestions(this.input.domain, this.contractValue);
  }
}

async function createContractWithLlm<TDomain extends Domain>(
  input: ResolveIntentInput<TDomain>
): Promise<IntentContract<DomainPrimitiveId<TDomain>>> {
  const baseUrl = (input.baseUrl ?? input.domain.intent?.baseUrl)?.replace(
    /\/$/,
    ""
  );
  if (!baseUrl) {
    throw new Error(
      "Intent LLM resolver requires baseUrl in resolveIntent input or domain intent policy."
    );
  }
  const provider =
    input.provider ??
    input.domain.intent?.provider ??
    (await discoverProvider(baseUrl));
  const model =
    input.model ??
    input.domain.intent?.model ??
    (await discoverModel(baseUrl, provider));
  const response = await fetch(`${baseUrl}/v1/chat/completions`, {
    body: JSON.stringify({
      messages: [
        {
          content: intentSystemPrompt(input.domain),
          role: "system",
        },
        {
          content: JSON.stringify(
            {
              answers: input.answers ?? {},
              context: input.context ?? "",
              prompt: input.prompt,
            },
            null,
            2
          ),
          role: "user",
        },
      ],
      model,
      reasoning: { effort: "low" },
    }),
    headers: {
      "content-type": "application/json",
      "x-llm-provider": provider,
    },
    method: "POST",
  });
  if (!response.ok) {
    const body = await response.text();
    throw new Error(
      `Intent LLM request failed with ${response.status}: ${body}`
    );
  }
  const json = (await response.json()) as {
    choices?: Array<{ message?: { content?: string | null } }>;
  };
  const content = json.choices?.[0]?.message?.content;
  if (!content) {
    throw new Error("Intent LLM response did not include message content.");
  }
  return normalizeContract(input.domain, parseJsonObject(content));
}

function intentSystemPrompt(domain: Domain): string {
  return [
    "You turn user prompts into an intent contract.",
    "Return JSON only. Do not return markdown.",
    "Use only the primitive ids provided in the domain.",
    "Do not invent executable nodes or product actions.",
    "Represent unknown or missing user-provided values as requirements with status 'missing' and value null.",
    ...(domain.intent?.instructions ?? []),
    "Use this exact JSON shape:",
    JSON.stringify(
      {
        kind: domain.intent?.kind ?? "intent_contract",
        requirements: [
          {
            id: "requirement_id",
            label: "Requirement label",
            question: {
              id: "requirement_id",
              prompt:
                "Contextual question to ask the user when this requirement is missing or ambiguous.",
              requirementId: "requirement_id",
              title: "Short question title",
              type: "text",
            },
            required: true,
            status: "satisfied",
            type: "string",
            value: "value from the prompt",
          },
        ],
        steps: [
          {
            id: "step_id",
            label: "Step label",
            primitive: "one_of_the_domain_primitive_ids",
            requirementIds: ["requirement_id"],
          },
        ],
      },
      null,
      2
    ),
    "For every missing or ambiguous requirement, include a question object with natural wording based on the user's prompt.",
    "Do not hardcode values from examples into questions; ask only for the specific missing or ambiguous information.",
    "Question objects are only needed for requirements whose status is missing or ambiguous.",
    "Domain primitives:",
    JSON.stringify(domain.primitives.map(renderPrimitiveForPrompt), null, 2),
  ].join("\n\n");
}

async function discoverProvider(baseUrl: string): Promise<string> {
  const response = await fetch(`${baseUrl}/providers`);
  if (!response.ok) {
    throw new Error(`Provider discovery failed with ${response.status}.`);
  }
  const json = (await response.json()) as {
    data?: Array<{ id: string; isDefault?: boolean }>;
    defaultProvider?: string;
  };
  const provider =
    json.defaultProvider ??
    json.data?.find((provider) => provider.isDefault)?.id ??
    json.data?.[0]?.id;
  if (!provider) {
    throw new Error("Provider discovery returned no providers.");
  }
  return provider;
}

async function discoverModel(
  baseUrl: string,
  provider: string
): Promise<string> {
  const response = await fetch(`${baseUrl}/v1/models`);
  if (!response.ok) {
    throw new Error(`Model discovery failed with ${response.status}.`);
  }
  const json = (await response.json()) as {
    data?: Array<{ id: string; isDefault?: boolean; provider?: string }>;
  };
  const providerModels = (json.data ?? []).filter(
    (model) =>
      model.provider === provider || model.id.startsWith(`${provider}:`)
  );
  const model =
    providerModels.find((model) => model.isDefault)?.id ??
    providerModels[0]?.id ??
    json.data?.[0]?.id;
  if (!model) {
    throw new Error("Model discovery returned no models.");
  }
  return model;
}

function parseJsonObject(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(text)?.[1];
    if (fenced) return JSON.parse(fenced);
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start >= 0 && end > start) {
      return JSON.parse(text.slice(start, end + 1));
    }
    throw new Error("Could not parse JSON object from intent LLM response.");
  }
}

function normalizeContract<TDomain extends Domain>(
  domain: TDomain,
  value: unknown
): IntentContract<DomainPrimitiveId<TDomain>> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Intent LLM returned a non-object contract.");
  }
  const record = value as Record<string, unknown>;
  const primitiveIds = new Set(
    domain.primitives.map((primitive) => primitive.id)
  );
  const requirements = Array.isArray(record.requirements)
    ? record.requirements.map(normalizeRequirement)
    : [];
  const requirementIds = new Set(
    requirements.map((requirement) => requirement.id)
  );
  const steps = Array.isArray(record.steps)
    ? record.steps.flatMap((step, index) =>
        normalizeStep(step, index, primitiveIds, requirementIds)
      )
    : [];
  if (steps.length === 0) {
    throw new Error("Intent LLM returned no valid intent steps.");
  }
  return attachQuestions(domain, {
    kind:
      typeof record.kind === "string"
        ? record.kind
        : (domain.intent?.kind ?? "intent_contract"),
    requirements,
    steps: steps as IntentStep<DomainPrimitiveId<TDomain>>[],
  });
}

function normalizeRequirement(
  value: unknown,
  index: number
): IntentRequirement {
  const record =
    value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  const status = normalizeStatus(record.status);
  return {
    id:
      typeof record.id === "string" && record.id
        ? record.id
        : `requirement_${index + 1}`,
    label:
      typeof record.label === "string" && record.label
        ? record.label
        : `Requirement ${index + 1}`,
    question: normalizeQuestion(
      record.question,
      typeof record.id === "string" ? record.id : `requirement_${index + 1}`
    ),
    required: record.required !== false,
    status,
    type: normalizeRequirementType(record.type),
    value:
      status === "satisfied" ? (record.value ?? null) : (record.value ?? null),
  };
}

function normalizeQuestion(
  value: unknown,
  requirementId: string
): Question | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  const record = value as Record<string, unknown>;
  const type =
    record.type === "choice" ||
    record.type === "multi" ||
    record.type === "text" ||
    record.type === "confirm"
      ? record.type
      : "text";
  const prompt =
    typeof record.prompt === "string" && record.prompt
      ? record.prompt
      : undefined;
  if (!prompt) {
    return undefined;
  }
  return {
    id: typeof record.id === "string" && record.id ? record.id : requirementId,
    options: Array.isArray(record.options)
      ? record.options.flatMap(normalizeQuestionOption)
      : undefined,
    prompt,
    requirementId:
      typeof record.requirementId === "string" &&
      record.requirementId === requirementId
        ? record.requirementId
        : requirementId,
    title: typeof record.title === "string" ? record.title : undefined,
    type,
  };
}

function normalizeQuestionOption(value: unknown): QuestionOption[] {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return [];
  }
  const record = value as Record<string, unknown>;
  if (typeof record.label !== "string" || typeof record.value !== "string") {
    return [];
  }
  return [
    {
      description:
        typeof record.description === "string" ? record.description : undefined,
      label: record.label,
      value: record.value,
    },
  ];
}

function normalizeStep(
  value: unknown,
  index: number,
  primitiveIds: Set<string>,
  requirementIds: Set<string>
): IntentStep[] {
  if (!value || typeof value !== "object" || Array.isArray(value)) return [];
  const record = value as Record<string, unknown>;
  const primitive =
    typeof record.primitive === "string" ? record.primitive : "";
  if (!primitiveIds.has(primitive)) {
    return [];
  }
  return [
    {
      id:
        typeof record.id === "string" && record.id
          ? record.id
          : `step_${index + 1}`,
      label:
        typeof record.label === "string" && record.label
          ? record.label
          : `Step ${index + 1}`,
      primitive,
      requirementIds: Array.isArray(record.requirementIds)
        ? record.requirementIds
            .map(String)
            .filter((id) => requirementIds.has(id))
        : [],
    },
  ];
}

function normalizeStatus(value: unknown): IntentRequirementStatus {
  return value === "satisfied" ||
    value === "missing" ||
    value === "ambiguous" ||
    value === "unsupported"
    ? value
    : "missing";
}

function normalizeRequirementType(value: unknown): IntentRequirement["type"] {
  return value === "string" ||
    value === "number" ||
    value === "boolean" ||
    value === "duration" ||
    value === "url" ||
    value === "asset" ||
    value === "enum"
    ? value
    : "unknown";
}

function questionsForContract(contract: IntentContract): Question[] {
  return contract.requirements.flatMap((requirement) =>
    requirement.required &&
    requirement.status !== "satisfied" &&
    requirement.question
      ? [requirement.question]
      : []
  );
}

function attachQuestions<TPrimitiveId extends string>(
  domain: Domain,
  contract: IntentContract<TPrimitiveId>
): IntentContract<TPrimitiveId> {
  return {
    ...contract,
    requirements: contract.requirements.map((requirement) => {
      if (!requirement.required || requirement.status === "satisfied") {
        return requirement;
      }
      const constraints = domain.intent?.questionConstraintsForRequirement?.({
        contract,
        requirement,
      });
      const legacyQuestion = domain.intent?.questionForRequirement?.({
        contract,
        requirement,
      });
      if (requirement.question) {
        return {
          ...requirement,
          question: constrainQuestion(
            requirement.question,
            requirement,
            constraints,
            legacyQuestion
          ),
        };
      }
      return {
        ...requirement,
        question: questionFromConstraints(
          requirement,
          constraints,
          legacyQuestion
        ),
      };
    }),
  };
}

function constrainQuestion(
  question: Question,
  requirement: IntentRequirement,
  constraints?: QuestionConstraints,
  legacyQuestion?: Question
): Question {
  const constraintOptions = constraints?.options ?? legacyQuestion?.options;
  const constrainedType =
    constraints?.type ?? legacyQuestion?.type ?? question.type;
  return {
    ...question,
    id: constraints?.id ?? legacyQuestion?.id ?? question.id,
    options: constraintOptions
      ? filterAllowedOptions(question.options, constraintOptions)
      : question.options,
    requirementId:
      constraints?.requirementId ??
      legacyQuestion?.requirementId ??
      requirement.id,
    title: question.title ?? constraints?.title ?? legacyQuestion?.title,
    type: constrainedType,
  };
}

function questionFromConstraints(
  requirement: IntentRequirement,
  constraints?: QuestionConstraints,
  legacyQuestion?: Question
): Question {
  return {
    id: constraints?.id ?? legacyQuestion?.id ?? requirement.id,
    options: constraints?.options ?? legacyQuestion?.options,
    prompt:
      constraints?.fallbackPrompt ??
      legacyQuestion?.prompt ??
      `What value should be used for ${requirement.label}?`,
    requirementId:
      constraints?.requirementId ??
      legacyQuestion?.requirementId ??
      requirement.id,
    title: constraints?.title ?? legacyQuestion?.title ?? requirement.label,
    type: constraints?.type ?? legacyQuestion?.type ?? "text",
  };
}

function filterAllowedOptions(
  llmOptions: QuestionOption[] | undefined,
  allowedOptions: QuestionOption[]
): QuestionOption[] {
  if (!llmOptions?.length) {
    return allowedOptions;
  }
  const allowed = new Map(
    allowedOptions.map((option) => [option.value, option])
  );
  const filtered = llmOptions.flatMap((option) => {
    const allowedOption = allowed.get(option.value);
    return allowedOption
      ? [{ ...allowedOption, label: option.label || allowedOption.label }]
      : [];
  });
  return filtered.length > 0 ? filtered : allowedOptions;
}
