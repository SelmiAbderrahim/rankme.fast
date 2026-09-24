/** Server-owned source definition used by Vitest and pinned by ci-gates.test. */
export const SERVER_COVERAGE_INCLUDE: string[] = ['src/**/*.ts'];
/**
 * Frozen exclusion set. It contains only declarations/tests, composition-only
 * process or CLI entrypoints, generated/tooling source, type-only modules,
 * pure re-export barrels, and the deprecated pure re-export compatibility shim.
 */
export const SERVER_COVERAGE_EXCLUDE: string[] = [
    'src/**/*.d.ts',
    'src/**/*.test.ts',
    'src/**/*.spec.ts',
    'src/server.ts',
    'src/worker.ts',
    'src/scripts/run-user-migration.ts',
    'src/scripts/run-redact-fixture.ts',
    'src/scripts/run-skip-policy.ts',
    'src/scripts/run-rename-audit-log-actions.ts',
    'src/config/logger.ts',
    'src/config/db.ts',
    'tsup.config.ts',
    'drizzle.config.ts',
    'drizzle/**',
    'src/db/schema/auth.ts',
    'better-auth-cli.config.ts',
    'vitest.config.ts',
    'vitest.global-setup.ts',
    'eslint.config.js',
    '**/coverage/**',
    '**/types.ts',
    'src/modules/**/index.ts',
    'src/db/schema/index.ts',
    'src/shared/cooldown/index.ts',
    'src/shared/providers/**/index.ts',
    'src/shared/queue/index.ts',
    'src/shared/vendor-cache/index.ts',
    'src/modules/communication/mailers/mailgun.ts',
];
export const SERVER_COVERAGE_THRESHOLDS = {
    lines: 100,
    branches: 100,
    functions: 100,
    statements: 100,
};
