import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";

export const TemplateKeySchema = z.enum([
  "prepare",
  "executor",
  "evaluator",
  "fixer",
]);

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
    license: z.string().min(1).optional(),
    metadata: z.record(z.string(), z.string()).optional(),
    body: z.string().min(1),
    placeholders: z.array(z.string().min(1)),
  })
  .strict();

export type TemplateKey = z.infer<typeof TemplateKeySchema>;
export type TemplateSpec = z.infer<typeof TemplateSpecSchema>;
export type SkillTemplate = z.infer<typeof SkillTemplateSchema>;

export type TemplateLintResult = {
  templates: SkillTemplate[];
  errors: string[];
};

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const templatesDir = path.join(__dirname, "skills");
const TEMPLATE_KEYS: TemplateKey[] = [
  "prepare",
  "executor",
  "evaluator",
  "fixer",
];

let cachedTemplates: Record<TemplateKey, SkillTemplate> | null = null;

export function renderTemplate(
  template: string,
  variables: Record<string, string>
): string {
  return template.replace(
    /\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g,
    (_match, key: string) => {
      if (!Object.hasOwn(variables, key)) {
        throw new Error(`Missing template variable: ${key}`);
      }
      return variables[key]!;
    }
  );
}

export function lintSkillTemplates(): TemplateLintResult {
  return loadAllTemplates();
}

export function getSkillTemplates(): Record<TemplateKey, SkillTemplate> {
  if (cachedTemplates) return cachedTemplates;

  const result = loadAllTemplates();
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

function loadAllTemplates(): TemplateLintResult {
  const templates: SkillTemplate[] = [];
  const errors: string[] = [];

  for (const key of TEMPLATE_KEYS) {
    const result = loadTemplate(key);
    if (result.template) templates.push(result.template);
    errors.push(...result.errors);
  }

  return { templates, errors };
}

function loadTemplate(key: TemplateKey): {
  template?: SkillTemplate;
  errors: string[];
} {
  const filePath = path.join(templatesDir, key, "SKILL.md");
  const errors: string[] = [];

  try {
    const spec = loadSpec(key);
    const source = fs.readFileSync(filePath, "utf8");
    const { frontmatter, body } = parseFrontmatter(source, filePath);
    const name = readString(frontmatter.name);
    const description = readString(frontmatter.description);
    const license = readOptionalString(frontmatter.license);
    const metadata =
      frontmatter.metadata === undefined
        ? undefined
        : z.record(z.string(), z.string()).parse(frontmatter.metadata);
    const placeholders = extractPlaceholders(body);

    if (name !== spec.expectedName) {
      errors.push(
        `${filePath}: name must be '${spec.expectedName}', got '${name}'`
      );
    }
    for (const placeholder of spec.requiredPlaceholders.filter(
      (item) => !placeholders.includes(item)
    )) {
      errors.push(
        `${filePath}: missing required placeholder '{{${placeholder}}}'`
      );
    }
    for (const placeholder of placeholders.filter(
      (item) => !spec.requiredPlaceholders.includes(item)
    )) {
      errors.push(`${filePath}: unknown placeholder '{{${placeholder}}}'`);
    }

    if (errors.length > 0) return { errors };

    return {
      template: SkillTemplateSchema.parse({
        key,
        filePath,
        name,
        description,
        license,
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

function loadSpec(key: TemplateKey): TemplateSpec {
  const specPath = path.join(templatesDir, key, "spec.json");
  return TemplateSpecSchema.parse(
    JSON.parse(fs.readFileSync(specPath, "utf8"))
  );
}

function parseFrontmatter(
  source: string,
  filePath: string
): { frontmatter: Record<string, unknown>; body: string } {
  const lines = source.split(/\r?\n/);
  if (lines[0] !== "---") {
    throw new Error(
      `${filePath}: template must start with frontmatter opening ---`
    );
  }

  const endIndex = lines.indexOf("---", 1);
  if (endIndex === -1) {
    throw new Error(`${filePath}: template frontmatter must end with ---`);
  }

  const frontmatterLines = lines.slice(1, endIndex);
  const body = lines
    .slice(endIndex + 1)
    .join("\n")
    .trim();
  const frontmatter: Record<string, unknown> = {};

  for (let i = 0; i < frontmatterLines.length; i += 1) {
    const line = frontmatterLines[i];
    if (typeof line !== "string" || !line.trim()) continue;

    const match = line.match(/^([A-Za-z0-9_-]+):(?:\s*(.*))?$/);
    if (!match)
      throw new Error(`${filePath}: invalid frontmatter line '${line}'`);

    const key = match[1];
    const rawValue = match[2] ?? "";
    if (!key)
      throw new Error(`${filePath}: invalid frontmatter key in line '${line}'`);

    if (key === "metadata") {
      const metadata: Record<string, string> = {};
      for (i += 1; i < frontmatterLines.length; i += 1) {
        const nested = frontmatterLines[i];
        if (typeof nested !== "string" || !nested.trim()) continue;
        if (!nested.startsWith("  ")) {
          i -= 1;
          break;
        }
        const nestedMatch = nested.trim().match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
        if (!nestedMatch?.[1])
          throw new Error(`${filePath}: invalid metadata line '${nested}'`);
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
  const matches = body.matchAll(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g);
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

function readOptionalString(value: unknown): string | undefined {
  const text = readString(value);
  return text || undefined;
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
