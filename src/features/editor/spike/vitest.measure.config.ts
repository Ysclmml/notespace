import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "jsdom",
    setupFiles: ["src/test/setup.ts"],
    include: ["src/features/editor/spike/*.measure.ts"],
    restoreMocks: true,
    fileParallelism: false,
    maxWorkers: 1,
  },
});
