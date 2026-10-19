/**
 * Test config for the booking CMS. Unlike the claim and agent suites, these run
 * against a real Postgres, because the thing most worth testing is what mocks
 * cannot show: two travellers paying for the last seat at the same moment.
 *
 * rails.setup.ts refuses to start unless DATABASE_URL points at localhost, since
 * every test begins by emptying the booking tables.
 */
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["lib/services/rails/**/*.test.ts", "lib/services/channels/**/*.test.ts", "lib/services/operators/photo-check.test.ts", "lib/services/operators/main-price.test.ts", "lib/services/operators/stale-signs.test.ts", "lib/services/operators/prepared-edits.test.ts", "lib/services/operators/prepared-booking.test.ts", "lib/services/operators/prepared-claim.test.ts", "lib/services/operators/videos.test.ts", "lib/services/operators/media-merge.test.ts", "lib/services/operators/prepared-pages.test.ts", "lib/services/operators/upload-image.test.ts", "lib/services/operators/own-media.test.ts", "lib/services/operators/booking-route.test.ts", "lib/services/onboarding/**/*.test.ts", "lib/services/outreach/**/*.test.ts"],
    setupFiles: ["./lib/services/rails/rails.setup.ts"],
    fileParallelism: false,
    testTimeout: 30_000,
  },
  resolve: {
    alias: { "@": fileURLToPath(new URL(".", import.meta.url)) },
  },
});
