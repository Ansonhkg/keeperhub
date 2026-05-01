import type {
  BuilderAuthContext,
  BuilderEvent,
  BuilderProjection,
  BuilderSession,
  CatalogCandidate,
  FeatureRequest,
  IntentPlan,
  MissingCapability,
} from "../schemas/all";

export type AiTemplateRunInput = {
  readonly templateName: string;
  readonly templateVersion: string;
  readonly variables: Readonly<Record<string, string>>;
  readonly outputSchemaName: string;
};

export type AiTemplateRunResult<TOutput> = {
  readonly output: TOutput;
  readonly model: string;
  readonly durationMs: number;
  readonly repairAttempts: number;
};

export type AiTemplateRunnerPort = {
  readonly run: <TOutput>(
    input: AiTemplateRunInput,
    validate: (output: unknown) => TOutput
  ) => Promise<AiTemplateRunResult<TOutput>>;
};

export type CatalogSearchInput = {
  readonly auth: BuilderAuthContext;
  readonly intentPlan: IntentPlan;
  readonly query: string;
};

export type CatalogPort = {
  readonly search: (
    input: CatalogSearchInput
  ) => Promise<readonly CatalogCandidate[]>;
};

export type BuilderStorePort = {
  readonly createSession: (
    auth: BuilderAuthContext,
    session: BuilderSession
  ) => Promise<void>;
  readonly getSession: (
    auth: BuilderAuthContext,
    sessionId: string
  ) => Promise<BuilderSession | undefined>;
  readonly saveSession: (
    auth: BuilderAuthContext,
    session: BuilderSession
  ) => Promise<void>;
  readonly listEvents: (
    auth: BuilderAuthContext,
    sessionId: string
  ) => Promise<readonly BuilderEvent[]>;
};

export type FeatureRequestPort = {
  readonly create: (
    auth: BuilderAuthContext,
    sessionId: string,
    missingCapability: MissingCapability
  ) => Promise<FeatureRequest>;
};

export type MaterializeWorkflowPort = {
  readonly materialize: (input: {
    readonly auth: BuilderAuthContext;
    readonly session: BuilderSession;
    readonly projection: BuilderProjection;
    readonly mode: "create" | "update";
    readonly workflowId?: string;
    readonly name?: string;
    readonly expectedRevision?: number;
    readonly overwritePolicy?: "fail" | "overwrite";
    readonly idempotencyKey: string;
  }) => Promise<{ readonly workflowId: string; readonly revision: number }>;
};

export type EventSinkPort = {
  readonly emit: (
    auth: BuilderAuthContext,
    event: BuilderEvent
  ) => Promise<void>;
};

export type ClockPort = { readonly now: () => string };
export type IdPort = { readonly next: (prefix: string) => string };

export type BuilderPorts = {
  readonly ai: AiTemplateRunnerPort;
  readonly catalog: CatalogPort;
  readonly store: BuilderStorePort;
  readonly featureRequests: FeatureRequestPort;
  readonly workflowMaterializer: MaterializeWorkflowPort;
  readonly events: EventSinkPort;
  readonly clock: ClockPort;
  readonly ids: IdPort;
};
