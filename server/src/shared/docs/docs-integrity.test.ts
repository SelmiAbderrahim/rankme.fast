/**
 * Docs integrity — prompt 20.
 *
 * Guards the public /docs surface: every slug ships in every locale, each
 * markdown file has valid frontmatter with matching `locale`/`slug`, every
 * relative link inside a page resolves to an existing same-locale sibling,
 * and the docs generator stays idempotent.
 *
 * Not part of the runtime bundle — a pure Vitest suite over the /docs
 * folder on disk.
 */
import { execFileSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import yaml from 'js-yaml';
import { describe, expect, it } from 'vitest';

const REPO_ROOT = resolve(__dirname, '..', '..', '..', '..');
const DOCS_DIR = resolve(REPO_ROOT, 'docs');

const LOCALES = ['en', 'ar', 'fr', 'de', 'es', 'ru', 'zh'] as const;
type Locale = (typeof LOCALES)[number];

const SLUGS = [
  'index',
  'getting-started',
  'self-hosting',
  'beta',
  'audit-report',
  'rank-tracking',
  'page-speed',
  'google-search-console',
  'pages-performance',
  'keyword-research',
  'backlinks-competitors',
  'plans-limits-credits',
  'ai-summary',
  'content-intelligence',
  'rankmefast-mcp',
  'ai-assistant',
  'settings-security',
  'troubleshooting',
  'ai-visibility',
  'local-seo',
  'pricing',
  'notification-preferences',
  'team',
  'enterprise',
  'public-api',
  'looker-studio',
  'weekly-pulse',
  'gsc-generative-appearance',
  'confirmed-rank-alerts',
  'next-actions',
  'ai-visibility-citations',
  'audience-research',
  'keyword-intelligence',
  'link-intelligence',
  'traffic-insights',
  'keyword-trends',
  'review-intelligence',
  'brand-radar',
  // rankme-community-requests — spec 13 §8 (+ §15: keyword-clustering).
  'serp-features',
  'keyword-clustering',
  'alt-engine-tracking',
  'cannibalization',
  'toxic-links',
  'alerts',
  'internal-linking',
  'content-briefs',
  'geogrid',
  'schema-markup',
  'client-reports',
  'report-exports',
  'app-seo',
  'changelog',
] as const;
type Slug = (typeof SLUGS)[number];

const COMMUNITY_REQUEST_SLUGS = [
  'serp-features',
  'keyword-clustering',
  'alt-engine-tracking',
  'cannibalization',
  'toxic-links',
  'alerts',
  'internal-linking',
  'content-briefs',
  'geogrid',
  'schema-markup',
  'client-reports',
] as const satisfies readonly Slug[];

const SECTIONS = [
  'start',
  'audits',
  'research',
  'product',
  'account',
  'developers',
] as const;
type Section = (typeof SECTIONS)[number];

const PLACEMENT: Record<Slug, readonly [Section, number]> = {
  index: ['start', 0],
  'getting-started': ['start', 1],
  'self-hosting': ['start', 5],
  beta: ['start', 6],
  'audit-report': ['start', 2],
  troubleshooting: ['start', 3],
  changelog: ['start', 4],
  'page-speed': ['audits', 1],
  'ai-summary': ['audits', 2],
  'content-intelligence': ['audits', 3],
  'ai-visibility': ['audits', 4],
  'local-seo': ['audits', 5],
  'backlinks-competitors': ['audits', 6],
  'weekly-pulse': ['audits', 7],
  'confirmed-rank-alerts': ['audits', 8],
  'next-actions': ['audits', 9],
  'ai-visibility-citations': ['audits', 10],
  'rank-tracking': ['research', 1],
  'keyword-research': ['research', 2],
  'google-search-console': ['research', 3],
  'pages-performance': ['research', 13],
  'gsc-generative-appearance': ['research', 4],
  'audience-research': ['research', 5],
  'keyword-intelligence': ['research', 6],
  'link-intelligence': ['research', 7],
  'traffic-insights': ['research', 8],
  'keyword-trends': ['research', 9],
  'review-intelligence': ['research', 10],
  'brand-radar': ['research', 11],
  'serp-features': ['product', 1],
  'keyword-clustering': ['product', 2],
  'alt-engine-tracking': ['product', 3],
  cannibalization: ['product', 4],
  'toxic-links': ['product', 5],
  alerts: ['product', 6],
  'internal-linking': ['product', 7],
  'content-briefs': ['product', 8],
  geogrid: ['product', 9],
  'schema-markup': ['product', 10],
  'client-reports': ['product', 11],
  'report-exports': ['product', 12],
  'app-seo': ['product', 13],
  pricing: ['account', 1],
  'plans-limits-credits': ['account', 2],
  'settings-security': ['account', 3],
  'notification-preferences': ['account', 4],
  team: ['account', 5],
  enterprise: ['account', 6],
  'public-api': ['developers', 1],
  'rankmefast-mcp': ['developers', 2],
  'ai-assistant': ['developers', 3],
  'looker-studio': ['developers', 4],
};

interface Frontmatter {
  title: string;
  description: string;
  locale: Locale;
  slug: Slug;
  section: Section;
  order: number;
}

const FRONTMATTER_KEYS = [
  'title',
  'description',
  'locale',
  'slug',
  'section',
  'order',
] as const;

const HONESTY_COPY: Record<
  Locale,
  {
    toxicLinks: string;
    alertsConstraint: string;
    alertsCurrent: string;
    schemaGuarantee: string;
  }
> = {
  en: {
    toxicLinks: 'for your own review and submission to Google',
    alertsConstraint: 'the shipped rank pipeline does not yet produce',
    alertsCurrent: 'Backlink change alerts are the channel that fires today',
    schemaGuarantee: 'never a guarantee that Google will show a rich result',
  },
  ar: {
    toxicLinks: 'لمراجعتك أنت وإرساله بنفسك إلى Google',
    alertsConstraint: 'لا ينتجها خط أنابيب الترتيب المشحون بعد',
    alertsCurrent: 'فتنبيهات تغيّر الروابط هي القناة التي تُطلَق اليوم',
    schemaGuarantee: 'ليست أبداً ضماناً بأن Google ستعرض نتيجة منسّقة',
  },
  fr: {
    toxicLinks: 'pour votre propre relecture et votre soumission à Google',
    alertsConstraint: 'le pipeline de position livré ne produit pas encore',
    alertsCurrent: "Les alertes de changement de liens sont le canal qui fonctionne aujourd'hui",
    schemaGuarantee: "Ce n'est jamais une garantie que Google affichera un résultat enrichi",
  },
  de: {
    toxicLinks: 'zu Ihrer eigenen Prüfung und Einreichung bei Google',
    alertsConstraint: 'die die ausgelieferte Rankingpipeline noch nicht erzeugt',
    alertsCurrent: 'Backlink-Änderungen sind der Kanal, der heute auslöst',
    schemaGuarantee: 'nie eine Garantie, dass Google ein Rich Result anzeigt',
  },
  es: {
    toxicLinks: 'para tu propia revisión y envío a Google',
    alertsConstraint: 'el pipeline de posiciones publicado todavía no produce',
    alertsCurrent: 'Las alertas de cambios de enlaces son el canal que funciona hoy',
    schemaGuarantee: 'Nunca es una garantía de que Google muestre un resultado enriquecido',
  },
  ru: {
    toxicLinks: 'для вашей собственной проверки и отправки в Google',
    alertsConstraint: 'поставляемый конвейер позиций пока не производит',
    alertsCurrent: 'Сегодня срабатывает канал изменений ссылочного профиля',
    schemaGuarantee: 'никогда не гарантия того, что Google покажет расширенный результат',
  },
  zh: {
    toxicLinks: '供你自行复核并自行提交给 Google',
    alertsConstraint: '当前交付的排名流水线尚未产出此类观测',
    alertsCurrent: '今天真正会触发的是外链变化提醒',
    schemaGuarantee: '绝不是 Google 会展示富媒体结果的保证',
  },
};

const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;
const LINK_RE = /\[[^\]]*\]\(\.\/([^)#]+?)\)/g;

function readDoc(slug: Slug, locale: Locale): string {
  return readFileSync(resolve(DOCS_DIR, `${slug}.${locale}.md`), 'utf8');
}

function parseFrontmatter(source: string): { fm: Frontmatter; body: string } {
  const match = source.match(FRONTMATTER_RE);
  if (!match) throw new Error('missing frontmatter');
  const fm = yaml.load(match[1] ?? '') as Frontmatter;
  return { fm, body: source.slice(match[0].length) };
}

describe('docs integrity — every slug × locale exists', () => {
  it.each(SLUGS)('slug %s ships in all 7 locales', (slug) => {
    for (const locale of LOCALES) {
      expect(() => readDoc(slug, locale)).not.toThrow();
    }
  });

  it('contains exactly the localized slug variants — operator material lives in ops/', () => {
    const files = readdirSync(DOCS_DIR).filter((f) => /\.[a-z]{2}\.md$/.test(f));
    const expected = SLUGS.flatMap((slug) =>
      LOCALES.map((locale) => `${slug}.${locale}.md`),
    );
    expect(files.sort()).toEqual(expected.sort());
  });
});

describe('docs integrity — frontmatter', () => {
  for (const slug of SLUGS) {
    for (const locale of LOCALES) {
      it(`${slug}.${locale}.md has valid frontmatter with matching locale/slug`, () => {
        const { fm } = parseFrontmatter(readDoc(slug, locale));
        expect(fm.title, 'title').toBeTypeOf('string');
        expect(fm.title.length, 'title non-empty').toBeGreaterThan(0);
        expect(fm.description, 'description').toBeTypeOf('string');
        expect(fm.description.length, 'description non-empty').toBeGreaterThan(0);
        expect(fm.locale).toBe(locale);
        expect(fm.slug).toBe(slug);
        expect(SECTIONS).toContain(fm.section);
        expect([fm.section, fm.order]).toEqual(PLACEMENT[slug]);
      });
    }
  }
});

describe('docs integrity — community-request guide shape and truth', () => {
  for (const slug of COMMUNITY_REQUEST_SLUGS) {
    it(`${slug}: all seven siblings keep frontmatter parity, one truth marker, and 44–47 lines`, () => {
      let englishTruthMarker: string | undefined;
      for (const locale of LOCALES) {
        const source = readDoc(slug, locale);
        const lineCount = source.trimEnd().split(/\r?\n/).length;
        expect(lineCount, `${slug}.${locale}.md line shape`).toBeGreaterThanOrEqual(44);
        expect(lineCount, `${slug}.${locale}.md line shape`).toBeLessThanOrEqual(47);

        const { fm, body } = parseFrontmatter(source);
        expect(Object.keys(fm), `${slug}.${locale}.md frontmatter keys`).toEqual(FRONTMATTER_KEYS);
        const truthMarkers = body.match(/<!-- docs-truth: [^\n]+ -->/g) ?? [];
        expect(truthMarkers, `${slug}.${locale}.md truth marker`).toHaveLength(1);
        if (locale === 'en') englishTruthMarker = truthMarkers[0];
        expect(truthMarkers[0], `${slug}.${locale}.md truth parity`).toBe(englishTruthMarker);
      }
    });
  }

  it.each(LOCALES)('%s pins disavow, alert, and schema honesty copy', (locale) => {
    const copy = HONESTY_COPY[locale];
    expect(readDoc('toxic-links', locale)).toContain(copy.toxicLinks);
    const alerts = readDoc('alerts', locale);
    expect(alerts).toContain(copy.alertsConstraint);
    expect(alerts).toContain(copy.alertsCurrent);
    expect(readDoc('schema-markup', locale)).toContain(copy.schemaGuarantee);
  });

  it('the docs generator preserves every public index section', () => {
    const source = readFileSync(resolve(REPO_ROOT, 'scripts', 'gen-docs.mjs'), 'utf8');
    const match = source.match(/const SECTION_IDS = \[([\s\S]*?)\];/);
    expect(match, 'SECTION_IDS declaration').not.toBeNull();
    const sectionIds = [...(match?.[1] ?? '').matchAll(/'([a-z]+)'/g)].map((entry) => entry[1]);
    expect(sectionIds).toEqual(SECTIONS);
  });
});

describe('docs integrity — every locale contains translated content', () => {
  for (const slug of SLUGS) {
    it(`${slug}: localized metadata and bodies do not silently fall back to English`, () => {
      const english = parseFrontmatter(readDoc(slug, 'en'));
      for (const locale of LOCALES.filter((value) => value !== 'en')) {
        const localized = parseFrontmatter(readDoc(slug, locale));
        expect(localized.body.trim()).not.toBe(english.body.trim());
        expect(localized.fm.description).not.toBe(english.fm.description);
        if (slug !== 'content-intelligence' && slug !== 'rankmefast-mcp') {
          expect(localized.fm.title).not.toBe(english.fm.title);
        }
      }
    });
  }
});

describe('docs integrity — internal links resolve to same-locale siblings', () => {
  for (const locale of LOCALES) {
    it(`${locale}: every ./<slug>.<locale>.md link points at an existing file`, () => {
      for (const slug of SLUGS) {
        const source = readDoc(slug, locale);
        const seen: string[] = [];
        for (const match of source.matchAll(LINK_RE)) {
          const target = match[1] as string;
          if (!target.endsWith('.md')) continue;
          seen.push(target);
          // Same-locale rule: target's locale slug must match the current locale.
          const parts = target.split('.');
          const targetLocale = parts.length >= 3 ? parts[parts.length - 2] : '';
          expect(targetLocale, `${slug}.${locale}.md → ${target}`).toBe(locale);
          // Target file must exist.
          expect(() => readFileSync(resolve(DOCS_DIR, target), 'utf8')).not.toThrow();
        }
        // Index page must link to every other slug at least once.
        if (slug === 'index') {
          for (const s of SLUGS) {
            if (s === 'index') continue;
            expect(seen).toContain(`${s}.${locale}.md`);
          }
        }
      }
    });
  }
});

describe('docs generator', () => {
  it('is idempotent and cannot overwrite newer hand-maintained guides', () => {
    const scratch = mkdtempSync(join(tmpdir(), 'rankme-docgen-'));
    try {
      const scratchScripts = resolve(scratch, 'scripts');
      const scratchDocs = resolve(scratch, 'docs');
      const scratchLocales = resolve(scratch, 'client/src/shared/i18n/locales');
      mkdirSync(scratchScripts, { recursive: true });
      mkdirSync(scratchLocales, { recursive: true });
      cpSync(resolve(REPO_ROOT, 'scripts/gen-docs.mjs'), resolve(scratchScripts, 'gen-docs.mjs'));
      cpSync(DOCS_DIR, scratchDocs, { recursive: true });
      for (const locale of LOCALES) {
        const target = resolve(scratchLocales, locale);
        mkdirSync(target, { recursive: true });
        cpSync(
          resolve(REPO_ROOT, 'client/src/shared/i18n/locales', locale, 'docs.json'),
          resolve(target, 'docs.json'),
        );
      }

      execFileSync(process.execPath, [resolve(scratchScripts, 'gen-docs.mjs')], {
        cwd: scratch,
        stdio: 'pipe',
      });

      const files = readdirSync(DOCS_DIR).sort();
      expect(readdirSync(scratchDocs).sort()).toEqual(files);
      for (const file of files) {
        expect(readFileSync(resolve(scratchDocs, file)), file).toEqual(
          readFileSync(resolve(DOCS_DIR, file)),
        );
      }
    } finally {
      rmSync(scratch, { recursive: true, force: true });
    }
  });
});

describe('docs integrity — Prompt 12 feature navigation', () => {
  const featureSlugs = [
    'link-intelligence',
    'traffic-insights',
    'keyword-trends',
    'review-intelligence',
    'brand-radar',
  ] as const satisfies readonly Slug[];

  for (const locale of LOCALES) {
    it(`${locale}: every feature guide links back to the docs index`, () => {
      for (const slug of featureSlugs) {
        expect(readDoc(slug, locale), `${slug} index link`).toContain(`./index.${locale}.md`);
      }
    });

    it(`${locale}: the changelog links every Prompt 12 guide`, () => {
      const changelog = readDoc('changelog', locale);
      for (const slug of featureSlugs) {
        expect(changelog, `changelog → ${slug}`).toContain(`./${slug}.${locale}.md`);
      }
    });
  }
});

