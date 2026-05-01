import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["**/*.test.ts", "**/*.test.tsx"],
    exclude: [
      "node_modules",
      ".next",
      "tests/e2e/playwright",
      ".pnpm-store",
      ".worktrees",
      "**/.worktrees/**",
    ],
    coverage: {
      provider: "v8",
      reporter: ["text", "json", "html"],
      include: ["lib/**/*.ts", "app/api/**/*.ts", "scripts/**/*.ts"],
      exclude: ["**/*.test.ts", "**/*.d.ts"],
    },
    setupFiles: ["./tests/setup.ts"],
    testTimeout: 10_000,
    fileParallelism: false,
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./"),
      "@keeperhub/agentic-builder/http": path.resolve(
        __dirname,
        "./packages/agentic-builder/src/adapters/http/handlers.ts"
      ),
      "@keeperhub/agentic-builder/mcp": path.resolve(
        __dirname,
        "./packages/agentic-builder/src/adapters/mcp/tools.ts"
      ),
      "@keeperhub/agentic-builder/ports": path.resolve(
        __dirname,
        "./packages/agentic-builder/src/core/ports/all.ts"
      ),
      "@keeperhub/agentic-builder/runtime": path.resolve(
        __dirname,
        "./packages/agentic-builder/src/core/services/runtime.ts"
      ),
      "@keeperhub/agentic-builder/schemas": path.resolve(
        __dirname,
        "./packages/agentic-builder/src/core/schemas/all.ts"
      ),
      "@keeperhub/agentic-builder/templates": path.resolve(
        __dirname,
        "./packages/agentic-builder/src/core/templates/ai-sdk-template-runner.ts"
      ),
      "@keeperhub/agentic-builder/template-runner": path.resolve(
        __dirname,
        "./packages/agentic-builder/src/core/templates/ai-sdk-template-runner.ts"
      ),
      "@keeperhub/agentic-builder/ai-sdk": path.resolve(
        __dirname,
        "./packages/agentic-builder/src/core/templates/ai-sdk-json-template-runner.ts"
      ),
      "@keeperhub/builder-dag/branch": path.resolve(
        __dirname,
        "./packages/builder-dag/src/branch.ts"
      ),
      "@keeperhub/builder-dag/commit-graph": path.resolve(
        __dirname,
        "./packages/builder-dag/src/commit-graph.ts"
      ),
      "@keeperhub/builder-dag/fork": path.resolve(
        __dirname,
        "./packages/builder-dag/src/fork.ts"
      ),
      "@keeperhub/builder-dag/projection": path.resolve(
        __dirname,
        "./packages/builder-dag/src/projection.ts"
      ),
      "@keeperhub/builder-dag/types": path.resolve(
        __dirname,
        "./packages/builder-dag/src/types.ts"
      ),
    },
  },
});
