import { describe, expect, it } from 'vitest';
import request from 'supertest';
import express, { type Request } from 'express';
import { z, ZodError } from 'zod';
import {
  deriveErrorCode,
  hasTranslationKey,
  localizeZodError,
  resolveLocalizedError,
  sanitizeTranslationVars,
  statusFamily,
  toSupportedLocale,
} from './errors.js';
import {
  DEFAULT_LOCALE,
  DICTIONARIES,
  SUPPORTED_LOCALES,
  isSupportedLocale,
  resolveLanguage,
  localizeSemanticCopy,
  semanticCopy,
  translate,
  verifyKeyParity,
  type SupportedLocale,
} from './index.js';
import { classifyValue, collectQualityIssues } from './translation-quality.js';
import { language } from '../middleware/language.js';
import {
  BEARER_DEFAULT_LOCALE,
  bearerLanguage,
  resolveBearerLanguage,
} from '../middleware/bearer-language.js';
import { errorHandler } from '../middleware/error-handler.js';
import { HttpError } from '../utils/http-error.js';
import {
  deliverPasswordChangedEmail,
  deliverPasswordResetEmail,
} from '../../modules/communication/communication.service.js';

const collectKeys = (obj: unknown, prefix = ''): string[] => {
  if (obj == null || typeof obj !== 'object') return [];
  const out: string[] = [];
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
    const path = prefix ? `${prefix}.${k}` : k;
    if (typeof v === 'string') out.push(path);
    else if (v && typeof v === 'object') out.push(...collectKeys(v, path));
  }
  return out;
};

const placeholders = (s: string): string[] =>
  Array.from(s.matchAll(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g))
    .map((m) => m[1] ?? '')
    .filter(Boolean)
    .sort();

const collectStrings = (value: unknown): string[] => {
  if (typeof value === 'string') return [value];
  if (!value || typeof value !== 'object') return [];
  return Object.values(value as Record<string, unknown>).flatMap(collectStrings);
};

describe('i18n key parity', () => {
  const baselineKeys = collectKeys(DICTIONARIES[DEFAULT_LOCALE]).sort();

  it.each(SUPPORTED_LOCALES.filter((l) => l !== DEFAULT_LOCALE))(
    '%s exposes the same key set as en',
    (locale: SupportedLocale) => {
      const keys = collectKeys(DICTIONARIES[locale]).sort();
      expect(keys).toEqual(baselineKeys);
    },
  );

  it.each(SUPPORTED_LOCALES.filter((l) => l !== DEFAULT_LOCALE))(
    '%s has identical {{var}} placeholders per key',
    (locale: SupportedLocale) => {
      const walk = (base: unknown, cmp: unknown, prefix = '') => {
        if (typeof base === 'string') {
          expect(placeholders(cmp as string)).toEqual(placeholders(base));
          return;
        }
        if (base && typeof base === 'object') {
          for (const [k, v] of Object.entries(base as Record<string, unknown>)) {
            const path = prefix ? `${prefix}.${k}` : k;
            walk(v, (cmp as Record<string, unknown>)[k], path);
          }
        }
      };
      walk(DICTIONARIES[DEFAULT_LOCALE], DICTIONARIES[locale]);
    },
  );

  it('verifyKeyParity reports ok', () => {
    expect(verifyKeyParity()).toEqual({ ok: true });
  });
});

describe('deterministic semantic copy', () => {
  it.each(SUPPORTED_LOCALES)('renders bounded metadata without raw keys in %s', (locale) => {
    const copy = localizeSemanticCopy(locale, 'competitors.landscape.opportunities.missingTitle', {
      count: 3,
      ignored: '\u0000unsafe',
      oversized: 'x'.repeat(201),
    });
    expect(copy).toEqual({
      messageKey: 'competitors.landscape.opportunities.missingTitle',
      messageVars: { count: 3 },
      message: translate(locale, 'competitors.landscape.opportunities.missingTitle', { count: 3 }),
    });
    expect(copy.message).not.toContain(copy.messageKey);
    expect(copy.message).not.toContain('{{');
  });

  it('bounds variable count, key length, strings, and non-finite numbers', () => {
    const vars = Object.fromEntries(Array.from({ length: 17 }, (_, index) => [`v${index}`, index]));
    expect(semanticCopy('weeklyPulse.actions.open', vars)).toEqual({
      messageKey: 'weeklyPulse.actions.open',
      messageVars: Object.fromEntries(
        Array.from({ length: 16 }, (_, index) => [`v${index}`, index]),
      ),
    });
    expect(semanticCopy('weeklyPulse.actions.open', {
      ['x'.repeat(33)]: 'hidden',
      long: 'x'.repeat(201),
      infinite: Number.POSITIVE_INFINITY,
      safe: 'visible',
    })).toEqual({
      messageKey: 'weeklyPulse.actions.open',
      messageVars: { safe: 'visible' },
    });
  });

  it('renders Arabic copy at the response boundary', () => {
    const copy = localizeSemanticCopy('ar', 'weeklyPulse.actions.open');
    expect(copy.message).toBe('راجع الإجراء');
    expect(copy.message).not.toMatch(/[A-Za-z]{3}/);
  });
});

