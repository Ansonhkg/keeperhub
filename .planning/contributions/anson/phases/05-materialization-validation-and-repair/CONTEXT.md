# Phase 5 Context: Materialization, Graph-vs-Intent Validation, and Repair

## Why This Phase Exists

Selecting a proposal must create valid KeeperHub workflow graph state. This is the highest-risk phase because it turns builder projection into persisted workflow data.

Graph validation must check more than graph shape. It must prove the graph satisfies the Intent IR requirements that led to the proposal.

## Core Principle

```text
Only accepted proposals materialize.
Only valid graph state persists.
Every satisfied requirement is represented in the graph.
```

## Scope Boundary

This phase does not redesign intent decomposition or tray UX. It consumes accepted projections and produces real workflow updates.

## What Exists Before Phase 5

The builder now has four layers in place:

```text
Intent IR
  -> requirement evaluation and capability matching
  -> builder projection state
  -> preview canvas and decision tray
```

The projection layer already keeps preview graph separate from real graph state:

```text
builderProjectionAtom
renderedWorkflowNodesAtom
renderedWorkflowEdgesAtom
stripBuilderPreviewGraph
```

The tray can select, reject, answer questions, and highlight preview branches.
However, selecting an option currently updates projection state only. It does
not yet convert the selected branch into persisted workflow nodes and edges.

## Phase 5 Responsibility

Phase 5 is the bridge from proposal to real workflow:

```text
preview branch
  -> materialized real graph changes
  -> graph-shape validation
  -> graph-vs-intent validation
  -> bounded repair
  -> commit to workflow atoms
```

This phase should make the select button meaningful without returning to the
old one-shot route behavior.

## Important Existing Contracts

Workflow graph state lives in:

```text
lib/workflow/store.ts
```

Builder projection contracts live in:

```text
lib/agentic-builder/projection/contracts.ts
```

Projection rendering and preview stripping live in:

```text
lib/agentic-builder/projection/graph.ts
```

Projection actions live in:

```text
lib/agentic-builder/projection/store.ts
```

The decision tray is mounted from:

```text
components/ai-elements/prompt.tsx
```

and rendered by:

```text
components/agentic-builder/decision-tray.tsx
```

## Product Behavior

The user experience should stay consistent with the planning UX:

```text
AI proposes
canvas previews
user confirms
system validates
real graph commits
```

The user should never see preview nodes silently become invalid saved workflow
state. If the graph cannot be committed, the preview should stay visible and
the tray should explain what is blocking the commit.

## Data Integrity Risk

Materialization has to defend against three classes of failure:

```text
graph-shape failure
  edge target missing, duplicate ID, invalid action config

intent-satisfaction failure
  prompt requirement disappears during graph creation

unsafe fallback failure
  native capability exists but materialization silently commits generic custom
  behavior instead
```

The validation layer must catch all three before `nodesAtom` and `edgesAtom`
are written.

## Implementation Bias

Keep this phase deterministic and local. Do not call the model during repair.
The model already produced the Intent IR/projection. Phase 5 should inspect
those artifacts and either commit, repair deterministic structure, or ask for
explicit user input.
