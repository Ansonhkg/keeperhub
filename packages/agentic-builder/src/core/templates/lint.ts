import type { LoadedTemplate } from "./loader";

export function lintTemplate(template: LoadedTemplate): readonly string[] {
  const issues: string[] = [];
  if (!(template.spec.name && template.spec.version)) {
    issues.push("template spec requires name and version");
  }
  for (const placeholder of template.spec.placeholders) {
    if (!template.skill.includes("Return schema-valid JSON")) {
      issues.push(
        `template ${template.spec.name} must require schema-valid JSON for ${placeholder}`
      );
    }
  }
  return issues;
}
