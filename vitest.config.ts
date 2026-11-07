import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react-swc";
import path from "path";

const alias = {
  "@": path.resolve(import.meta.dirname, "client"),
  "@shared": path.resolve(import.meta.dirname, "shared"),
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
          // Integration tests make many API calls to a remote DB: several take 35-40s even alone.
          testTimeout: 120_000,
          hookTimeout: 90_000,
          // Tests wait on network round trips to TiDB, not CPU: 4 files at once (measured: 15 slowest files 16 → 10.5 min).
          maxWorkers: 4,
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
