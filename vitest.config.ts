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
      // Tests run against source, so a package importing a sibling plugin by
      // name must not fall back to its built `lib/` (stale, and a second copy
      // of every class breaks `instanceof`).
      "@athena-ai/plugin-sandbox": source("plugins/sandbox/src/index.ts"),
      "@athena-ai/plugin-sandbox-nerve": source("plugins/sandbox-nerve/src/index.ts"),
    },
  },
  test: {
    exclude: ["**/node_modules/**", "**/.git/**", "tools/**"],
  },
});