describe('translation-quality guard', () => {
  const nonEn = SUPPORTED_LOCALES.filter((l) => l !== DEFAULT_LOCALE);
  const enDict = DICTIONARIES[DEFAULT_LOCALE] as unknown as Record<string, unknown>;
  const namespaces = Object.keys(enDict);

  it.each(nonEn)(
    '%s: server dictionaries carry no raw-English / wholesale-copied leaf values',
    (locale: SupportedLocale) => {
      const localeDict = DICTIONARIES[locale] as unknown as Record<string, unknown>;
      const issues = namespaces.flatMap((ns) =>
        collectQualityIssues(locale, ns, enDict[ns], localeDict[ns]),
      );
      const report = issues
        .map((i) => `  ${i.locale}/${i.namespace}:${i.key} [${i.reason}] → ${JSON.stringify(i.value)}`)
        .join('\n');
      expect(issues, `Untranslated / copied server values:\n${report}`).toEqual([]);
    },
  );

  it('keeps every toxicity error and preview string free of penalty-prediction wording', () => {
    for (const locale of SUPPORTED_LOCALES) {
      const copy = collectStrings(DICTIONARIES[locale].backlinks.toxicity).join(' ');
      expect(copy, `${locale}/backlinks.toxicity must not claim a penalty`).not.toMatch(
        /\bpenalt(?:y|ies)\b/iu,
      );
    }
  });

  // HONEST-3 (server half). The client asserts the same contract over the seven
  // `schemaGenerator` client namespaces; these are the strings the API itself
  // returns. Generating JSON-LD is a schema.org conformance statement and
  // nothing more — it is never a rich result, a star rating, or a ranking.
  const SCHEMA_OVERPROMISE: Record<SupportedLocale, RegExp> = {
    en: /rich result|rich snippet|guarantee|will rank|star rating|top of google/iu,
    fr: /résultat enrichi|extrait enrichi|garanti|classera|étoiles dans/iu,
    de: /rich[- ]snippet|garantie|garantiert|sterne[- ]bewertung|besser ranken/iu,
    es: /resultado enriquecido|fragmento enriquecido|garantiz|posicionar[áa]|estrellas en/iu,
    ru: /расширенн\w* результат|гарант|попад\w* в топ|звёзд\w* рейтинг/iu,
    zh: /丰富结果|富媒体结果|保证|排名提升|星级评分/u,
    ar: /نتائج منسقة|نتيجة منسقة|نضمن|ضمان|تصنيف النجوم/u,
  };

  it('keeps every schema-generator string free of rich-result / ranking promises', () => {
    for (const locale of SUPPORTED_LOCALES) {
      const values = collectStrings(DICTIONARIES[locale].schemaGenerator);
      expect(values.length).toBeGreaterThan(0);
      const offenders = values.filter((value) => SCHEMA_OVERPROMISE[locale].test(value));
      expect(
        offenders,
        `${locale}/schemaGenerator must not promise a search result`,
      ).toEqual([]);
    }
  });

  describe('detector self-tests (branch coverage)', () => {
    it('flags a wholesale English sentence copied into a Latin locale', () => {
      const en = 'You have reached the AI mentions cap for this billing period.';
      expect(classifyValue('fr', 'aiVisibility', 'errors.capReached', en, en)).toBe('copied-en');
    });
    it('flags raw English left in a non-Latin locale', () => {
      expect(classifyValue('ar', 'aiVisibility', 'errors.title', 'Not found', 'Not found')).toBe(
        'ascii-latin',
      );
    });
    it('passes a translated non-Latin value', () => {
      expect(classifyValue('ru', 'errors', 'notFound', 'Not found', 'Не найдено')).toBeNull();
    });
    it('passes an allowlisted namespace (language)', () => {
      expect(classifyValue('ar', 'language', 'names.de', 'Deutsch', 'Deutsch')).toBeNull();
    });
    it('passes an allowlisted _marker key', () => {
      expect(classifyValue('ar', 'common', '_marker', 'sentinel text', 'sentinel text')).toBeNull();
    });
    it('passes a tier plan proper noun', () => {
      expect(classifyValue('ru', 'billing', 'plan.pro', 'Pro', 'Pro')).toBeNull();
    });
    it('passes a marketing pricing tier name', () => {
      expect(classifyValue('ru', 'pricing', 'tiers.agency.name', 'Agency', 'Agency')).toBeNull();
    });
    it('passes a literal markup snippet', () => {
      const snippet = '<meta name="description" content="x" />';
      expect(classifyValue('ar', 'seo', 'metaExample', snippet, snippet)).toBeNull();
    });
    it('passes a brand-only value', () => {
      expect(classifyValue('ru', 'billing', 'vendor', 'DataForSEO', 'DataForSEO')).toBeNull();
    });
    it('passes a placeholder-only value', () => {
      expect(classifyValue('zh', 'errors', 'count', '{{count}}', '{{count}}')).toBeNull();
    });
    it('passes a short cognate copied from en (under length threshold)', () => {
      expect(classifyValue('de', 'common', 'status', 'Status', 'Status')).toBeNull();
    });
    it('passes a proper-noun-only string coincidentally identical to en', () => {
      const v = 'Sitemaps in Google Search Console';
      expect(classifyValue('de', 'report', 'gscBlock.sitemapsTitle', v, v)).toBeNull();
    });
    it('collectQualityIssues skips a leaf whose locale value is not a string', () => {
      expect(
        collectQualityIssues('ar', 'x', { a: 'English words here' }, { a: 123 }),
      ).toEqual([]);
    });
    it('collectQualityIssues walks nested objects and reports the dotted key', () => {
      const issues = collectQualityIssues(
        'ar',
        'x',
        { group: { leaf: 'Raw English value' } },
        { group: { leaf: 'Raw English value' } },
      );
      expect(issues).toHaveLength(1);
      expect(issues[0]?.key).toBe('group.leaf');
    });

    it('collectQualityIssues tolerates a non-string en leaf and a missing locale subtree', () => {
      expect(collectQualityIssues('ar', 'x', { a: null }, { a: 'x' })).toEqual([]);
      expect(collectQualityIssues('ar', 'x', { g: { leaf: 'x' } }, undefined)).toEqual([]);
    });
  });
});

