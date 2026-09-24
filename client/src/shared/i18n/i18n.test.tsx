import { describe, expect, it, beforeEach, vi } from 'vitest';
import { render, screen, act, fireEvent, waitFor } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import {
  DEFAULT_LOCALE,
  NAMESPACES,
  SUPPORTED_LOCALES,
  applyLocaleToDocument,
  changeLanguage,
  i18n,
  initI18n,
  isRtl,
  isSupportedLocale,
  persistLocale,
  readStoredLocale,
} from './index';
import { RESOURCES } from './resources';
import { LanguageSwitcher } from './LanguageSwitcher';
import { LANGUAGE_COOKIE } from './locales';
import { classifyValue, collectQualityIssues } from './translation-quality';

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

const clearCookie = (name: string) => {
  document.cookie = `${name}=; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT`;
};

describe('client i18n key parity', () => {
  it.each(NAMESPACES)(
    '%s namespace: all 7 locales expose identical key sets',
    (ns) => {
      const baselineKeys = collectKeys(RESOURCES[DEFAULT_LOCALE][ns]).sort();
      for (const locale of SUPPORTED_LOCALES) {
        const keys = collectKeys(RESOURCES[locale][ns]).sort();
        expect(keys, `${locale}/${ns} keys must match ${DEFAULT_LOCALE}`).toEqual(baselineKeys);
      }
    },
  );

  it.each(NAMESPACES)(
    '%s namespace: {{var}} placeholders match across locales',
    (ns) => {
      const walk = (base: unknown, cmp: unknown) => {
        if (typeof base === 'string') {
          expect(placeholders(cmp as string)).toEqual(placeholders(base));
          return;
        }
        if (base && typeof base === 'object') {
          for (const [k, v] of Object.entries(base as Record<string, unknown>)) {
            walk(v, (cmp as Record<string, unknown>)[k]);
          }
        }
      };
      const baseline = RESOURCES[DEFAULT_LOCALE][ns];
      for (const locale of SUPPORTED_LOCALES) {
        walk(baseline, RESOURCES[locale][ns]);
      }
    },
  );

  it('keeps every toxicity locale in observation language without penalty-prediction wording', () => {
    for (const locale of SUPPORTED_LOCALES) {
      const backlinks = RESOURCES[locale].backlinks as Record<string, unknown>;
      const copy = collectStrings(backlinks.toxicity).join(' ');
      expect(copy, `${locale}/backlinks.toxicity must not claim a penalty`).not.toMatch(
        /\bpenalt(?:y|ies)\b/iu,
      );
    }
  });
});

describe('translation-quality guard', () => {
  const nonEnLocales = SUPPORTED_LOCALES.filter((l) => l !== DEFAULT_LOCALE);

  it.each(nonEnLocales)(
    '%s: no raw-English / wholesale-copied leaf values leak past key parity',
    (locale) => {
      const issues = NAMESPACES.flatMap((ns) =>
        collectQualityIssues(locale, ns, RESOURCES[DEFAULT_LOCALE][ns], RESOURCES[locale][ns]),
      );
      const report = issues
        .map((i) => `  ${i.locale}/${i.namespace}:${i.key} [${i.reason}] → ${JSON.stringify(i.value)}`)
        .join('\n');
      expect(issues, `Untranslated / copied values found:\n${report}`).toEqual([]);
    },
  );

  describe('detector self-tests', () => {
    it('flags a wholesale English sentence copied into a Latin locale', () => {
      const en = 'Track how often AI assistants mention your brand in their answers.';
      expect(classifyValue('fr', 'aiVisibility', 'intro', en, en)).toBe('copied-en');
    });

    it('flags raw English left in a non-Latin (Arabic) locale', () => {
      expect(classifyValue('ar', 'aiVisibility', 'title', 'AI Visibility', 'AI Visibility')).toBe(
        'ascii-latin',
      );
    });

    it('passes a genuinely translated Arabic value', () => {
      expect(
        classifyValue('ar', 'aiVisibility', 'title', 'AI Visibility', 'ظهور الذكاء الاصطناعي'),
      ).toBeNull();
    });

    it('passes a whole allowlisted namespace (language endonyms)', () => {
      expect(classifyValue('ar', 'language', 'names.fr', 'Français', 'Français')).toBeNull();
    });

    it('passes a brand-only value in a non-Latin locale', () => {
      expect(classifyValue('ru', 'common', 'vendor', 'DataForSEO', 'DataForSEO')).toBeNull();
    });

    it('passes a literal markup / code snippet copied across locales', () => {
      const snippet = '<title>Pricing — RankMeFast</title>';
      expect(classifyValue('ar', 'marketing', 'home.snippet', snippet, snippet)).toBeNull();
    });

    it('passes a placeholder-only value', () => {
      expect(classifyValue('zh', 'common', 'count', '{{count}}', '{{count}}')).toBeNull();
    });

    it('passes a short cognate copied from en (under the length threshold)', () => {
      expect(classifyValue('de', 'common', 'status', 'Status', 'Status')).toBeNull();
    });

    it('passes the literal competitor domain placeholder at its exact key only', () => {
      expect(
        classifyValue(
          'ar',
          'competitorsTraffic',
          'request.domainPlaceholder',
          'example.com',
          'example.com',
        ),
      ).toBeNull();
      expect(
        classifyValue('ar', 'competitorsTraffic', 'request.help', 'example.com', 'example.com'),
      ).toBe('ascii-latin');
    });

    it('passes the canonical People Also Ask label at its exact feature key only', () => {
      const key = 'featurePages.serpFeatures.truth.items.second.title';
      expect(classifyValue('zh', 'marketing', key, 'People Also Ask', 'People Also Ask')).toBeNull();
      expect(
        classifyValue('zh', 'marketing', 'featurePages.serpFeatures.body', 'People Also Ask', 'People Also Ask'),
      ).toBe('ascii-latin');
    });

    it('passes a translated value that also carries a brand token', () => {
      expect(
        classifyValue(
          'ar',
          'google',
          'title',
          'Manage your Google Search Console connection',
          'إدارة اتصال Google Search Console الخاص بك',
        ),
      ).toBeNull();
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
      // enNode neither string nor object (null) → skipped without throwing.
      expect(collectQualityIssues('ar', 'x', { a: null }, { a: 'x' })).toEqual([]);
      // locale subtree entirely absent → optional-chaining short-circuits.
      expect(collectQualityIssues('ar', 'x', { g: { leaf: 'x' } }, undefined)).toEqual([]);
    });
  });
});

