const DEFAULT_OPENAI_BASE_URL = "https://api.openai.com/v1";
const TRAILING_SLASHES_REGEX = /\/+$/;
const LEADING_SLASHES_REGEX = /^\/+/;

function normalizeOpenAICompatibleBaseURL(
  baseURL: string | undefined
): string | undefined {
  const trimmed = baseURL?.trim();
  return trimmed ? trimmed : undefined;
}

export function getOpenAICompatibleClientOptions(
  apiKey: string,
  baseURL = process.env.OPENAI_BASE_URL
): { apiKey: string; baseURL?: string } {
  const normalizedBaseURL = normalizeOpenAICompatibleBaseURL(baseURL);

  if (!normalizedBaseURL) {
    return { apiKey };
  }

  return {
    apiKey,
    baseURL: normalizedBaseURL,
  };
}

export function buildOpenAICompatibleApiUrl(
  path: string,
  baseURL = process.env.OPENAI_BASE_URL
): string {
  const apiBaseURL =
    normalizeOpenAICompatibleBaseURL(baseURL) ?? DEFAULT_OPENAI_BASE_URL;
  const normalizedBaseURL = `${apiBaseURL.replace(TRAILING_SLASHES_REGEX, "")}/`;
  const normalizedPath = path.replace(LEADING_SLASHES_REGEX, "");

  return new URL(normalizedPath, normalizedBaseURL).toString();
}
