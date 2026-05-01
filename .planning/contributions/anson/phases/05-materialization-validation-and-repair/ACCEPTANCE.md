# Phase 5 Acceptance

## Done Means

- Selecting an option runs the materialization pipeline instead of only marking
  the projection accepted.
- A selected preview branch becomes real workflow nodes and edges only after
  validation passes.
- Rejected options do not persist.
- Preview graph is removed or advanced after successful materialization.
- Failed materialization keeps the preview graph visible and shows blocking
  questions or validation issues in the tray.
- Validation prevents invalid graph persistence.
- Graph-vs-intent validation prevents requirements from being silently dropped.
- Repair handles bounded structural errors without inventing user preferences.
- Blocking unresolved requirements produce questions instead of guessed values.
- Real persisted nodes and edges do not contain builder preview metadata.

## Validation Cases

- Selected option ID does not match any branch.
- Preview branch has no materializable nodes.
- Duplicate node IDs or edge IDs.
- Edge source does not exist.
- Edge target does not exist.
- Unknown action type.
- Invalid trigger config.
- Invalid schedule config.
- Missing Slack destination.
- Missing email recipient.
- Custom Node missing expected input/output description.
- Satisfied requirement not represented by any graph node/config/edge.
- `or` option materializes more than the selected branch.
- `and` clause materializes only one required task.
- Required true branch or false branch missing.
- Temporal duration/window dropped during materialization.
- State/baseline requirement collapsed into a plain read.
- Native capability exists but materialization silently chooses custom fallback.
- Builder preview metadata leaks into the committed graph.

## Required Tests

- Materializer strips preview metadata and appends real graph nodes/edges.
- Materializer generates collision-safe real IDs.
- Commit is blocked when required questions have no answers.
- Commit is blocked when graph-shape validation has error issues.
- Commit is blocked when graph-vs-intent validation has error issues.
- Deterministic repair fixes duplicate IDs or missing obvious sequential edges.
- Repair does not invent thresholds, notification destinations, or providers.
- Successful commit clears the projection and writes real workflow graph state.
- Failed commit leaves the projection visible with validation issues.
- Selecting `Slack or Email` commits only the selected branch.
- Selecting `Slack and Email` commits both notification requirements.

## Verification

- `pnpm type-check`
- Focused unit tests for materialization, graph validation, intent validation,
  repair, and the commit atom.
- `git diff --check`

Run `pnpm fix` only when repo-wide lint/format cleanup is intentionally in
scope. Avoid unrelated formatter churn while implementing this phase.

## Manual Smoke

- Seed or create a projection with two option branches.
- Select one option.
- Confirm the preview lane disappears and real nodes remain.
- Confirm the unselected branch is not persisted.
- Confirm autosave receives only real nodes and edges.
- Try selecting an option with an unanswered blocking question.
- Confirm no real graph write occurs and the tray shows the question.
