# Phase 5 Plan: Materialization, Graph-vs-Intent Validation, and Repair

## Status

Complete.

## Goal

Turn an accepted preview branch into real KeeperHub workflow graph state, but only
after validating that the materialized graph still satisfies the Intent IR.

Phase 4 made the proposal inspectable. Phase 5 makes the accepted proposal real.

## Current Starting Point

Phase 4 leaves us with this local flow:

```text
builderProjectionAtom
  -> rendered preview nodes and edges
  -> DecisionTray select/reject/answer actions
```

Selection currently marks the projection as accepted, but it does not yet create
real `nodesAtom` or `edgesAtom` entries. The next implementation should replace
that placeholder behavior with a materialization pipeline.

## Target Flow

```text
Select option
  -> locate selected preview branch
  -> block if unresolved required questions remain
  -> convert preview nodes/edges into real workflow nodes/edges
  -> validate graph shape
  -> validate graph against Intent IR requirements
  -> repair deterministic graph-shape problems
  -> commit nodesAtom/edgesAtom
  -> clear or advance builderProjectionAtom
  -> trigger normal autosave
```

The materializer must consume the projection and base graph. It should not parse
tray labels or re-ask the model what to do.

## Implementation Steps

1. Add a materialization contract:
   - selected option ID
   - projection ID
   - base graph snapshot
   - selected preview branch
   - resulting graph
   - validation result
   - repair result
2. Add `materializeBuilderProjection`:
   - require `projection.status === "accepted"` or explicit selected option input
   - locate the selected branch by `optionId` or branch ID
   - strip all `builderPreview` metadata
   - preserve stable node labels, config, positions, handles, and edge shape
   - generate collision-safe real node and edge IDs
   - append materialized nodes/edges to the real base graph
3. Add graph-shape validation:
   - all edge sources and targets exist
   - no duplicate node IDs or edge IDs
   - action nodes have an `actionType` or are explicit pending/custom nodes
   - trigger nodes have valid trigger config
   - schedule trigger config is valid enough for the current app schema
   - conditional/loop branch handles reference known handles when present
4. Add graph-vs-intent validation:
   - every satisfied requirement is represented by at least one materialized
     node, edge, config field, branch, or custom proposal
   - unresolved blocking requirements are still questions and block commit
   - unresolved non-blocking requirements remain visible as pending config
   - `or` option groups materialize exactly the selected branch
   - `and` clauses materialize all required tasks
   - temporal requirements are preserved in trigger/config fields
   - condition requirements are preserved in condition config
   - state/baseline requirements are not collapsed into a plain read
   - native matches are used before custom proposals when a native match exists
5. Add bounded repair:
   - fix duplicate generated IDs
   - drop preview-only metadata from nodes/edges
   - reconnect an obvious missing sequential edge when both endpoints are known
   - normalize deterministic schedule values when possible
   - never invent missing destinations, thresholds, providers, assets, or actions
6. Add a commit atom:
   - `commitBuilderProjectionAtom`
   - reads `builderProjectionAtom`, `nodesAtom`, and `edgesAtom`
   - runs materialization, validation, and repair
   - writes real nodes/edges only on success
   - updates projection issues/questions on failure
   - clears selection/highlight after success
7. Wire `DecisionTray` select action to commit behavior:
   - selection should commit only when the selected option is valid
   - invalid selections should keep preview visible and show issues/questions
   - rejection remains projection-only
8. Add focused tests around materialization, graph validation, intent validation,
   repair, and the commit atom.

## Candidate Files

Likely new files:

```text
lib/agentic-builder/materialization/contracts.ts
lib/agentic-builder/materialization/materializer.ts
lib/agentic-builder/materialization/graph-validator.ts
lib/agentic-builder/materialization/intent-validator.ts
lib/agentic-builder/materialization/repair.ts
tests/unit/agentic-builder-materializer.test.ts
tests/unit/agentic-builder-graph-validator.test.ts
tests/unit/agentic-builder-intent-validator.test.ts
tests/unit/agentic-builder-materialization-store.test.ts
```

Likely touched files:

```text
components/ai-elements/prompt.tsx
lib/agentic-builder/projection/contracts.ts
lib/agentic-builder/projection/store.ts
lib/agentic-builder/projection/graph.ts
lib/workflow/store.ts
```

Only touch `lib/workflow/store.ts` if the commit atom needs normal history,
unsaved-change, autosave, or selection behavior that belongs next to existing
workflow mutation atoms.

## Materialization Contract

Preview graph data is staging data. Real graph data must not keep builder-only
fields:

```text
builderPreview
builderProjectionId
builderBranchId
builderOptionId
builderRequirementIds
builderCapabilityMatchId
builderCustomProposalId
builderHighlighted
```

The materializer may use those fields while validating, but the final persisted
workflow graph must not contain them.

## Validation Contract

Validation should return structured issues, not plain thrown strings:

```text
valid: boolean
issues:
  - id
  - severity
  - code
  - message
  - nodeIds
  - edgeIds
  - requirementIds
```

Projection validation issues can reuse the Phase 3/4 tray issue shape for UI,
but internal validators should keep machine-readable `code` values for tests.

## Blocking Rules

Commit must be blocked when:

```text
selected branch does not exist
selected branch has no materializable nodes
blocking question has no answer
graph-shape validation has error issues after repair
graph-vs-intent validation has error issues after repair
custom proposal is missing expected input/output description
native capability exists but selected branch silently used custom fallback
```

Commit may proceed with warning issues only when the resulting graph is still
executable or clearly marked as pending user configuration.

## Repair Rule

Repair may fix structure. Repair must not invent missing user preferences.

Examples:

```text
duplicate generated ID -> repair
preview metadata present in real node -> repair
missing edge between obvious sequential preview steps -> repair
invalid cron generated from known interval -> repair if deterministic
unknown notification destination -> ask question
ambiguous "moves" threshold -> ask question
silently dropped "for 30 seconds" temporal window -> fail validation
missing false branch from "if not, log it" -> fail validation
```

## UX Contract

On successful select:

```text
preview lane disappears
real nodes remain in the canvas
normal workflow autosave runs
decision tray closes or advances to the next unresolved projection
```

On blocked select:

```text
preview lane remains
decision tray shows exact questions or validation issues
no real workflow state is written
autosave is not triggered
```

On repair:

```text
if repaired successfully, commit proceeds
if repair cannot be deterministic, tray shows the issue and asks for input
```

## Fixtures

Use focused fixtures rather than broad model-driven tests in this phase:

```text
Slack or Email -> selecting Slack commits only Slack branch
Slack and Email -> selecting option commits both notification nodes
Slack me when ETH moves -> blocks until threshold and interval are answered
Track ETH price every 15 minutes and send Slack -> commits trigger/read/notify
Chronicle missing native -> commits explicit custom node proposal, not HTTP
condition with true/false -> fails when false branch is dropped
stateful baseline -> fails when store/read baseline step is dropped
```

## Out of Scope

- Prompt-family evaluation matrix.
- Prompt history and ArrowUp/ArrowDown recall.
- Server-backed builder sessions.
- Replacing the prompt route end to end.
- Browser-level visual polish for the tray.

Those belong to Phase 6 or a later integration phase.
