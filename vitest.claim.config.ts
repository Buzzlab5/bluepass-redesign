/**
 * Test config for the public operator claim pages. Separate from
 * vitest.config.ts for the same reason vitest.agents.config.ts is: that suite
 * talks to the real Supabase and runs serially, while these mock every database
 * call and run in parallel.
 *
 * The alias uses fileURLToPath rather than URL.pathname because this checkout
 * lives under a directory with a space in its name, and `.pathname` hands back
 * a percent-encoded path that resolves to nothing.
 */
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    globals: true,
    include: [
      "lib/services/operators/operator-public-lead.test.ts",
      "lib/services/operators/listing-availability.test.ts",
    ],
  },
  resolve: {
    alias: { "@": fileURLToPath(new URL(".", import.meta.url)) },
  },
});