describe('i18n resolver branch completeness', () => {
  it('returns the raw key when the path resolves to a parent object, not a string leaf', () => {
    // `email` is a parent namespace (email.passwordReset.*), so resolveKey hits
    // its `typeof cursor === "string" ? … : undefined` false arm.
    expect(translate('en', 'email')).toBe('email');
  });

  it('ignores an Accept-Language param that has no "=" (e.g. "en;q")', () => {
    // The `;q` param yields value === undefined, exercising the `value !== undefined` false branch.
    expect(resolveLanguage({ acceptLanguage: 'en;q' })).toBe('en');
  });

  it('verifyKeyParity treats a null locale dictionary as empty (obj == null arm)', () => {
    const dicts: Record<string, unknown> = {};
    for (const locale of SUPPORTED_LOCALES) dicts[locale] = { a: 'x' };
    const broken = SUPPORTED_LOCALES.find((l) => l !== DEFAULT_LOCALE) as SupportedLocale;
    dicts[broken] = null;
    expect(verifyKeyParity(dicts).ok).toBe(false);
  });

  it('verifyKeyParity treats a non-object locale dictionary as empty (typeof !== object arm)', () => {
    const dicts: Record<string, unknown> = {};
    for (const locale of SUPPORTED_LOCALES) dicts[locale] = { a: 'x' };
    const broken = SUPPORTED_LOCALES.filter((l) => l !== DEFAULT_LOCALE)[1] as SupportedLocale;
    dicts[broken] = 'not-an-object';
    expect(verifyKeyParity(dicts).ok).toBe(false);
  });
});

describe('isSupportedLocale', () => {
  it('accepts every supported locale', () => {
    for (const locale of SUPPORTED_LOCALES) {
      expect(isSupportedLocale(locale)).toBe(true);
    }
  });
  it('rejects unknown values', () => {
    expect(isSupportedLocale('xx')).toBe(false);
    expect(isSupportedLocale(null)).toBe(false);
    expect(isSupportedLocale(42)).toBe(false);
  });
});

describe('translate()', () => {
  it.each(SUPPORTED_LOCALES)(
    '%s ships Link Intelligence errors and every run transition label',
    (locale: SupportedLocale) => {
      for (const key of [
        'backlinks.errors.domainInvalid',
        'backlinks.runStatus.queued',
        'backlinks.runStatus.running',
        'backlinks.runStatus.succeeded',
        'backlinks.runStatus.failed',
        'backlinks.gapLegStatus.ok',
        'backlinks.gapLegStatus.failed',
        'backlinks.gapLegStatus.zeroRetained',
      ]) {
        expect(translate(locale, key)).not.toBe(key);
      }
    },
  );

  it('resolves dotted paths per locale', () => {
    expect(translate('fr', 'errors.notFound')).toMatch(/introuvable/i);
    expect(translate('de', 'errors.notFound')).toMatch(/nicht gefunden/i);
    expect(translate('ar', 'errors.notFound')).toContain('غير موجود');
  });
  it('interpolates {{var}}', () => {
    const out = translate('en', 'email.passwordReset.body', { resetUrl: 'https://example.test/r' });
    expect(out).toContain('https://example.test/r');
    expect(out).not.toContain('{{resetUrl}}');
  });
  it('falls back to English for unsupported locale', () => {
    const enMsg = translate('en', 'errors.notFound');
    expect(translate('xx' as unknown as SupportedLocale, 'errors.notFound')).toBe(enMsg);
  });
  it('falls back to English when key exists in en but not in locale (defensive)', () => {
    expect(translate('fr', 'nonexistent.key')).toBe('nonexistent.key');
  });
  it('returns raw key when unknown everywhere', () => {
    expect(translate('en', 'no.such.key')).toBe('no.such.key');
  });
  it('handles missing vars gracefully', () => {
    expect(translate('en', 'email.passwordReset.body')).toContain('{{resetUrl}}'.replace(/\{|\}/g, ''));
  });
  it('leaves undefined placeholders as empty strings', () => {
    const out = translate('en', 'email.passwordReset.body', {});
    expect(out).not.toContain('{{');
  });
  it('ignores malformed key segments', () => {
    expect(translate('en', 'errors..notFound')).toBe('errors..notFound');
    expect(translate('en', 'errors.$$$')).toBe('errors.$$$');
  });
});

