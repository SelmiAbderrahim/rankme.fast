import { assertNoForbidden, type DenylistScanOptions, } from '../../security/denylist-scan.js';
/** Shared assertion used by MCP, public API, superadmin, export, and log-sample suites. */
export function assertSecurityCleanPayload(value: unknown, opts: DenylistScanOptions = {}): void {
    assertNoForbidden(value, opts);
}
export interface ConditionalSecretContractOptions {
    schema: {
        safeParse(value: Record<string, unknown>): {
            success: boolean;
        };
    };
    base: Record<string, unknown>;
    selector: string;
    fakeValue: string;
    liveValue: string;
    secret: string;
}
/** Reusable env-schema assertion: fake boots keyless; selected live fails keyless. */
export function assertConditionalSecretContract(options: ConditionalSecretContractOptions): void {
    const keyless = { ...options.base };
    delete keyless[options.secret];
    if (!options.schema.safeParse({ ...keyless, [options.selector]: options.fakeValue }).success) {
        throw new Error(`${options.selector}=${options.fakeValue} must boot without ${options.secret}`);
    }
    if (options.schema.safeParse({ ...keyless, [options.selector]: options.liveValue }).success) {
        throw new Error(`${options.selector}=${options.liveValue} must require ${options.secret}`);
    }
}
