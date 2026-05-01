import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";

export const TemplateKeySchema = z.enum(["intent-decomposer"]);

export const TemplateSpecSchema = z
  .object({
    expectedName: z.string().min(1),
    requiredPlaceholders: z.array(z.string().min(1)),
  })
  .strict();

export const SkillTemplateSchema = z
  .object({
    key: TemplateKeySchema,
    filePath: z.string().min(1),
    name: z.string().min(1),
    description: z.string().min(1),
    metadata: z.record(z.string(), z.string()).optional(),
    body: z.string().min(1),
    placeholders: z.array(z.string().min(1)),
  })
  .strict();

export type TemplateKey = z.infer<typeof TemplateKeySchema>;
export type TemplateSpec = z.infer<typeof TemplateSpecSchema>;
export type SkillTemplate = z.infer<typeof SkillTemplateSchema>;

export type TemplateLoadResult = {
  templates: SkillTemplate[];
  errors: string[];
};

const filePath = fileURLToPath(import.meta.url);
const templatesDir = path.join(path.dirname(filePath), "skills");
const TEMPLATE_KEYS: TemplateKey[] = ["intent-decomposer"];
const PLACEHOLDER_PATTERN = /\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g;

let cachedTemplates: Record<TemplateKey, SkillTemplate> | null = null;

export function lintSkillTemplates(
  options: { rootDir?: string; keys?: TemplateKey[] } = {}
): TemplateLoadResult {
  return loadAllTemplates(options.rootDir ?? templatesDir, options.keys ?? TEMPLATE_KEYS);
}

export function getSkillTemplates(): Record<TemplateKey, SkillTemplate> {
  if (cachedTemplates) {
    return cachedTemplates;
  }

  const result = lintSkillTemplates();
  if (result.errors.length > 0) {
    throw new Error(`Skill template lint failed:\n${result.errors.join("\n")}`);
  }

  cachedTemplates = Object.fromEntries(
    result.templates.map((template) => [template.key, template])
  ) as Record<TemplateKey, SkillTemplate>;
  return cachedTemplates;
}

export function getSkillTemplate(key: TemplateKey): SkillTemplate {
  return getSkillTemplates()[key];
}

export function renderSkillTemplate(
  template: SkillTemplate,
  values: Record<string, string>
): string {
  const missing = template.placeholders.filter(
    (placeholder) => !Object.prototype.hasOwnProperty.call(values, placeholder)
  );

  if (missing.length > 0) {
    throw new Error(`Missing template values: ${missing.join(", ")}`);
  }

  return template.body.replace(PLACEHOLDER_PATTERN, (_match, key: string) => {
    return values[key] ?? "";
  });
}

function loadAllTemplates(rootDir: string, keys: TemplateKey[]): TemplateLoadResult {
  const templates: SkillTemplate[] = [];
  const errors: string[] = [];

  for (const key of keys) {
    const result = loadTemplate(rootDir, key);
    if (result.template) {
      templates.push(result.template);
    }
    errors.push(...result.errors);
  }

  return { templates, errors };
}

function loadTemplate(
  rootDir: string,
  key: TemplateKey
): { template?: SkillTemplate; errors: string[] } {
  const skillPath = path.join(rootDir, key, "SKILL.md");
  const errors: string[] = [];

  try {
    const spec = loadSpec(rootDir, key);
    const source = fs.readFileSync(skillPath, "utf8");
    const { frontmatter, body } = parseFrontmatter(source, skillPath);
    const name = readString(frontmatter.name);
    const description = readString(frontmatter.description);
    const metadata =
      frontmatter.metadata === undefined
        ? undefined
        : z.record(z.string(), z.string()).parse(frontmatter.metadata);
    const placeholders = extractPlaceholders(body);

    if (name !== spec.expectedName) {
      errors.push(`${skillPath}: name must be '${spec.expectedName}', got '${name}'`);
    }

    for (const placeholder of spec.requiredPlaceholders.filter(
      (item) => !placeholders.includes(item)
    )) {
      errors.push(`${skillPath}: missing required placeholder '{{${placeholder}}}'`);
    }

    for (const placeholder of placeholders.filter(
      (item) => !spec.requiredPlaceholders.includes(item)
    )) {
      errors.push(`${skillPath}: unknown placeholder '{{${placeholder}}}'`);
    }

    if (errors.length > 0) {
      return { errors };
    }

    return {
      template: SkillTemplateSchema.parse({
        key,
        filePath: skillPath,
        name,
        description,
        metadata,
        body,
        placeholders,
      }),
      errors: [],
    };
  } catch (error) {
    return { errors: [error instanceof Error ? error.message : String(error)] };
  }
}

function loadSpec(rootDir: string, key: TemplateKey): TemplateSpec {
  const specPath = path.join(rootDir, key, "spec.json");
  return TemplateSpecSchema.parse(JSON.parse(fs.readFileSync(specPath, "utf8")));
}

function parseFrontmatter(
  source: string,
  sourcePath: string
): { frontmatter: Record<string, unknown>; body: string } {
  const lines = source.split(/\r?\n/);
  if (lines[0] !== "---") {
    throw new Error(`${sourcePath}: template must start with frontmatter opening ---`);
  }

  const endIndex = lines.indexOf("---", 1);
  if (endIndex === -1) {
    throw new Error(`${sourcePath}: template frontmatter must end with ---`);
  }

  const frontmatterLines = lines.slice(1, endIndex);
  const body = lines.slice(endIndex + 1).join("\n").trim();
  const frontmatter: Record<string, unknown> = {};

  for (let index = 0; index < frontmatterLines.length; index += 1) {
    const line = frontmatterLines[index];
    if (!line?.trim()) {
      continue;
    }

    const match = line.match(/^([A-Za-z0-9_-]+):(?:\s*(.*))?$/);
    if (!match?.[1]) {
      throw new Error(`${sourcePath}: invalid frontmatter line '${line}'`);
    }

    const key = match[1];
    const rawValue = match[2] ?? "";

    if (key === "metadata") {
      const metadata: Record<string, string> = {};
      for (index += 1; index < frontmatterLines.length; index += 1) {
        const nested = frontmatterLines[index];
        if (!nested?.trim()) {
          continue;
        }
        if (!nested.startsWith("  ")) {
          index -= 1;
          break;
        }
        const nestedMatch = nested.trim().match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
        if (!nestedMatch?.[1]) {
          throw new Error(`${sourcePath}: invalid metadata line '${nested}'`);
        }
        metadata[nestedMatch[1]] = unquote(nestedMatch[2] ?? "");
      }
      frontmatter.metadata = metadata;
      continue;
    }

    frontmatter[key] = unquote(rawValue);
  }

  return { frontmatter, body };
}

function extractPlaceholders(body: string): string[] {
  const matches = body.matchAll(PLACEHOLDER_PATTERN);
  return Array.from(
    new Set(
      Array.from(matches, (match) => match[1]).filter(
        (value): value is string => typeof value === "string"
      )
    )
  ).sort();
}

function readString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function unquote(value: string): string {
  const trimmed = value.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}