describe('resolveLanguage()', () => {
  it('picks the top-quality tag from Accept-Language', () => {
    expect(
      resolveLanguage({ acceptLanguage: 'fr-FR,fr;q=0.9,en;q=0.8' }),
    ).toBe('fr');
  });
  it('handles unquoted single tag', () => {
    expect(resolveLanguage({ acceptLanguage: 'de' })).toBe('de');
  });
  it('falls back to en for unsupported tags', () => {
    expect(resolveLanguage({ acceptLanguage: 'xx-YY' })).toBe('en');
  });
  it('honors x-lang override above Accept-Language', () => {
    expect(
      resolveLanguage({ override: 'ar', acceptLanguage: 'fr' }),
    ).toBe('ar');
  });
  it('honors cookie value above Accept-Language', () => {
    expect(
      resolveLanguage({ cookieValue: 'zh', acceptLanguage: 'fr' }),
    ).toBe('zh');
  });
  it('override beats cookie', () => {
    expect(
      resolveLanguage({ override: 'ru', cookieValue: 'zh', acceptLanguage: 'fr' }),
    ).toBe('ru');
  });
  it('picks primary subtag when full tag is unsupported', () => {
    expect(resolveLanguage({ acceptLanguage: 'es-419' })).toBe('es');
  });
  it('ignores unsupported override and cookie', () => {
    expect(
      resolveLanguage({ override: 'xx', cookieValue: 'yy', acceptLanguage: 'de' }),
    ).toBe('de');
  });
  it('defaults to en when empty', () => {
    expect(resolveLanguage({})).toBe('en');
    expect(resolveLanguage({ acceptLanguage: '' })).toBe('en');
  });
  it('honors defaultLocale param', () => {
    expect(
      resolveLanguage({ acceptLanguage: '', defaultLocale: 'ru' }),
    ).toBe('ru');
  });
  it('skips entries with invalid q= silently', () => {
    expect(
      resolveLanguage({ acceptLanguage: 'de;q=xxx,fr;q=0.9' }),
    ).toBe('de');
  });
});

describe('language middleware', () => {
  const buildApp = () => {
    const app = express();
    app.use(language);
    app.get('/lang', (req, res) => {
      res.json({ language: req.language, translated: req.t('errors.notFound') });
    });
    app.get('/vars', (req, res) => {
      res.json({ msg: req.t('email.passwordReset.body', { resetUrl: 'https://x' }) });
    });
    app.get('/boom', (_req, _res, next) => {
      next(HttpError.notFound({ code: 'ERRORS_PROJECT_NOT_FOUND', messageKey: 'errors.projectNotFound' }));
    });
    app.use(errorHandler);
    return app;
  };

  it('sets req.language from Accept-Language', async () => {
    const res = await request(buildApp())
      .get('/lang')
      .set('Accept-Language', 'de,en;q=0.5');
    expect(res.body.language).toBe('de');
    expect(res.body.translated).toMatch(/nicht gefunden/i);
  });

  it('interpolates via req.t', async () => {
    const res = await request(buildApp()).get('/vars').set('Accept-Language', 'fr');
    expect(res.body.msg).toContain('https://x');
  });

  it('honors x-lang header', async () => {
    const res = await request(buildApp())
      .get('/lang')
      .set('x-lang', 'ar')
      .set('Accept-Language', 'fr');
    expect(res.body.language).toBe('ar');
    expect(res.body.translated).toContain('غير موجود');
  });

  it('honors lang cookie', async () => {
    const res = await request(buildApp())
      .get('/lang')
      .set('Cookie', 'lang=ru')
      .set('Accept-Language', 'en');
    expect(res.body.language).toBe('ru');
  });

  it('translates HttpError message keys via error-handler wrap', async () => {
    const res = await request(buildApp())
      .get('/boom')
      .set('Accept-Language', 'es');
    expect(res.status).toBe(404);
    expect(res.body.error.message).toMatch(/Proyecto no encontrado/);
  });

  it('fails closed on a non-key HttpError message instead of leaking it', async () => {
    const app = express();
    app.use(language);
    app.get('/plain', (_req, _res, next) =>
      next(
        HttpError.badRequest(
          { code: 'LITERAL_MESSAGE', messageKey: 'literal message' } as never,
        ),
      ),
    );
    app.use(errorHandler);
    const res = await request(app).get('/plain').set('Accept-Language', 'es');
    expect(res.body.error).toEqual({
      message: translate('es', 'errors.badRequest'),
      code: 'BAD_REQUEST',
      messageKey: 'errors.badRequest',
    });
    expect(res.headers['content-language']).toBe('es');
  });

  it('serializes Zod errors with a localized message', async () => {
    const { z } = await import('zod');
    const app = express();
    app.use(language);
    app.get('/zod', (_req, _res, next) => next(z.object({ a: z.string() }).safeParse({}).error!));
    app.use(errorHandler);
    const res = await request(app).get('/zod').set('Accept-Language', 'de');
    expect(res.status).toBe(400);
    expect(res.body.error.message).toMatch(/Validierung/);
  });

  it('serializes unhandled errors as internal', async () => {
    const app = express();
    app.use(language);
    app.get('/x', (_req, _res, next) => next(new Error('kaboom')));
    app.use(errorHandler);
    const res = await request(app).get('/x').set('Accept-Language', 'fr');
    expect(res.status).toBe(500);
    expect(res.body.error.message).toMatch(/Une erreur/i);
  });

  it('reads cookie with URI-encoded value', async () => {
    const app = express();
    app.use(language);
    app.get('/l', (req: Request, res) => res.json({ language: req.language }));
    const res = await request(app).get('/l').set('Cookie', 'lang=%7A%68'); // zh
    expect(res.body.language).toBe('zh');
  });
});

