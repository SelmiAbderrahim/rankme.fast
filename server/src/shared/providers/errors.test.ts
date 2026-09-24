import { describe, expect, it } from 'vitest';
import {
  GscReconnectRequiredError,
  ProviderError,
  VendorAuthError,
  VendorMalformedError,
  VendorQuotaError,
  VendorTimeoutError,
  VendorUnavailableError,
} from './index.js';

const ctx = { provider: 'dataforseo', operation: 'serp-task-get' };

describe('provider error taxonomy', () => {
  it('flags each class with the correct retryable value', () => {
    expect(new VendorTimeoutError('t', ctx).retryable).toBe(true);
    expect(new VendorQuotaError('q', ctx).retryable).toBe(true);
    expect(new VendorUnavailableError('u', ctx).retryable).toBe(true);
    expect(new VendorMalformedError('m', ctx).retryable).toBe(false);
    expect(new VendorAuthError('a', ctx).retryable).toBe(false);
  });

  it('carries provider, operation, name, and message', () => {
    const err = new VendorTimeoutError('no response within 30000ms', ctx);
    expect(err).toBeInstanceOf(ProviderError);
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe('VendorTimeoutError');
    expect(err.provider).toBe('dataforseo');
    expect(err.operation).toBe('serp-task-get');
    expect(err.message).toBe('no response within 30000ms');
    expect(err.httpStatus).toBeUndefined();
  });

  it('carries the HTTP response status when one was received', () => {
    const err = new VendorAuthError('rejected', { ...ctx, httpStatus: 401 });
    expect(err.httpStatus).toBe(401);
  });

  it('propagates cause when provided and omits it otherwise', () => {
    const cause = new Error('socket hang up');
    expect(new VendorUnavailableError('u', { ...ctx, cause }).cause).toBe(cause);
    expect(new VendorUnavailableError('u', ctx).cause).toBeUndefined();
  });

  it('VendorQuotaError carries an optional retryAfterSeconds', () => {
    expect(new VendorQuotaError('q', { ...ctx, retryAfterSeconds: 42 }).retryAfterSeconds).toBe(42);
    expect(new VendorQuotaError('q', ctx).retryAfterSeconds).toBeUndefined();
  });

  it('base ProviderError exposes the retryable flag it was built with', () => {
    expect(new ProviderError('boom', true, ctx).retryable).toBe(true);
    expect(new ProviderError('boom', false, ctx).retryable).toBe(false);
  });

  it('GscReconnectRequiredError is a non-retryable ProviderError', () => {
    const err = new GscReconnectRequiredError('reconnect', {
      provider: 'google',
      operation: 'gsc-refresh',
    });
    expect(err).toBeInstanceOf(ProviderError);
    expect(err.retryable).toBe(false);
    expect(err.name).toBe('GscReconnectRequiredError');
  });
});
