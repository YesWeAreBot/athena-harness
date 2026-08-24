import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

const root = new URL(".", import.meta.url);
const source = (path: string) => fileURLToPath(new URL(path, root));

export default defineConfig({
  resolve: {
    alias: {
      "@athena-ai/protocol": source("packages/protocol/src/index.ts"),
      "@athena-ai/protocol-im": source("packages/protocol-im/src/index.ts"),
      "@athena-ai/nerve-onebot": source("plugins/nerve-onebot/src/index.ts"),
    },
  },
  test: {
    exclude: ["**/node_modules/**", "**/.git/**", "tools/**"],
  },
});
