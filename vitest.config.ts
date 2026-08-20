import { resolve } from "path";

import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@athena-ai/core": resolve(__dirname, "packages/core/src/index.ts"),
      "@athena-ai/protocol": resolve(__dirname, "packages/protocol/src/index.ts"),
      "@athena-ai/capability-message": resolve(__dirname, "plugins/capability-message/src/index.ts"),
      "@athena-ai/cortex-chat": resolve(__dirname, "plugins/cortex-chat/src/index.ts"),
      "@athena-ai/plugin-sandbox": resolve(__dirname, "plugins/sandbox/src/index.ts"),
    },
  },
  test: {
    exclude: ["**/node_modules/**", "**/.git/**", "legacy/**", "vendor/**/tests/**"],
  },
});