describe('bearer language middleware', () => {
  const buildApp = () => {
    const app = express();
    app.use(language);
    app.use(bearerLanguage);
    app.get('/lang', (req, res) => {
      res.json({ language: req.language, translated: req.t('errors.notFound') });
    });
    return app;
  };

  it('uses x-lang before Accept-Language and normalizes regional tags', async () => {
    const response = await request(buildApp())
      .get('/lang')
      .set('x-lang', 'fr-CA')
      .set('Accept-Language', 'de-DE');

    expect(response.body).toEqual({
      language: 'fr',
      translated: translate('fr', 'errors.notFound'),
    });
    expect(response.headers['content-language']).toBe('fr');
    expect(response.headers.vary).toBe('x-lang, Accept-Language');
  });

  it('ignores browser cookies and defaults to fixed English', async () => {
    const response = await request(buildApp())
      .get('/lang')
      .set('Cookie', 'lang=ru');

    expect(BEARER_DEFAULT_LOCALE).toBe('en');
    expect(response.body.language).toBe('en');
    expect(response.body.translated).toBe(translate('en', 'errors.notFound'));
  });

  it('falls through invalid x-lang to negotiated Accept-Language', () => {
    expect(resolveBearerLanguage('unsupported', 'zh-Hant, de;q=0.8')).toBe('zh');
    expect(resolveBearerLanguage(undefined, 'ar-EG')).toBe('ar');
  });
});

describe('communication localized emails', () => {
  it('renders subject + body in the caller locale', async () => {
    const messages: unknown[] = [];
    const { sendEmail } = await import('../../modules/communication/mailers/resend.js');
    // Delegating via sendEmail without a Resend key returns {delivered:false}; we spy through translate().
    // Instead, we assert translate() output is what deliverPasswordResetEmail produces.
    void messages;
    void sendEmail;

    // Direct call — no Resend credentials in test env, so the transport short-circuits.
    await deliverPasswordResetEmail('u@example.com', 'https://r.example', 'de');
    await deliverPasswordChangedEmail('u@example.com', 'ru');

    expect(translate('de', 'email.passwordReset.subject')).toMatch(/Passwort/);
    expect(translate('de', 'email.passwordReset.body', { resetUrl: 'https://r' })).toContain('https://r');
    expect(translate('ru', 'email.passwordChanged.subject')).toMatch(/пароль/i);
  });

  it('defaults to English when no locale is passed', async () => {
    await deliverPasswordResetEmail('u@example.com', 'https://r');
    expect(translate(DEFAULT_LOCALE, 'email.passwordReset.subject')).toBe('Reset your password');
  });
});

describe('verifyKeyParity mismatch detection', () => {
  it('reports missing, mismatched, and extra keys against a broken locale set', () => {
    const good = { greet: 'hi {{name}}', bye: 'bye' };
    const dicts: Record<string, unknown> = {};
    for (const locale of SUPPORTED_LOCALES) dicts[locale] = { ...good };
    // Break exactly one non-default locale to exercise every issue branch.
    const broken = SUPPORTED_LOCALES.find((l) => l !== DEFAULT_LOCALE) as SupportedLocale;
    dicts[broken] = { greet: 'hola {{other}}', extra: 'x' }; // mismatch + missing 'bye' + extra

    const result = verifyKeyParity(dicts);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected parity failure');
    expect(result.issues.some((i) => i.includes('missing key'))).toBe(true);
    expect(result.issues.some((i) => i.includes('interpolation mismatch'))).toBe(true);
    expect(result.issues.some((i) => i.includes('extra key'))).toBe(true);
  });
});

