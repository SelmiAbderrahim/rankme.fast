import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import tsconfigPaths from 'vite-tsconfig-paths';

// Vitest defaults NODE_ENV to "test" only when the parent process leaves it
// unset. Docker/automation shells commonly export "production", which makes
// React load its production build and causes Testing Library's act() to fail.
// Test tooling must be deterministic regardless of that inherited shell value.
process.env.NODE_ENV = 'test';

export default defineConfig({
  cacheDir: './.vitest-cache',
  plugins: [react(), tsconfigPaths()],
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    css: false,
    // Parallel fork processes compete for CPU in constrained Docker environments
    // (node:20-bookworm CI runner). Heavy React+i18n+jsdom setups can exceed the
    // default 5s timeout purely due to scheduler starvation. Each test file runs
    // in its own fork process (Vitest default for `forks` pool) which guarantees
    // module isolation — vi.mock() factories in one file never contaminate another.
    // NOTE: `test.poolOptions` was removed in Vitest 4; do NOT add poolOptions
    // or forks.maxForks here — capping forks to a small number forces files to
    // share processes and breaks vi.mock() isolation between test files.
    pool: 'forks',
    testTimeout: 120_000,
    hookTimeout: 300_000,
    // Keep vitest inside src/**. Playwright specs under e2e/**
    // import browser-only modules (`@playwright/test`) and would fail in a
    // Node/jsdom vitest runner.
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'lcov'],
      // Parallel workspace executors can opt into isolated report storage;
      // CI and ordinary local runs retain the canonical default.
      reportsDirectory:
        process.env.VITEST_COVERAGE_REPORTS_DIRECTORY ?? './coverage-current',
      // Measure application source only — never vendored bundles, tooling
      // config, the SSR entry server, or build scripts.
      include: ['src/**/*.{ts,tsx}'],
      all: true,
      exclude: [
        'src/**/*.d.ts',
        'src/**/*.test.{ts,tsx}',
        'src/**/*.spec.{ts,tsx}',
        'src/main.tsx',
        'src/entry-client.tsx',
        'src/entry-server.tsx',
        // App-shell composition roots (mirror the entry-point exclusions above):
        // they only wire providers/router together — no unit-testable logic.
        'src/App.tsx',
        'src/app/providers.tsx',
        'src/app/router.tsx',
        // Generated shadcn/ui primitives — vendored component source, not
        // hand-written app logic (mirrors the vendor-bundle exclusion below).
        'src/shared/ui/**',
        // shadcn CLI-generated hook (ships with the sidebar primitive).
        'src/shared/hooks/use-mobile.ts',
        // SSR i18n bootstrap — the server-side counterpart of entry-server.
        'src/shared/i18n/server.ts',
        'src/test/**',
        // Non-application source: tooling config, the SSR entry server, and
        // build scripts are not unit-tested app code.
        'vite.config.ts',
        'vitest.config.ts',
        'eslint.config.js',
        'server.js',
        'scripts/**',
        '**/node_modules/**',
        // Minified vendor bundles (e.g. React's prod CJS) are not app source.
        '**/*.min.js',
        '**/coverage/**',
        // Type-only modules compile to nothing; no runtime to cover.
        '**/types.ts',
        // Feature public-API barrel files are pure named re-exports; they have
        // no executable logic of their own. In @vitest/coverage-v8 ≥4 every
        // re-export statement is instrumented as a branch, so barrels that are
        // never directly imported by tests artificially inflate the uncovered
        // branch count. Exclude them — the modules they re-export ARE covered.
        'src/features/**/index.ts',
        // SEO shared module barrel — same reasoning as above.
        'src/shared/seo/index.ts',
        // Security shared module barrel — same reasoning as above.
        'src/shared/security/index.ts',
        'src/shared/markets/index.ts',
        // Feature-level errorMessage files re-export the shared API error
        // utilities unchanged (no branching logic of their own). Coverage of
        // the shared implementation is tracked at its source.
        '**/errorMessage.ts',
      ],
      // CI enforces 100% coverage across all four dimensions.
      // Runs are gated by .github/workflows/ci.yml.
      thresholds: {
        lines: 100,
        branches: 100,
        functions: 100,
        statements: 100,
      },
    },
  },
});
