# Phase 3 Plan: Builder Projection State

## Implementation Steps

1. Define projection contracts in a new `lib/agentic-builder/projection` module.
2. Add a `BuilderProjection` type that stores:
   - projection ID
   - workflow ID
   - source prompt
   - base graph snapshot metadata
   - Phase 1 Intent IR
   - Phase 2 requirement evaluation result
   - preview branches
   - option groups
   - questions
   - validation issues
3. Add explicit preview graph contracts:
   - preview node
   - preview edge
   - branch ID
   - option ID
   - requirement IDs
   - capability match ID or custom proposal ID
4. Add client state for active builder projection in a separate store module.
5. Add projection lifecycle helpers:
   - set projection
   - clear projection
   - answer question locally
   - select option locally
   - reject option locally
6. Add graph helpers:
   - merge real graph and preview graph for rendering
   - identify preview nodes and preview edges by schema
   - strip preview graph from any persistence payload
7. Wire persistence guards into existing save paths:
   - autosave
   - save workflow as
   - import/export or other obvious workflow persistence paths if touched
8. Keep existing workflows unchanged when no projection is active.
9. Add focused unit tests for projection state and preview filtering.

## Candidate Files

Likely new files:

```text
lib/agentic-builder/projection/contracts.ts
lib/agentic-builder/projection/store.ts
lib/agentic-builder/projection/graph.ts
tests/unit/agentic-builder-projection-graph.test.ts
tests/unit/agentic-builder-projection-store.test.ts
```

Likely touched files:

```text
lib/workflow/store.ts
components/workflow/workflow-canvas.tsx
components/ai-elements/prompt.tsx
```

`workflow-canvas.tsx` should only receive a derived rendered graph. It should not become the owner of projection semantics.

`prompt.tsx` should stop being the long-term owner of builder state. In Phase 3 it can remain visually unchanged, but any new builder response should be staged in projection state rather than written directly to workflow atoms.

## Projection Contract

The projection is not a persisted workflow. It is the builder's active proposal:

```text
BuilderProjection
  id
  workflowId
  sourcePrompt
  status
  baseGraph
  intent
  evaluation
  branches
  questions
  validationIssues
```

Branches are candidate graph interpretations:

```text
BuilderPreviewBranch
  id
  optionId
  title
  rationale
  risk
  requirementIds
  previewNodes
  previewEdges
```

Preview graph items must be identifiable from data, not styling:

```text
data.builderPreview = true
data.builderProjectionId = projection.id
data.builderBranchId = branch.id
data.builderOptionId = branch.optionId
data.builderRequirementIds = [...]
```

CSS classes may decorate previews later, but they are not the source of truth.

## Initial Session Policy

Start with client-held projection state plus server-generated responses. Do not add database-backed builder sessions in this phase unless required by implementation discovery.

## Rendering Model

```text
renderedNodes = realNodes + previewNodes
renderedEdges = realEdges + previewEdges
```

Persistence model:

```text
saveNodes = realNodes
saveEdges = realEdges
```

Phase 3 should expose this as a helper:

```text
projectWorkflowGraph(realGraph, projection) -> renderedGraph
stripBuilderPreviewGraph(renderedGraph) -> realGraph
```

The persistence path should call the strip helper even if it normally receives only real graph state. That guard makes accidental preview leakage fail closed.

## Out of Scope

- Final grey/dashed styling.
- Decision tray UI.
- Server-backed builder sessions.
- Real workflow materialization.
- Graph-vs-intent validation and repair.
- Prompt history and keyboard recall.
