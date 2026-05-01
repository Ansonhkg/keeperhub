# Phase 4 Acceptance

## Done Means

- Decision tray is driven by `builderProjectionAtom`, not legacy streamed workflow JSON.
- Preview nodes render as grey/dashed/disabled.
- Preview edges render as dashed and lower emphasis.
- Preview elements are not draggable, selectable, or connectable.
- Decision tray appears during planning and when projection has options/questions/issues.
- Options can be hovered or focused to highlight matching preview lanes.
- Inline questions can be answered from the tray.
- Custom Node proposal state is visible and distinct from native action proposals.
- Validation issues are visible and mapped to affected requirements where possible.
- Selecting an option updates projection state only and does not persist workflow graph changes.
- Rejecting an option removes or marks the projection branch without mutating real workflow nodes.
- Preview highlighting uses projection metadata, not labels or CSS selectors.
- Existing workflows without active projection render unchanged.
- Persistence guards from Phase 3 remain intact.

## Accessibility

- Option rows are keyboard focusable.
- Focus highlighting matches hover highlighting.
- Buttons have accessible labels where icon-only.
- Inline question inputs have labels.
- Tray status changes are understandable without relying on color alone.

## Fixture Outcomes

- `Notify me via Slack or Email` shows two options and two preview lanes.
- `Notify me via Slack and Email` shows one option with both notification nodes.
- `Send a Slack message about a SendGrid outage` keeps SendGrid outage as message subject text.
- `Create a v0 landing page site` shows Custom Node proposal and secondary request-native action.
- `Slack me when ETH moves` shows a blocking threshold question.

## Verification

- `pnpm type-check`
- Component tests for tray behavior.
- Projection interaction tests for select/reject/answer/highlight.
- Browser/manual test for hover/focus preview highlighting.
- `pnpm fix` when repo-wide lint cleanup is in scope.