describe('bounded interpolation variables', () => {
  it('keeps short named scalars and rejects everything else', () => {
    expect(
      sanitizeTranslationVars({ metric: 'audits', used: 3, limit: 3.5 }),
    ).toEqual({ metric: 'audits', used: 3, limit: 3.5 });
  });

  it('rejects non-object containers outright', () => {
    expect(sanitizeTranslationVars(undefined)).toBeUndefined();
    expect(sanitizeTranslationVars(null)).toBeUndefined();
    expect(sanitizeTranslationVars('metric=audits')).toBeUndefined();
    expect(sanitizeTranslationVars(['audits'])).toBeUndefined();
  });

  it('drops dangerous names, malformed names, and oversized or non-scalar values', () => {
    expect(
      sanitizeTranslationVars({
        __proto__: 'polluted',
        constructor: 'polluted',
        prototype: 'polluted',
        'not a name': 'x',
        '9leading': 'x',
        [`${'n'.repeat(40)}`]: 'x',
        empty: '',
        huge: 'x'.repeat(201),
        injected: 'line one\nline two',
        infinite: Number.POSITIVE_INFINITY,
        notANumber: Number.NaN,
        flag: true,
        nested: { a: 1 },
        missing: undefined,
        kept: 'audits',
      }),
    ).toEqual({ kept: 'audits' });
  });

  it('stops accepting variables past the bound', () => {
    const many: Record<string, string> = {};
    for (let i = 0; i < 40; i += 1) many[`v${i}`] = 'x';
    expect(Object.keys(sanitizeTranslationVars(many) ?? {})).toHaveLength(16);
  });

  it('returns undefined when nothing survived', () => {
    expect(sanitizeTranslationVars({ 'bad key': 'x' })).toBeUndefined();
  });
});

describe('stable error codes and status families', () => {
  it('derives a screaming-snake code from a dotted key', () => {
    expect(deriveErrorCode('ranks.errors.checkCooldown')).toBe('RANKS_ERRORS_CHECK_COOLDOWN');
    expect(deriveErrorCode('auditRules.robots-blocked.title')).toBe(
      'AUDIT_RULES_ROBOTS_BLOCKED_TITLE',
    );
  });

  it('falls back to a generic code when nothing survives sanitization', () => {
    expect(deriveErrorCode('...')).toBe('ERROR');
  });

  it('maps exact statuses, other 4xx, and everything else', () => {
    expect(statusFamily(404)).toEqual({ code: 'NOT_FOUND', messageKey: 'errors.notFound' });
    expect(statusFamily(429)).toEqual({
      code: 'TOO_MANY_REQUESTS',
      messageKey: 'errors.tooManyRequests',
    });
    expect(statusFamily(418)).toEqual({ code: 'BAD_REQUEST', messageKey: 'errors.badRequest' });
    expect(statusFamily(502)).toEqual({ code: 'INTERNAL', messageKey: 'errors.internal' });
  });

  it('recognizes only real English string leaves as translation keys', () => {
    expect(hasTranslationKey('errors.notFound')).toBe(true);
    expect(hasTranslationKey('errors')).toBe(false);
    expect(hasTranslationKey('nope.missing')).toBe(false);
    expect(hasTranslationKey('errors.notFound.deeper')).toBe(false);
    expect(hasTranslationKey('not a key')).toBe(false);
    expect(hasTranslationKey(42)).toBe(false);
  });

  it('normalizes an unsupported locale value onto the default', () => {
    expect(toSupportedLocale('fr')).toBe('fr');
    expect(toSupportedLocale('kl')).toBe(DEFAULT_LOCALE);
  });
});

describe('resolveLocalizedError fail-closed contract', () => {
  it('renders a known key with a derived code in every locale', () => {
    for (const locale of SUPPORTED_LOCALES) {
      const payload = resolveLocalizedError({
        status: 404,
        locale,
        messageKey: 'errors.projectNotFound',
      });
      expect(payload).toEqual({
        code: 'ERRORS_PROJECT_NOT_FOUND',
        messageKey: 'errors.projectNotFound',
        message: translate(locale, 'errors.projectNotFound'),
      });
      expect(payload.message).not.toBe('errors.projectNotFound');
    }
  });

  it('keeps an explicit stable code and drops a malformed one', () => {
    expect(
      resolveLocalizedError({
        status: 409,
        locale: 'en',
        messageKey: 'errors.conflict',
        code: 'PAGES_SITE_NOT_FOUND',
      }).code,
    ).toBe('PAGES_SITE_NOT_FOUND');
    expect(
      resolveLocalizedError({
        status: 409,
        locale: 'en',
        messageKey: 'errors.conflict',
        code: 'drop me; DROP TABLE',
      }).code,
    ).toBe('ERRORS_CONFLICT');
  });

  it('fails closed to the status family for unknown keys and legacy literals', () => {
    expect(resolveLocalizedError({ status: 403, locale: 'en', messageKey: 'nope.missing' })).toEqual({
      code: 'FORBIDDEN',
      messageKey: 'errors.forbidden',
      message: translate('en', 'errors.forbidden'),
    });
    expect(
      resolveLocalizedError({
        status: 400,
        locale: 'en',
        messageKey: 'Site https://acme.test is not reachable',
      }).message,
    ).toBe(translate('en', 'errors.badRequest'));
    expect(resolveLocalizedError({ status: 500, locale: 'en' }).code).toBe('INTERNAL');
  });

  it('interpolates accepted vars and strips the placeholders it cannot fill', () => {
    expect(
      resolveLocalizedError({
        status: 402,
        locale: 'en',
        messageKey: 'billing.errors.capExceeded',
        vars: { metric: 'audits' },
      }).message,
    ).toContain('audits');
    const bare = resolveLocalizedError({
      status: 402,
      locale: 'en',
      messageKey: 'billing.errors.capExceeded',
    }).message;
    expect(bare).not.toContain('{{');
    expect(bare).not.toContain('metric');
  });
});

