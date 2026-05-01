# Phase 4 Context: Preview Canvas and Decision Tray

## Why This Phase Exists

The builder's proposal must be visible and inspectable before commit. The user needs to connect written options in the tray to preview structure on the canvas.

## UX Principle

```text
AI proposes.
Canvas previews.
User confirms.
```

Preview nodes should feel weaker than real nodes: grey, dashed, disabled, and clearly not yet saved.

## Phase 3 Starting Point

Phase 3 added the staging model that Phase 4 should consume:

```text
lib/agentic-builder/projection/contracts.ts
lib/agentic-builder/projection/graph.ts
lib/agentic-builder/projection/store.ts
```

The canvas already has a derived render path:

```text
real nodes/edges + builder projection preview nodes/edges
```

Phase 4 should not write preview graph into `nodesAtom` or `edgesAtom`. It should render and interact through projection state.

## Current UI Risk

The current prompt component is still the legacy one-shot generator:

```text
components/ai-elements/prompt.tsx
  -> api.ai.generateStream
  -> setNodes(...)
  -> setEdges(...)
```

Phase 4 should introduce the visible agentic-builder shell without expanding that legacy path. The prompt may remain visually colocated, but the new decision tray should read from `builderProjectionAtom` and call projection lifecycle atoms.

## Phase 4 Product Boundary

This phase makes proposals inspectable and selectable. It does not turn an accepted option into persisted real workflow nodes. That commit step belongs to Phase 5.

Phase 4 can mark a projection option as selected/rejected and answer questions in projection state. Phase 5 will materialize selected branches.

## Scope Boundary

This phase focuses on interaction and preview. It should not own final graph materialization logic beyond invoking the next phase's API/handler shape.
