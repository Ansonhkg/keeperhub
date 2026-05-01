import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

import {
  getSkillTemplate,
  lintSkillTemplates,
  renderSkillTemplate,
} from "@/lib/agentic-builder/templates/loader";

describe("agentic builder template loader", () => {
  it("loads the intent-decomposer SKILL.md template", () => {
    const result = lintSkillTemplates();

    expect(result.errors).toEqual([]);
    expect(result.templates).toHaveLength(1);
    expect(result.templates[0]?.name).toBe("keeperhub-intent-decomposer");
    expect(result.templates[0]?.placeholders).toEqual([
      "builderRuleGuide",
      "capabilityCatalogSummary",
      "contextSummary",
      "intentSchema",
      "requirementKindGuide",
      "requirementStatusGuide",
      "userPrompt",
    ]);
  });

  it("renders only when every template value is present", () => {
    const template = getSkillTemplate("intent-decomposer");

    expect(() =>
      renderSkillTemplate(template, {
        capabilityCatalogSummary: "Slack, Email",
        builderRuleGuide: "- Rule",
        contextSummary: "Empty workflow",
        intentSchema: "{}",
        requirementKindGuide: "- notification",
        requirementStatusGuide: "- resolved: supplied.",
      })
    ).toThrow("Missing template values: userPrompt");

    expect(
      renderSkillTemplate(template, {
        capabilityCatalogSummary: "Slack, Email",
        builderRuleGuide: "- Rule",
        contextSummary: "Empty workflow",
        intentSchema: "{}",
        requirementKindGuide: "- notification",
        requirementStatusGuide: "- resolved: supplied.",
        userPrompt: "Notify me via Slack",
      })
    ).toContain("Notify me via Slack");
  });

  it("reports frontmatter name, missing placeholder, and unknown placeholder errors", () => {
    const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "agentic-template-"));
    const templateDir = path.join(rootDir, "intent-decomposer");
    fs.mkdirSync(templateDir, { recursive: true });
    fs.writeFileSync(
      path.join(templateDir, "spec.json"),
      JSON.stringify({
        expectedName: "keeperhub-intent-decomposer",
        requiredPlaceholders: ["userPrompt", "intentSchema"],
      })
    );
    fs.writeFileSync(
      path.join(templateDir, "SKILL.md"),
      [
        "---",
        "name: wrong-name",
        "description: Broken test template",
        "---",
        "",
        "{{userPrompt}}",
        "{{extraValue}}",
      ].join("\n")
    );

    const result = lintSkillTemplates({ rootDir, keys: ["intent-decomposer"] });

    expect(result.templates).toEqual([]);
    expect(result.errors.join("\n")).toContain(
      "name must be 'keeperhub-intent-decomposer', got 'wrong-name'"
    );
    expect(result.errors.join("\n")).toContain(
      "missing required placeholder '{{intentSchema}}'"
    );
    expect(result.errors.join("\n")).toContain(
      "unknown placeholder '{{extraValue}}'"
    );
  });
});
