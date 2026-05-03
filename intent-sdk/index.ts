export * from "./src/sdk/index.js";

if (import.meta.main) {
  console.log("eval-sdk v4 exports the SDK from this entrypoint.");
  console.log("Run `pnpm intent:demo` to execute the v4 consolidation demo.");
}
