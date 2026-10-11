import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      // Next.js supplies this marker module at build time; there is no installed package.
      "server-only": fileURLToPath(new URL("./tests/support/server-only.ts", import.meta.url))
    }
  },
  test: {
    exclude: ["tests/e2e/**", "node_modules/**", ".next/**"],
    projects: [
      { extends: true, test: { name: "unit", include: ["tests/*.test.ts"], exclude: ["tests/restore-drill-script.test.ts"] } },
      // These suites mutate singleton settings, global market mappings and workers
      // in one disposable database. File-level overlap is not isolated. Concurrent
      // requests *within* lifecycle tests remain concurrent and fully asserted.
      { extends: true, test: { name: "database", include: ["tests/db/*.test.ts", "tests/restore-drill-script.test.ts"], fileParallelism: false } }
    ]
  }
});
