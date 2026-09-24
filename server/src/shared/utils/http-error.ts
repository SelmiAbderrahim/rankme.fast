import type { LocalizedErrorDescriptor, TranslationKey } from '../i18n/errors.js';
import type { TranslationVars } from '../i18n/index.js';
/**
 * Deliberately has no string/default overload. Every caller must
 * name a stable machine code and a typed translation key. Runtime-hostile
 * descriptors can still arrive through JavaScript or an unsafe cast; the
 * shared resolver validates both fields and fails closed to status-family
 * copy before anything reaches the wire.
 */
export type HttpErrorInit = LocalizedErrorDescriptor;
export class HttpError extends Error {
    readonly status: number;
    readonly details?: unknown;
    /** Stable machine code. */
    readonly code: string;
    /** Typed dictionary key. */
    readonly messageKey: TranslationKey;
    /** Bounded interpolation input; sanitized again before rendering. */
    readonly vars?: TranslationVars;
    constructor(status: number, init: HttpErrorInit, details?: unknown, options?: ErrorOptions) {
        // `Error.message` carries the key for existing operator stack assertions;
        // it is never logged or serialized as user copy.
        const message = init.messageKey;
        const cause = options ??
            (init.cause === undefined ? undefined : { cause: init.cause });
        super(message, cause);
        this.name = 'HttpError';
        this.status = status;
        this.details = details === undefined ? init.details : details;
        this.code = init.code;
        this.messageKey = init.messageKey;
        this.vars = init.vars;
    }
    static badRequest(init: HttpErrorInit, details?: unknown): HttpError {
        return new HttpError(400, init, details);
    }
    static unauthorized(init: HttpErrorInit, details?: unknown): HttpError {
        return new HttpError(401, init, details);
    }
    static forbidden(init: HttpErrorInit, details?: unknown): HttpError {
        return new HttpError(403, init, details);
    }
    static notFound(init: HttpErrorInit, details?: unknown): HttpError {
        return new HttpError(404, init, details);
    }
    static conflict(init: HttpErrorInit, details?: unknown): HttpError {
        return new HttpError(409, init, details);
    }
    static tooMany(init: HttpErrorInit, details?: unknown): HttpError {
        return new HttpError(429, init, details);
    }
    static internal(init: HttpErrorInit, details?: unknown): HttpError {
        return new HttpError(500, init, details);
    }
}
