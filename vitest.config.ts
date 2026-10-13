import { defineConfig } from "vitest/config";

/**
 * Adapted from bluepass-app's config, with one difference: the tests that came
 * across with `lib/services/` are colocated next to their subject rather than
 * sitting in a top-level `tests/` folder, so `include` points at `lib/`.
 *
 * Without vitest installed, the colocated `*.test.ts` files fail `tsc --noEmit`
 * on a missing `vitest` module — hence this config exists rather than the tests
 * being deleted or excluded from type-checking.
 */
export default defineConfig({
  test: {
    environment: "node",
    include: ["lib/**/*.test.ts"],
    /**
     * The booking CMS suites empty tables (TRUNCATE ... "BluePassAccount" CASCADE) before every test,
     * so they only run through vitest.rails.config.ts, whose setup file refuses any database that
     * is not local. Left in this config they would run against the shared Supabase.
     */
    exclude: [
      "**/node_modules/**",
      "lib/services/rails/**",
      "lib/services/channels/**",
      "lib/services/operators/prepared-*.test.ts",
    ],
    /**
     * Test files run one at a time.
     *
     * Almost every suite here talks to the real shared Supabase, and vitest's default is a fork per
     * file — each fork building its own PrismaClient and its own connection pool. Past eight
     * DB-backed files that reliably tripped the pooler's session-mode ceiling:
     *
     *   FATAL: (EMAXCONNSESSION) max clients reached in session mode - max clients are limited to
     *   pool_size: 15
     *
     * which surfaced as PrismaClientInitializationError in whichever files happened to lose the
     * race, not in the file that caused it. It was intermittent at seven files (one unexplained
     * failure per several runs) and deterministic at eight. Serialising costs wall-clock time and
     * buys a suite whose failures mean something.
     */
    fileParallelism: false,
  },
  resolve: {
    alias: {
      "@": new URL(".", import.meta.url).pathname,
    },
  },
});
