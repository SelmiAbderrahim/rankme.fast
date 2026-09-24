import { describe, expect, it } from 'vitest';
import { HttpError } from './http-error.js';

describe('HttpError factories', () => {
  it('maps each factory to its status code and carries details', () => {
    expect(HttpError.badRequest({ code: 'BAD_REQUEST', messageKey: 'errors.badRequest' }).status).toBe(400);
    expect(HttpError.unauthorized({ code: 'UNAUTHORIZED', messageKey: 'errors.unauthorized' }).status).toBe(401);
    expect(HttpError.forbidden({ code: 'FORBIDDEN', messageKey: 'errors.forbidden' }).status).toBe(403);
    expect(HttpError.notFound({ code: 'NOT_FOUND', messageKey: 'errors.notFound' }).status).toBe(404);
    expect(HttpError.conflict({ code: 'CONFLICT', messageKey: 'errors.conflict' }).status).toBe(409);
    expect(HttpError.tooMany({ code: 'TOO_MANY_REQUESTS', messageKey: 'errors.tooManyRequests' }).status).toBe(429);
    expect(HttpError.internal({ code: 'INTERNAL', messageKey: 'errors.internal' }).status).toBe(500);

    const withDetails = HttpError.forbidden(
      { code: 'ACCESS_DENIED', messageKey: 'errors.forbidden' },
      { code: 'X' },
    );
    expect(withDetails.message).toBe('errors.forbidden');
    expect(withDetails.details).toEqual({ code: 'X' });
    expect(withDetails).toBeInstanceOf(Error);
  });

  it('requires and retains explicit metadata for every factory', () => {
    expect(HttpError.badRequest({ code: 'BAD_REQUEST', messageKey: 'errors.badRequest' }).message).toBe('errors.badRequest');
    expect(HttpError.unauthorized({ code: 'UNAUTHORIZED', messageKey: 'errors.unauthorized' }).message).toBe('errors.unauthorized');
    expect(HttpError.forbidden({ code: 'FORBIDDEN', messageKey: 'errors.forbidden' }).message).toBe('errors.forbidden');
    expect(HttpError.notFound({ code: 'NOT_FOUND', messageKey: 'errors.notFound' }).message).toBe('errors.notFound');
    expect(HttpError.conflict({ code: 'CONFLICT', messageKey: 'errors.conflict' }).message).toBe('errors.conflict');
    expect(HttpError.tooMany({ code: 'TOO_MANY_REQUESTS', messageKey: 'errors.tooManyRequests' }).message).toBe('errors.tooManyRequests');
    expect(HttpError.internal({ code: 'INTERNAL', messageKey: 'errors.internal' }).message).toBe('errors.internal');
    expect(new HttpError(503, { code: 'SERVICE_UNAVAILABLE', messageKey: 'errors.internal' }).message).toBe('errors.internal');
  });

  it('has no legacy compatibility path', () => {
    const explicit = HttpError.notFound({
      code: 'SITES_NOT_FOUND',
      messageKey: 'sites.errors.notFound',
    });
    expect(explicit.messageKey).toBe('sites.errors.notFound');
    expect(explicit.code).toBe('SITES_NOT_FOUND');
    expect(explicit.vars).toBeUndefined();
    expect(explicit.details).toBeUndefined();
  });

  it('accepts a localized descriptor and keeps the key as Error.message', () => {
    const error = HttpError.conflict({
      code: 'SITE_ALREADY_TRACKED',
      messageKey: 'sites.errors.duplicate',
      vars: { limit: 3 },
      details: { field: 'url' },
    });
    expect(error.status).toBe(409);
    expect(error.message).toBe('sites.errors.duplicate');
    expect(error.messageKey).toBe('sites.errors.duplicate');
    expect(error.code).toBe('SITE_ALREADY_TRACKED');
    expect(error.vars).toEqual({ limit: 3 });
    expect(error.details).toEqual({ field: 'url' });
  });

  it('lets an explicit details argument win over the descriptor payload', () => {
    const error = new HttpError(
      400,
      { code: 'X', messageKey: 'errors.badRequest', details: { from: 'descriptor' } },
      { from: 'argument' },
    );
    expect(error.details).toEqual({ from: 'argument' });
  });

  it('keeps an internal-only cause off the serialized surface', () => {
    const upstream = new Error('DataForSEO 40104');
    const fromDescriptor = new HttpError(503, {
      code: 'VENDOR_DOWN',
      messageKey: 'errors.serviceUnavailable',
      cause: upstream,
    });
    expect(fromDescriptor.cause).toBe(upstream);
    expect(JSON.stringify(fromDescriptor)).not.toContain('40104');

    const explicitOptions = new HttpError(503, { code: 'ERRORS_SERVICE_UNAVAILABLE', messageKey: 'errors.serviceUnavailable' }, undefined, {
      cause: upstream,
    });
    expect(explicitOptions.cause).toBe(upstream);

    expect(
      new HttpError(503, { code: 'VENDOR_DOWN', messageKey: 'errors.serviceUnavailable' }).cause,
    ).toBeUndefined();
  });
});
