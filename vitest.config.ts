import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react-swc";
import path from "path";

const alias = {
  "@": path.resolve(__dirname, "client"),
  "@shared": path.resolve(__dirname, "shared"),
};

export default defineConfig({
  plugins: [react()],
  resolve: { alias },
  test: {
    env: {
      VITEST: "true",
    },
    projects: [
      {
        plugins: [react()],
        resolve: { alias },
        test: {
          name: "node",
          include: ["api/**/*.test.ts", "client/**/*.spec.ts"],
          // Sweeps / leak-checks fixtures in the shared TiDB (see api/testGlobalSetup.ts).
          globalSetup: ["api/testGlobalSetup.ts"],
          environment: "node",
          env: { VITEST: "true" },
          testTimeout: 45_000,
          hookTimeout: 90_000,
          maxWorkers: 2,
          sequence: { groupOrder: 0 },
        },
      },
      {
        plugins: [react()],
        resolve: { alias },
        test: {
          name: "jsdom",
          include: ["client/**/*.spec.tsx"],
          environment: "jsdom",
          setupFiles: ["client/test/setup.ts"],
          env: { VITEST: "true" },
          sequence: { groupOrder: 1 },
        },
      },
    ],
  },
});
