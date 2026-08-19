import { resolve } from "path";

import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@athena-ai/core": resolve(__dirname, "packages/core/src/index.ts"),
      "@athena-ai/capability-message": resolve(__dirname, "packages/capability-message/src/index.ts"),
      "@athena-ai/cortex-chat": resolve(__dirname, "packages/cortex-chat/src/index.ts"),
    },
  },
  test: {
    exclude: ["**/node_modules/**", "**/.git/**", "legacy/**", "vendor/**/tests/**"],
  },
});
