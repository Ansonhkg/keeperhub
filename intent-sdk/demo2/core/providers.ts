import type {
  Attempt,
  Evaluation,
  FixInput,
  PrepareRequest,
  RunRecord,
  RunRequest,
  RunRequestDraft,
  WorkerStreamEvent,
} from "./schemas.js";

export type OperationSessionRecord = Record<string, unknown> & {
  sessionId: string;
  status: string;
  revision: number;
};

export type OperationEventRecord = Record<string, unknown> & {
  eventId: string;
  sessionId: string;
  sequence: number;
  type: string;
};

export type OperationActionRecord = Record<string, unknown> & {
  actionId: string;
  sessionId: string;
  actionKey: string;
  status: string;
};

export type WorkerInvocationContext = {
  nodeId: WorkerStreamEvent["nodeId"];
  phase: WorkerStreamEvent["phase"];
  round: number;
  emit?: (event: WorkerStreamEvent) => Promise<void> | void;
};

export type EvalExecWorkerPort = {
  name: string;
  prepare(
    input: PrepareRequest,
    resolvedWorkdir: string,
    context?: WorkerInvocationContext
  ): Promise<RunRequestDraft>;
  execute(
    request: RunRequest,
    prompt: string,
    round: number,
    context?: WorkerInvocationContext
  ): Promise<Attempt>;
  evaluate(
    request: RunRequest,
    attempt: Attempt,
    round: number,
    context?: WorkerInvocationContext
  ): Promise<Evaluation>;
  fix(
    request: RunRequest,
    input: FixInput,
    context?: WorkerInvocationContext
  ): Promise<string>;
};

export type RunStorePort = {
  create(run: RunRecord): Promise<void> | void;
  get(runId: string): Promise<RunRecord | undefined> | RunRecord | undefined;
  save(run: RunRecord): Promise<void> | void;
};

export type OperationStorePort = {
  listSessions(): Promise<OperationSessionRecord[]> | OperationSessionRecord[];
  getSession(
    sessionId: string
  ):
    | Promise<OperationSessionRecord | undefined>
    | OperationSessionRecord
    | undefined;
  saveSession(session: OperationSessionRecord): Promise<void> | void;
  listEvents(
    sessionId: string
  ): Promise<OperationEventRecord[]> | OperationEventRecord[];
  appendEvent(event: OperationEventRecord): Promise<void> | void;
  listActions(
    sessionId: string
  ): Promise<OperationActionRecord[]> | OperationActionRecord[];
  appendAction(action: OperationActionRecord): Promise<void> | void;
  subscribe?(
    sessionId: string,
    listener: (event: OperationEventRecord) => void
  ): () => void;
};
