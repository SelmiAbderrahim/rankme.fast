import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { ERROR_CODE_ALIASES, ERROR_CODE_PATTERN, canonicalErrorCode } from './error-codes.js';
import express from 'express';
import request from 'supertest';
import { hasTranslationKey, resolveLocalizedError } from './errors.js';
import { DICTIONARIES, SUPPORTED_LOCALES, translate } from './index.js';
import { errorHandler } from '../middleware/error-handler.js';
import { language } from '../middleware/language.js';
import { HttpError } from '../utils/http-error.js';

describe('canonical error responses', () => {
  it.each(['SITES_ERRORS_NOT_FOUND', 'PAGES_SITE_NOT_FOUND', 'BACKLINKS_ERRORS_SITE_NOT_FOUND'])('unifies %s while retaining compatibility metadata', (code) => {
    expect(resolveLocalizedError({ status: 404, locale: 'en', messageKey: 'sites.errors.notFound', code })).toMatchObject({
      code: 'SITE_NOT_FOUND', legacyCode: code, messageKey: 'sites.errors.notFound',
    });
  });

  it('canonicalizes derived and status-family codes and keeps canonical codes unchanged', () => {
    expect(resolveLocalizedError({ status: 404, locale: 'en', messageKey: 'errors.projectNotFound' })).toMatchObject({
      code: 'PROJECT_NOT_FOUND', legacyCode: 'ERRORS_PROJECT_NOT_FOUND',
    });
    expect(resolveLocalizedError({ status: 401, locale: 'en' })).toMatchObject({ code: 'AUTH_REQUIRED', legacyCode: 'UNAUTHORIZED' });
    expect(resolveLocalizedError({ status: 409, locale: 'en', messageKey: 'errors.conflict', code: 'RESOURCE_CONFLICT' })).not.toHaveProperty('legacyCode');
  });

  it.each(SUPPORTED_LOCALES)('sends canonical metadata and localized copy on the %s wire', async (locale) => {
    const app = express();
    app.use(language);
    app.get('/missing', (_req, _res, next) => next(HttpError.notFound({ code: 'SITES_ERRORS_NOT_FOUND', messageKey: 'sites.errors.notFound', details: { found: false } })));
    app.get('/canonical', (_req, _res, next) => next(HttpError.notFound({ code: 'SITE_NOT_FOUND', messageKey: 'sites.errors.notFound' })));
    app.use(errorHandler);
    const response = await request(app).get('/missing').set('x-lang', locale);
    expect(response.status).toBe(404);
    expect(response.headers['content-language']).toBe(locale);
    expect(response.body.error).toEqual({
      code: 'SITE_NOT_FOUND', legacyCode: 'SITES_ERRORS_NOT_FOUND', messageKey: 'sites.errors.notFound',
      message: translate(locale, 'sites.errors.notFound'), details: { found: false },
    });
    const canonical = await request(app).get('/canonical').set('x-lang', locale);
    expect(canonical.body.error.code).toBe('SITE_NOT_FOUND');
    expect(canonical.body.error).not.toHaveProperty('legacyCode');
  });
});

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return /^(?:testing|billing|admin|superadmin(?:-.*)?|enterprise)$/u.test(entry.name) ? [] : sourceFiles(path);
    return /\.ts$/u.test(entry.name) && !/\.(?:test|spec)\.ts$/u.test(entry.name) ? [path] : [];
  });
}

