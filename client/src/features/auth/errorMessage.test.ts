import { beforeEach, describe, expect, it } from 'vitest';
import { i18n, initI18n } from '@shared/i18n';
import { messageForAuthError } from './errorMessage';

type AuthErrorsT = Parameters<typeof messageForAuthError>[1];

beforeEach(() => {
  initI18n({ initialLocale: 'en' });
});

const t = ((...args: unknown[]) =>
  (i18n.t as unknown as (...a: unknown[]) => string)(...args)) as unknown as AuthErrorsT;

describe('messageForAuthError', () => {
  it('maps stable Better Auth codes to catalog entries', () => {
    expect(messageForAuthError({ code: 'INVALID_EMAIL_OR_PASSWORD' }, t)).toBe(
      'Invalid email or password.',
    );
    expect(messageForAuthError({ code: 'USER_ALREADY_EXISTS' }, t)).toBe(
      'We could not create an account with those details.',
    );
    expect(messageForAuthError({ code: 'PASSWORD_TOO_SHORT' }, t)).toBe(
      'Password must be at least 8 characters.',
    );
    expect(messageForAuthError({ code: 'INVALID_EMAIL' }, t)).toBe(
      'Please enter a valid email address',
    );
  });

  it('fails unknown codes closed without displaying server or library text', () => {
    expect(messageForAuthError({ status: 401, code: 'SOMETHING_NEW', message: 'raw upstream' }, t)).toBe(
      'Something went wrong on our end. Please try again.',
    );
  });

  it('falls back by status when a stable code is absent', () => {
    expect(messageForAuthError({ status: 401, message: 'raw upstream' }, t)).toBe(
      'Invalid email or password.',
    );
  });

  it('falls back by status: 429 → rate limited', () => {
    expect(messageForAuthError({ status: 429 }, t)).toBe(
      'Too many attempts. Please wait a moment and try again.',
    );
  });

  it('defaults to the generic internal error', () => {
    expect(messageForAuthError({ status: 500 }, t)).toBe(
      'Something went wrong on our end. Please try again.',
    );
    expect(messageForAuthError({}, t)).toBe(
      'Something went wrong on our end. Please try again.',
    );
  });

  it('uses current local copy across rapid language changes and ignores stale server copy', async () => {
    const error = {
      code: 'INVALID_EMAIL_OR_PASSWORD',
      message: 'البريد الإلكتروني أو كلمة المرور غير صحيحة.',
    };
    await i18n.changeLanguage('ar');
    expect(messageForAuthError(error, t)).toBe(
      'البريد الإلكتروني أو كلمة المرور غير صحيحة.',
    );
    expect(document.documentElement.dir).toBe('rtl');
    await i18n.changeLanguage('fr');
    expect(messageForAuthError(error, t)).toBe('E-mail ou mot de passe invalide.');
    expect(document.documentElement.dir).toBe('ltr');
  });
});
