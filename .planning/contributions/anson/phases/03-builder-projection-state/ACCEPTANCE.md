# Phase 3 Acceptance

## Done Means

- Builder projection state exists separately from workflow editor state.
- Preview nodes and edges are identifiable by schema, not CSS alone.
- Projection stores the Phase 1 Intent IR and Phase 2 evaluation result.
- Projection branches can reference requirements, option groups, capability matches, and custom node proposals.
- Preview graph can be generated from a projection.
- Rendered graph can be derived as `real graph + preview graph`.
- Real graph can be recovered from any rendered graph by stripping preview nodes and edges.
- Existing autosave/persistence paths do not save preview nodes or preview edges.
- Persistence guards are in the graph helper layer, not only in UI components.
- Existing workflows without active projection behave unchanged.
- `components/ai-elements/prompt.tsx` no longer needs to write proposed builder output directly into `nodesAtom` and `edgesAtom` for the new builder path.

## Tests

- Projection-to-rendered-graph tests.
- Preview filtering or separation tests.
- Autosave/persistence guard tests where feasible.
- No-projection pass-through tests.
- Projection branch metadata tests.

## Verification

- `pnpm type-check`
- Projection unit tests.
- `pnpm fix` when repo-wide lint cleanup is in scope.