function declaredErrors(): { code: string; messageKey?: string }[] {
  const errors: { code: string; messageKey?: string }[] = [];
  for (const path of sourceFiles(resolve(import.meta.dirname, '../..'))) {
    const source = ts.createSourceFile(path, readFileSync(path, 'utf8'), ts.ScriptTarget.Latest, true);
    const visit = (node: ts.Node): void => {
      if (ts.isObjectLiteralExpression(node)) {
        const properties = node.properties.filter(ts.isPropertyAssignment);
        const code = properties.find((property) => property.name.getText(source) === 'code')?.initializer;
        const messageKey = properties.find((property) => property.name.getText(source) === 'messageKey')?.initializer;
        if (code && ts.isStringLiteral(code) && messageKey) {
          errors.push({ code: code.text, ...(ts.isStringLiteral(messageKey) ? { messageKey: messageKey.text } : {}) });
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
  }
  return errors;
}

function errorKeys(value: unknown, prefix = ''): string[] {
  if (typeof value === 'string') return /(?:^|\.)errors?\./u.test(prefix) ? [prefix] : [];
  if (!value || typeof value !== 'object') return [];
  return Object.entries(value).flatMap(([key, child]) =>
    /^(?:billing|admin|superadmin|enterprise)$/u.test(key) ? [] : errorKeys(child, prefix ? `${prefix}.${key}` : key));
}

describe('error-code registry coverage', () => {
  it.each([
    ['ERRORS_PROJECT_NOT_FOUND', 'PROJECT_NOT_FOUND'], ['ERRORS_NOT_FOUND', 'NOT_FOUND'],
    ['ERR_THING_BROKE', 'THING_BROKE'], ['RANKS_ERRORS_CHECK_COOLDOWN', 'RANKS_ERRORS_CHECK_COOLDOWN'],
    ['PAGES_INVALID_CURSOR', 'PAGES_INVALID_CURSOR'], ['timeout', 'TIMEOUT_ERROR'],
    ['request_cancelled', 'REQUEST_CANCELLED'], ['A__B_', 'A_B'], ['ERRATIC', 'UNKNOWN_ERROR'],
    ['ERRATIC_FAILURE', 'UNKNOWN_ERROR'], ['___', 'UNKNOWN_ERROR'], ['1ABC', 'UNKNOWN_ERROR'],
    ['sites_errors_not_found', 'SITE_NOT_FOUND'], ['constructor', 'CONSTRUCTOR_ERROR'],
    ['__proto__', 'PROTO_ERROR'], ['toString', 'TOSTRING_ERROR'], ['hasOwnProperty', 'HASOWNPROPERTY_ERROR'],
  ])('normalizes %s as %s', (input, expected) => {
    expect(canonicalErrorCode(input)).toBe(expected);
    expect(canonicalErrorCode(expected)).toBe(expected);
  });

  it('maps every registered alias onto one stable canonical code', () => {
    for (const [legacy, canonical] of Object.entries(ERROR_CODE_ALIASES)) {
      expect(canonicalErrorCode(legacy)).toBe(canonical);
      expect(canonical).toMatch(ERROR_CODE_PATTERN);
      expect(canonical.startsWith('ERR')).toBe(false);
    }
  });

  it('enrolls product descriptors and renders their static keys in all seven locales', () => {
    const declared = declaredErrors();
    expect(new Set(declared.map(({ code }) => code)).size).toBeGreaterThan(100);
    for (const { code, messageKey } of declared) {
      expect(canonicalErrorCode(code), code).toMatch(ERROR_CODE_PATTERN);
      if (messageKey !== undefined) {
        expect(hasTranslationKey(messageKey), messageKey).toBe(true);
        for (const locale of SUPPORTED_LOCALES) {
          const payload = resolveLocalizedError({ status: 400, locale, code, messageKey });
          expect(payload.code, code).toMatch(ERROR_CODE_PATTERN);
          expect(payload.message, `${locale}/${messageKey}`).not.toBe(messageKey);
          expect(payload.message).not.toMatch(/\{\{/u);
        }
      }
    }
    const missingSites = declared.filter(({ code }) => /(^|_)SITES?(_ERRORS)?_NOT_FOUND$/u.test(code));
    expect(missingSites.length).toBeGreaterThan(3);
    expect(new Set(missingSites.map(({ code }) => canonicalErrorCode(code)))).toEqual(new Set(['SITE_NOT_FOUND']));
  });

  it('canonicalizes every localizable product error key and status family without leaking raw copy', () => {
    const keys = errorKeys(DICTIONARIES.en);
    expect(keys.length).toBeGreaterThan(100);
    for (const locale of SUPPORTED_LOCALES) {
      for (const messageKey of keys) {
        const payload = resolveLocalizedError({ status: 400, locale, messageKey });
        expect(payload.code, messageKey).toMatch(ERROR_CODE_PATTERN);
        expect(payload.code.startsWith('ERR'), messageKey).toBe(false);
        expect(payload.message, `${locale}/${messageKey}`).not.toBe(messageKey);
        expect(payload.message).not.toMatch(/\{\{/u);
      }
      for (const status of [400, 401, 403, 404, 409, 413, 418, 422, 429, 500, 502, 503]) {
        expect(resolveLocalizedError({ status, locale }).code).toMatch(ERROR_CODE_PATTERN);
      }
    }
  });
});