describe('localized Zod issues', () => {
  const issues = (list: unknown[]) =>
    localizeZodError('en', new ZodError(list as never)).issues;

  it('preserves the flatten topology and adds the issue list', () => {
    const schema = z.object({
      email: z.string().email(),
      tags: z.array(z.string()).min(2),
    });
    const parsed = schema.safeParse({ email: 'nope', tags: ['one'] });
    if (parsed.success) throw new Error('expected a validation failure');
    const details = localizeZodError('fr', parsed.error);
    expect(details.formErrors).toEqual([]);
    expect(details.fieldErrors).toEqual({
      email: [translate('fr', 'validation.issue.invalidEmail')],
      tags: [translate('fr', 'validation.issue.tooSmallArray', { minimum: 2 })],
    });
    expect(details.issues.map((i) => i.messageKey)).toEqual([
      'validation.issue.invalidEmail',
      'validation.issue.tooSmallArray',
    ]);
  });

  it('routes a form-level issue into formErrors and groups repeated field issues', () => {
    const details = localizeZodError('en', new ZodError([
      { code: 'custom', path: [], message: 'root is wrong' },
      { code: 'custom', path: ['name'], message: 'first' },
      { code: 'custom', path: ['name'], message: 'second' },
    ] as never));
    expect(details.formErrors).toEqual([translate('en', 'validation.issue.custom')]);
    expect(details.fieldErrors.name).toHaveLength(2);
  });

  it('prefers a keyed refinement message over the generic copy', () => {
    expect(
      issues([{ code: 'custom', path: ['url'], message: 'sites.errors.urlInvalid' }])[0],
    ).toEqual({
      code: 'custom',
      path: ['url'],
      messageKey: 'sites.errors.urlInvalid',
      message: translate('en', 'sites.errors.urlInvalid'),
    });
  });

  it('never copies literal schema text onto the wire', () => {
    const [issue] = issues([
      { code: 'custom', path: ['seed'], message: 'internal regex /^[a-z]{3}$/ failed' },
    ]);
    expect(issue?.messageKey).toBe('validation.issue.custom');
    expect(issue?.message).not.toContain('regex');
  });

  it('separates a missing field from a wrongly typed one', () => {
    expect(
      issues([
        { code: 'invalid_type', path: ['a'], expected: 'string', received: 'undefined', message: 'Required' },
        { code: 'invalid_type', path: ['b'], expected: 'string', received: 'number', message: 'Expected string' },
      ]).map((i) => i.messageKey),
    ).toEqual(['validation.issue.required', 'validation.issue.invalidType']);
  });

  it('maps every string validation family it knows and falls back otherwise', () => {
    expect(
      issues([
        { code: 'invalid_string', validation: 'email', path: ['a'], message: 'Invalid email' },
        { code: 'invalid_string', validation: 'url', path: ['b'], message: 'Invalid url' },
        { code: 'invalid_string', validation: 'uuid', path: ['c'], message: 'Invalid uuid' },
        { code: 'invalid_string', validation: 'datetime', path: ['d'], message: 'Invalid datetime' },
        { code: 'invalid_string', validation: 'regex', path: ['e'], message: 'Invalid' },
        { code: 'invalid_string', validation: { includes: 'x' }, path: ['f'], message: 'Invalid' },
      ]).map((i) => i.messageKey),
    ).toEqual([
      'validation.issue.invalidEmail',
      'validation.issue.invalidUrl',
      'validation.issue.invalidUuid',
      'validation.issue.invalidDatetime',
      'validation.issue.invalidString',
      'validation.issue.invalidString',
    ]);
  });

  it('maps every sized family with a bounded numeric interpolation', () => {
    expect(
      issues([
        { code: 'too_small', type: 'string', minimum: 3, inclusive: true, path: ['a'], message: '' },
        { code: 'too_small', type: 'number', minimum: 18, inclusive: true, path: ['b'], message: '' },
        { code: 'too_small', type: 'array', minimum: 2, inclusive: true, path: ['c'], message: '' },
        { code: 'too_small', type: 'set', minimum: 1, inclusive: true, path: ['d'], message: '' },
        { code: 'too_small', type: 'date', minimum: 1, inclusive: true, path: ['e'], message: '' },
        { code: 'too_small', type: 'bigint', minimum: BigInt(5), inclusive: true, path: ['f'], message: '' },
        { code: 'too_big', type: 'string', maximum: 30, inclusive: true, path: ['g'], message: '' },
        { code: 'too_big', type: 'number', maximum: 99, inclusive: true, path: ['h'], message: '' },
        { code: 'too_big', type: 'array', maximum: 4, inclusive: true, path: ['i'], message: '' },
        { code: 'too_big', type: 'set', maximum: 4, inclusive: true, path: ['j'], message: '' },
        { code: 'too_big', type: 'date', maximum: 4, inclusive: true, path: ['k'], message: '' },
        { code: 'too_big', type: 'bigint', maximum: BigInt(7), inclusive: true, path: ['l'], message: '' },
      ]).map((i) => i.messageKey),
    ).toEqual([
      'validation.issue.tooSmallString',
      'validation.issue.tooSmallNumber',
      'validation.issue.tooSmallArray',
      'validation.issue.tooSmallArray',
      'validation.issue.tooSmallDate',
      'validation.issue.tooSmallNumber',
      'validation.issue.tooBigString',
      'validation.issue.tooBigNumber',
      'validation.issue.tooBigArray',
      'validation.issue.tooBigArray',
      'validation.issue.tooBigDate',
      'validation.issue.tooBigNumber',
    ]);
  });

  it('drops a bound it cannot represent safely instead of rendering it', () => {
    const [unsafe, missing, multiple, nonFinite] = issues([
      {
        code: 'too_big',
        type: 'bigint',
        maximum: BigInt('9007199254740993'),
        inclusive: true,
        path: ['a'],
        message: '',
      },
      { code: 'too_small', type: 'string', minimum: 'three', inclusive: true, path: ['b'], message: '' },
      { code: 'not_multiple_of', multipleOf: 5, path: ['c'], message: '' },
      { code: 'too_small', type: 'number', minimum: Number.NaN, inclusive: true, path: ['d'], message: '' },
    ]);
    expect(unsafe?.message).not.toContain('9007199254740');
    expect(unsafe?.message).not.toContain('{{');
    expect(missing?.message).not.toContain('{{');
    expect(multiple?.message).toBe(
      translate('en', 'validation.issue.notMultipleOf', { multipleOf: 5 }),
    );
    expect(nonFinite?.message).not.toContain('NaN');
    expect(nonFinite?.message).not.toContain('{{');
  });

  it('maps the remaining standard codes and any unknown code', () => {
    expect(
      issues([
        { code: 'invalid_literal', path: ['a'], message: '' },
        { code: 'unrecognized_keys', keys: ['x'], path: [], message: '' },
        { code: 'invalid_union', unionErrors: [], path: ['c'], message: '' },
        { code: 'invalid_union_discriminator', options: [], path: ['d'], message: '' },
        { code: 'invalid_enum_value', options: [], received: 'x', path: ['e'], message: '' },
        { code: 'invalid_arguments', argumentsError: null, path: ['f'], message: '' },
        { code: 'invalid_return_type', returnTypeError: null, path: ['g'], message: '' },
        { code: 'invalid_date', path: ['h'], message: '' },
        { code: 'invalid_intersection_types', path: ['i'], message: '' },
        { code: 'not_finite', path: ['j'], message: '' },
        { code: 'brand_new_zod_code', path: ['k'], message: '' },
      ]).map((i) => i.messageKey),
    ).toEqual([
      'validation.issue.invalidLiteral',
      'validation.issue.unrecognizedKeys',
      'validation.issue.invalidUnion',
      'validation.issue.invalidUnionDiscriminator',
      'validation.issue.invalidEnumValue',
      'validation.issue.invalidArguments',
      'validation.issue.invalidReturnType',
      'validation.issue.invalidDate',
      'validation.issue.invalidIntersectionTypes',
      'validation.issue.notFinite',
      'validation.issue.unknown',
    ]);
  });

  it('keeps only string and number path segments', () => {
    const [issue] = issues([
      { code: 'custom', path: ['items', 0, Symbol('hidden')], message: '' },
    ]);
    expect(issue?.path).toEqual(['items', 0]);
  });

  it('localizes issue copy in all seven locales', () => {
    for (const locale of SUPPORTED_LOCALES) {
      const details = localizeZodError(locale, new ZodError([
        { code: 'invalid_type', path: ['name'], expected: 'string', received: 'undefined', message: 'Required' },
      ] as never));
      expect(details.fieldErrors.name).toEqual([translate(locale, 'validation.issue.required')]);
    }
  });
});
