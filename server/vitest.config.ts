import { defineConfig } from 'vitest/config';
import {
  SERVER_COVERAGE_EXCLUDE,
  SERVER_COVERAGE_INCLUDE,
  SERVER_COVERAGE_THRESHOLDS,
} from './src/shared/testing/owned-source-policy.ts';

export default defineConfig({
  cacheDir: './.vitest-cache',
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.{test,spec}.ts'],
    exclude: ['node_modules', 'dist'],
    setupFiles: ['./vitest.setup.ts'],
    // Provides a real Redis (TEST_REDIS_URL) for the queue suites —
    // CI service container or a throwaway docker container on dev hosts.
    globalSetup: ['./vitest.global-setup.ts'],
    // Route-matrix integration tests can make dozens of database-backed
    // requests in one case, so retain a bounded margin on saturated CI hosts.
    testTimeout: 60_000,
    // Database-backed suites start Memory Mongo and PGlite in hooks. Allow
    // enough scheduler headroom for those shared fixtures on saturated CI
    // hosts while keeping fixture startup separately bounded.
    hookTimeout: 180_000,
    fileParallelism: false,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'lcov'],
      // Parallel workspace executors can opt into isolated report storage;
      // CI and ordinary local runs retain the canonical default.
      reportsDirectory:
        process.env.VITEST_COVERAGE_REPORTS_DIRECTORY ?? './coverage-current',
      // Owned runtime source is collected even when no test imports it. This
      // makes a newly added, untested server module enter the map at 0%.
      include: SERVER_COVERAGE_INCLUDE,
      all: true,
      // The v8 provider's collection-time exclude filter has
      // proven unreliable on this machine (exact-path entries like
      // src/server.ts intermittently leak into the report at 0%). This
      // forces a final TestExclude pass over the merged coverage map, which
      // applies the list below deterministically.
      excludeAfterRemap: true,
      exclude: SERVER_COVERAGE_EXCLUDE,
      // CI enforces a 100% coverage gate on the four v8 dimensions.
      // Runs are gated by .github/workflows/ci.yml.
      thresholds: SERVER_COVERAGE_THRESHOLDS,
    },
  },
});