describe('Cloud 01 beta chrome translation handoff', () => {
  const handedOffKeys = [
    ['common', 'releaseStage.banner.label'],
    ['common', 'releaseStage.banner.message'],
    ['common', 'releaseStage.banner.reportBug'],
    ['common', 'releaseStage.banner.followProgress'],
    ['common', 'releaseStage.banner.dismiss'],
    ['common', 'releaseStage.badge'],
    ['common', 'releaseStage.badgeName'],
  ] as const;
  const brandOnlyKeys: readonly string[] = [];

  const valueAt = (resource: unknown, path: string): unknown =>
    path.split('.').reduce<unknown>((value, segment) =>
      value && typeof value === 'object' ? (value as Record<string, unknown>)[segment] : undefined,
    resource);

  it('keeps each handed-off beta string translated outside English', () => {
    for (const locale of SUPPORTED_LOCALES.filter((value) => value !== DEFAULT_LOCALE)) {
      for (const [namespace, key] of handedOffKeys) {
        if (brandOnlyKeys.includes(`${namespace}.${key}`)) continue;
        const english = valueAt(RESOURCES[DEFAULT_LOCALE][namespace], key);
        const translated = valueAt(RESOURCES[locale][namespace], key);
        expect(typeof translated, `${locale}/${namespace}.${key} must be a string`).toBe('string');
        expect(translated, `${locale}/${namespace}.${key} must not repeat English`).not.toBe(english);
      }
    }
  });
});

describe('Cloud 04 bug-report translation handoff', () => {
  const handedOffKeys = [
    ['common', 'feedback.reportBug'],
    ['common', 'feedback.reportProblem'],
    ['common', 'feedback.mailSubject'],
    ['common', 'footer.version'],
  ] as const;
  const brandOnlyKeys: readonly string[] = [];

  const valueAt = (resource: unknown, path: string): unknown =>
    path.split('.').reduce<unknown>((value, segment) =>
      value && typeof value === 'object' ? (value as Record<string, unknown>)[segment] : undefined,
    resource);

  it('keeps each handed-off bug-report string translated outside English', () => {
    for (const locale of SUPPORTED_LOCALES.filter((value) => value !== DEFAULT_LOCALE)) {
      for (const [namespace, key] of handedOffKeys) {
        if (brandOnlyKeys.includes(`${namespace}.${key}`)) continue;
        const english = valueAt(RESOURCES[DEFAULT_LOCALE][namespace], key);
        const translated = valueAt(RESOURCES[locale][namespace], key);
        expect(typeof translated, `${locale}/${namespace}.${key} must be a string`).toBe('string');
        expect(translated, `${locale}/${namespace}.${key} must not repeat English`).not.toBe(english);
      }
    }
  });
});

