export type JsonBlockMatcher = (value: unknown) => boolean;

export function extractJsonBlock(
  text: string,
  matches?: JsonBlockMatcher
): string {
  const trimmed = text.trim();

  const candidates = [
    ...fencedJsonCandidates(trimmed),
    ...genericFenceCandidates(trimmed),
    ...embeddedJsonCandidates(trimmed),
  ];

  if (matches) {
    for (const candidate of candidates) {
      const parsed = parseJson(candidate);
      if (parsed.ok && matches(parsed.value)) {
        return candidate;
      }
    }
    throw new Error(
      `Could not find JSON matching expected schema in adapter output: ${trimmed.slice(0, 400)}`
    );
  }

  for (const candidate of candidates) {
    if (parseJson(candidate).ok) {
      return candidate;
    }
  }

  throw new Error(
    `Could not find JSON in adapter output: ${trimmed.slice(0, 400)}`
  );
}

function* fencedJsonCandidates(text: string): Generator<string> {
  for (const match of text.matchAll(/```\s*json\s*\n([\s\S]*?)```/gi)) {
    const candidate = match[1]?.trim();
    if (candidate) {
      yield candidate;
    }
  }
}

function* genericFenceCandidates(text: string): Generator<string> {
  for (const match of text.matchAll(/```\s*[^\n]*\n([\s\S]*?)```/g)) {
    const candidate = match[1]?.trim();
    if (candidate) {
      yield candidate;
    }
  }
}

function* embeddedJsonCandidates(text: string): Generator<string> {
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (char !== "{" && char !== "[") {
      continue;
    }

    const candidate = readBalancedJson(text, index);
    if (candidate && parseJson(candidate).ok) {
      yield candidate;
    }
  }
}

function readBalancedJson(text: string, start: number): string | null {
  const stack: string[] = [];
  let inString = false;
  let escaped = false;

  for (let index = start; index < text.length; index += 1) {
    const char = text[index];

    if (inString) {
      if (escaped) {
        escaped = false;
        continue;
      }
      if (char === "\\") {
        escaped = true;
        continue;
      }
      if (char === '"') {
        inString = false;
      }
      continue;
    }

    if (char === '"') {
      inString = true;
      continue;
    }

    if (char === "{") {
      stack.push("}");
      continue;
    }

    if (char === "[") {
      stack.push("]");
      continue;
    }

    if (char === "}" || char === "]") {
      if (stack.pop() !== char) {
        return null;
      }

      if (stack.length === 0) {
        return text.slice(start, index + 1);
      }
    }
  }

  return null;
}

type ParseJsonResult = { ok: true; value: unknown } | { ok: false };

function parseJson(value: string): ParseJsonResult {
  try {
    return { ok: true, value: JSON.parse(value) };
  } catch {
    return { ok: false };
  }
}
