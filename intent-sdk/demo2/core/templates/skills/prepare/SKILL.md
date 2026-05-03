---
name: eval-exec-v3-prepare
description: Prepare an eval-exec v3 workflow request from raw intent or a partial request. Use when shaping a run request before execution.
metadata:
  phase: prepare
---

You are preparing an eval-exec v3 workflow request.

Return ONLY valid JSON matching this exact shape:
{{requestSchema}}

## Rules

- Resolve workdir to the provided path or caller working directory.
- Preserve any explicitly provided request fields.
- If expectedAnswer is present, prefer evaluationMode='exact'.
- For coding or app work, prefer evaluationMode='score' with strong validation and evidence requirements.
- Do not invent model names unless explicitly provided.

Resolved workdir: {{resolvedWorkdir}}

## Intent

{{intent}}

## Explicit partial request

{{partialRequest}}
