import { DEFAULT_PROMPT, runDemo } from "./demo1/adapters/cli.ts";

const args = process.argv.slice(2);
const interactive = args.includes("--interactive");
const quiet = args.includes("--quiet");
const prompt =
  args
    .filter((arg) => arg !== "--interactive" && arg !== "--quiet")
    .join(" ")
    .trim() || DEFAULT_PROMPT;

void runDemo(prompt, {
  interactive,
  liveLog: !quiet,
});
