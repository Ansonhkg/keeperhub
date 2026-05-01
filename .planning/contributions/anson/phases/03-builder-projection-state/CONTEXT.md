# Phase 3 Context: Builder Projection State

## Why This Phase Exists

AI proposals must not be written directly into persisted workflow state. The editor needs real graph state and builder preview state to be separate by construction.

## Core Principle

```text
Editor graph = persisted workflow state
Builder projection = proposal state
```

The canvas may render both, but autosave and workflow persistence should only see real nodes and edges.

## Current Code Risk

The current prompt path still streams AI output directly into editor atoms:

```text
components/ai-elements/prompt.tsx
  -> setNodes(partialData.nodes)
  -> setEdges(partialData.edges)
```

The persistence path currently reads the same atoms:

```text
lib/workflow/store.ts
  autosaveAtom -> api.workflow.update(workflowId, { nodes, edges })
  saveWorkflowAsAtom -> api.workflow.create({ nodes, edges })
```

That means any preview graph written into `nodesAtom` or `edgesAtom` can become persisted workflow state. Phase 3 exists to remove that class of bug before preview UI work starts.

## Phase 2 Inputs

Phase 3 should consume the Phase 2 evaluation output shape:

```text
BuilderIntentDraft
  -> RequirementEvaluationResult
  -> BuilderProjection
```

The projection should preserve:

```text
requirements
unresolved questions
task candidates
option groups
capability matches
custom node proposals
assumptions
validation issues
```

Projection state is a staging model. It is not a workflow graph and should not be shaped around React Flow persistence.

## Scope Boundary

This phase creates state and projection contracts. It does not need final styling or full decision tray UX.

It may add minimal derived graph helpers for tests, but it should not implement the final grey-node visual design or decision tray interactions. Those belong to Phase 4.
