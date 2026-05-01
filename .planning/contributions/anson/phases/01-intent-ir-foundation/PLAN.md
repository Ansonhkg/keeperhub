# Phase 1 Plan: Intent IR Foundation

## Implementation Steps

1. Create the new builder foundation under `lib/agentic-builder/`.
2. Define the first-class Intent IR domain contracts:
   - `BuilderIntentDraft`
   - `IntentClause`
   - `IntentRequirement`
   - `RequirementStatus`
   - `UnresolvedRequirement`
   - `BuilderAssumption`
3. Define source-of-truth spec files under `lib/agentic-builder/intent/spec/` for:
   - requirement vocabulary
   - derived enum sources
   - prompt rules and prompt guidance
   - Intent IR JSON schema shape
   - generated TypeScript template
4. Add a template system that follows the eval-exec-loop v3 convention:
   - `templates/skills/<template-key>/SKILL.md`
   - `templates/skills/<template-key>/spec.json`
5. Add the first new template: `intent-decomposer`.
6. Make the decomposer output Intent IR, not workflow graph operations and not JSONL editor mutations.
7. Generate checked-in app-facing artifacts from the spec files before `pnpm dev` and `pnpm build`:
   - typed vocabulary TypeScript
   - prompt guidance JSON
   - Intent IR JSON schema
8. Add schema validation for decomposer output before any later phase can materialize a graph.
9. Add focused tests for template loading, placeholder validation, Intent IR schema validation, and generated artifact/spec alignment.

## Candidate Files

```text
lib/agentic-builder/intent/contracts.ts
lib/agentic-builder/intent/schema.ts
lib/agentic-builder/intent/decomposer.ts
lib/agentic-builder/intent/spec/vocabulary.json
lib/agentic-builder/intent/spec/enum-sources.json
lib/agentic-builder/intent/spec/rules.json
lib/agentic-builder/intent/spec/status-descriptions.json
lib/agentic-builder/intent/spec/prompt-guidance.json
lib/agentic-builder/intent/spec/prompt-rules.json
lib/agentic-builder/intent/spec/vocabulary.ts.template
lib/agentic-builder/intent/spec/builder-intent-draft.schema.json
lib/agentic-builder/intent/generated/vocabulary.ts
lib/agentic-builder/intent/generated/prompt-guidance.json
lib/agentic-builder/intent/generated/builder-intent-draft.schema.json
lib/agentic-builder/templates/loader.ts
lib/agentic-builder/templates/skills/intent-decomposer/SKILL.md
lib/agentic-builder/templates/skills/intent-decomposer/spec.json
scripts/agentic-builder/generate-artifacts.ts
tests/unit/agentic-builder-intent-contracts.test.ts
tests/unit/agentic-builder-template-loader.test.ts
```

## Migration Rule

Do not extend or wrap the current JSONL workflow-generation prompt.

The current `/api/ai/generate` route is outside the new builder foundation. Phase 1 should not extract from it, wrap it, or depend on it. New builder work must start from the Intent IR path:

```text
prompt -> intent-decomposer -> Intent IR -> requirement statuses
```

No Phase 1 code should emit editor operations, create React Flow nodes, or mutate workflow state.

## Source of Truth Rule

Editable builder contract meaning belongs under:

```text
lib/agentic-builder/intent/spec/
```

App-facing generated artifacts belong under:

```text
lib/agentic-builder/intent/generated/
```

Generated files may repeat values from spec files. Runtime code, route handlers, tests, and `SKILL.md` should not duplicate requirement statuses, requirement kinds, connector vocabulary, resolved-status rules, prompt status descriptions, prompt rules, or schema enum lists.
