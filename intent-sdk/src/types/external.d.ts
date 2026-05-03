declare module "@graph-sdk/sdk/discovery" {
  export function createWorkflowDiscoveryResponse(
    structureOrModule: unknown,
    options?: Record<string, unknown>
  ): unknown;
  export function createNodeDiscoveryResponse(
    structureOrModule: unknown
  ): unknown;
  export function createGraphDiscoveryOpenApiDocument(
    options?: Record<string, unknown>
  ): unknown;
}

declare module "@graph-sdk/visual-adapter" {
  export function createVisualWorkflowProjection(
    structureOrModule: unknown,
    workflowKey: string
  ): unknown;
}

declare module "@graph-sdk/sdk/operations" {
  export const GRAPH_OPERATION_STANDARD_ACTION_INPUT_SCHEMA_IDS: Record<
    string,
    string
  >;
  export function createOperationCapabilitiesResponse(
    options?: Record<string, unknown>
  ): unknown;
  export function createOperationSessionResponse(
    session: Record<string, unknown>
  ): unknown;
  export function createOperationEventsResponse(
    sessionId: string,
    events: unknown[],
    options?: Record<string, unknown>
  ): unknown;
  export function createOperationEvent(event: Record<string, unknown>): unknown;
  export function createOperationPromptRenderedEvent(
    options?: Record<string, unknown>
  ): unknown;
  export function createOperationProjectionStateResponse(
    projectionState: Record<string, unknown>
  ): unknown;
  export function createOperationActionsResponse(
    sessionId: string,
    actions: unknown[]
  ): unknown;
  export function createOperationActionResult(
    result: Record<string, unknown>
  ): unknown;
}

declare module "@graph-sdk/sdk" {
  export const GRAPH_STRUCTURE_SCHEMA_VERSION: string;
  export function defineGraphStructure<T>(structure: T): T;
  export const GRAPH_OPERATION_STANDARD_ACTION_INPUT_SCHEMA_IDS: Record<
    string,
    string
  >;
  export function createOperationCapabilitiesResponse(
    options?: Record<string, unknown>
  ): unknown;
  export function createOperationSessionResponse(
    session: Record<string, unknown>
  ): unknown;
  export function createOperationEventsResponse(
    sessionId: string,
    events: unknown[],
    options?: Record<string, unknown>
  ): unknown;
  export function createOperationEvent(event: Record<string, unknown>): unknown;
  export function createOperationPromptRenderedEvent(
    options?: Record<string, unknown>
  ): unknown;
  export function createOperationProjectionStateResponse(
    projectionState: Record<string, unknown>
  ): unknown;
  export function createOperationActionsResponse(
    sessionId: string,
    actions: unknown[]
  ): unknown;
  export function createOperationActionResult(
    result: Record<string, unknown>
  ): unknown;
}