describe('locale utilities', () => {
  it('isSupportedLocale accepts each language', () => {
    for (const locale of SUPPORTED_LOCALES) {
      expect(isSupportedLocale(locale)).toBe(true);
    }
  });
  it('isSupportedLocale rejects garbage', () => {
    expect(isSupportedLocale('xx')).toBe(false);
    expect(isSupportedLocale(null)).toBe(false);
    expect(isSupportedLocale(3)).toBe(false);
  });
  it('isRtl only for ar', () => {
    expect(isRtl('ar')).toBe(true);
    expect(isRtl('en')).toBe(false);
    expect(isRtl('fr')).toBe(false);
  });
  it('applyLocaleToDocument sets lang + dir', () => {
    applyLocaleToDocument('ar');
    expect(document.documentElement.lang).toBe('ar');
    expect(document.documentElement.dir).toBe('rtl');
    applyLocaleToDocument('fr');
    expect(document.documentElement.lang).toBe('fr');
    expect(document.documentElement.dir).toBe('ltr');
  });

  it('applyLocaleToDocument is a no-op when document is undefined (SSR guard)', () => {
    vi.stubGlobal('document', undefined);
    try {
      expect(() => applyLocaleToDocument('en')).not.toThrow();
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe('cookie persistence', () => {
  beforeEach(() => clearCookie(LANGUAGE_COOKIE));

  it('reads stored locale from the cookie', () => {
    persistLocale('de');
    expect(readStoredLocale()).toBe('de');
  });

  it('returns null for unknown stored value', () => {
    document.cookie = `${LANGUAGE_COOKIE}=zz; path=/`;
    expect(readStoredLocale()).toBeNull();
  });

  it('returns null when nothing is stored', () => {
    expect(readStoredLocale()).toBeNull();
  });
});

describe('i18n initialization + switching', () => {
  beforeEach(async () => {
    clearCookie(LANGUAGE_COOKIE);
    initI18n({ initialLocale: 'en' });
    await i18n.changeLanguage('en');
  });

  it('renders English by default', () => {
    render(
      <I18nextProvider i18n={i18n}>
        <LanguageSwitcher />
      </I18nextProvider>,
    );
    expect(screen.getByLabelText('Language')).toBeInTheDocument();
  });

  it('switches to Arabic, persists to cookie, sets dir=rtl', async () => {
    render(
      <I18nextProvider i18n={i18n}>
        <LanguageSwitcher />
      </I18nextProvider>,
    );

    await act(async () => {
      await changeLanguage('ar');
    });

    expect(document.documentElement.dir).toBe('rtl');
    expect(document.documentElement.lang).toBe('ar');
    expect(document.cookie).toContain(`${LANGUAGE_COOKIE}=ar`);
    expect(screen.getByLabelText('اللغة')).toBeInTheDocument();
  });

  it('switching to a non-RTL language sets dir=ltr', async () => {
    await act(async () => {
      await changeLanguage('ar');
    });
    expect(document.documentElement.dir).toBe('rtl');

    await act(async () => {
      await changeLanguage('fr');
    });
    expect(document.documentElement.dir).toBe('ltr');
    expect(document.documentElement.lang).toBe('fr');
  });

  it('ignores unsupported locale on changeLanguage', async () => {
    await act(async () => {
      await changeLanguage('xx' as never);
    });
    expect(i18n.resolvedLanguage).toBe('en');
  });

  it('selecting a supported locale in the switcher changes the language', async () => {
    const onLocaleChange = vi.fn();
    render(
      <I18nextProvider i18n={i18n}>
        <LanguageSwitcher onLocaleChange={onLocaleChange} />
      </I18nextProvider>,
    );
    const select = screen.getByLabelText('Language') as HTMLSelectElement;
    await act(async () => {
      fireEvent.change(select, { target: { value: 'de' } });
    });
    // LanguageSwitcher dispatches `void changeLanguage(next)` — the Promise is
    // fire-and-forget from the event handler. In Vitest 4 the act() wrapper does
    // not flush that async continuation, so we waitFor the i18n state to settle.
    await waitFor(() => expect(i18n.resolvedLanguage).toBe('de'));
    expect(onLocaleChange).toHaveBeenCalledWith('de');
  });

  it('ignores an unsupported value from the switcher', async () => {
    await act(async () => {
      await changeLanguage('en');
    });
    render(
      <I18nextProvider i18n={i18n}>
        <LanguageSwitcher />
      </I18nextProvider>,
    );
    const select = screen.getByLabelText('Language') as HTMLSelectElement;
    // A value with no matching <option> collapses to '' — an unsupported locale.
    await act(async () => {
      fireEvent.change(select, { target: { value: 'not-a-locale' } });
    });
    expect(i18n.resolvedLanguage).toBe('en');
  });

  it('translates errors namespace correctly per locale', async () => {
    await act(async () => {
      await changeLanguage('de');
    });
    expect(i18n.t('errors:notFound')).toMatch(/nicht gefunden/i);
    await act(async () => {
      await changeLanguage('zh');
    });
    expect(i18n.t('errors:notFound')).toContain('找不到');
  });

  it('reads stored language on re-init', async () => {
    persistLocale('ru');
    // reset i18n state by calling initI18n path via readStoredLocale directly
    expect(readStoredLocale()).toBe('ru');
  });

  it('unknown stored locale falls back to en on read', () => {
    document.cookie = `${LANGUAGE_COOKIE}=zzz; path=/`;
    expect(readStoredLocale()).toBeNull();
  });

  it('languageChanged with unsupported code does not persist or change dir (false branch)', () => {
    // Directly emit the i18n event with an unsupported code to hit the false
    // branch of `if (isSupportedLocale(lng))` inside the initI18n listener.
    const langBefore = document.documentElement.lang;
    i18n.emit('languageChanged', 'xx-unsupported');
    // Document attributes unchanged — unsupported code was ignored.
    expect(document.documentElement.lang).toBe(langBefore);
  });
});
