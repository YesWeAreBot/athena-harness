import { defineConfig } from "bumpp";

export default defineConfig({
  pr: {
    branch: "release/v{version}",
    base: "main",
    title: "chore: release {tag}",
    body: "{oldVersion} → {version}",
    draft: false,
  },
});
