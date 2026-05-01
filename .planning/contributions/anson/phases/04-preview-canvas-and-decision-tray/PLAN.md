# Phase 4 Plan: Preview Canvas and Decision Tray

## Implementation Steps

1. Add preview rendering helpers over the Phase 3 projection schema:
   - `isBuilderPreviewNode`
   - `isBuilderPreviewEdge`
   - active highlighted branch/option ID
   - preview lane highlight state
2. Add preview styling for action and trigger nodes:
   - grey border
   - dashed border
   - muted icon/text
   - disabled handles
   - no selected-state emphasis
   - data attributes for testing
3. Add dashed preview edge rendering:
   - lower emphasis stroke
   - no animated execution styling
   - highlighted branch state
   - data attributes for testing
4. Keep preview elements non-interactive:
   - not draggable
   - not selectable
   - not connectable
   - not editable through the node config panel
5. Build a decision tray that reads from `builderProjectionAtom`:
   - planning badge
   - suggested options
   - recommended badge
   - risk indicator
   - select action
   - reject action
   - inline questions
   - custom node proposal state
   - validation issue display
6. Add hover/focus sync:
   - tray option hover highlights matching preview lane
   - tray option focus highlights matching preview lane
   - leaving hover/focus clears only the highlight state
7. Add local projection actions:
   - select option -> call `selectBuilderProjectionOptionAtom`
   - reject option -> call `rejectBuilderProjectionOptionAtom`
   - answer question -> call `answerBuilderProjectionQuestionAtom`
   - clear projection -> call `clearBuilderProjectionAtom`
8. Add pending action states for select/reject/answer.
9. Add focused tests for decision tray rendering and interaction state.
10. Add browser/manual QA for hover/focus canvas highlighting.

## Candidate Files

Likely new files:

```text
components/agentic-builder/decision-tray.tsx
components/agentic-builder/preview-styles.ts
tests/unit/agentic-builder-decision-tray.test.tsx
```

Likely touched files:

```text
components/ai-elements/prompt.tsx
components/ai-elements/edge.tsx
components/workflow/nodes/action-node.tsx
components/workflow/nodes/trigger-node.tsx
components/workflow/workflow-canvas.tsx
lib/agentic-builder/projection/store.ts
```

Optional helper files if the component starts to sprawl:

```text
lib/agentic-builder/projection/highlight.ts
lib/agentic-builder/projection/view-model.ts
```

## Interaction Contract

The decision tray should be a projection viewer/controller:

```text
builderProjectionAtom
  -> tray rows/questions/issues
  -> local highlight atom
  -> projected node/edge highlight
```

Selection and rejection are still projection state only:

```text
Select option -> projection.status = accepted
Reject option -> branch removed/rejected in projection
Answer question -> question.answer stored in projection
```

Phase 4 must not persist workflow graph changes when an option is selected. Phase 5 owns materialization.

## Preview Highlighting

Highlighting should use stable projection IDs:

```text
branch.id
optionId
data.builderBranchId
data.builderOptionId
```

The tray should set the active branch/option on hover and focus. Preview nodes and edges should read that state and apply a stronger preview style only when they match.

## Non-Interactive Preview Rules

Preview elements should not enter normal editor workflows:

```text
onNodesChange should not mutate preview items
onEdgesChange should not mutate preview items
node config panel should not open for preview nodes
connection handlers should reject preview source/target nodes
context menu should not open for preview elements
```

If any of these are too invasive for Phase 4, implement the canvas-level guard first and document the remaining UI guard for Phase 5. The persistence guard from Phase 3 remains the final safety net, not the primary UX behavior.

## Data Requirements

Phase 4 can work with mocked or locally seeded `BuilderProjection` fixtures in tests. It does not need the full planning API yet.

Fixture projections should cover:

```text
single recommended branch
or-option branches
required multi-node branch
blocking question
custom node proposal
validation issue
```

## UX Fixtures

`Notify me via Slack or Email`:

```text
two option rows
two preview lanes
hover Slack -> highlight Slack lane
hover Email -> highlight Email lane
```

`Notify me via Slack and Email`:

```text
one recommended option
preview contains both Slack and Email nodes
```

`Create a v0 landing page site`:

```text
Custom Node proposal
Request native feature secondary action
```

`Slack me when ETH moves`:

```text
question row asks for threshold
preview remains visible but blocked from commit
```

`Track ETH price every 15 minutes and send a Slack message`:

```text
one recommended branch
preview shows trigger/check/notify flow
tray explains the resolved interval and Slack action
```

## Out of Scope

- Real workflow graph materialization.
- Graph-vs-intent validation and repair.
- Prompt history and ArrowUp/ArrowDown recall.
- Server-backed builder sessions.
- Replacing the legacy one-shot generator end to end.
