import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    setupFiles: "./vitest.setup.ts",
    coverage: {
      provider: "v8",
      reports: ["text", "html"],
      include: ["src/routes/nft/format.ts"],
    },
  },
});
