/**
 * Test config for the agent runtime. Separate from vitest.config.ts because
 * that suite talks to the real Supabase and runs serially; these tests mock
 * every database call and run in parallel.
 */
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    globals: true,
    include: ["lib/services/agents/**/*.test.ts"],
  },
  resolve: {
    alias: { "@": new URL(".", import.meta.url).pathname },
  },
});
