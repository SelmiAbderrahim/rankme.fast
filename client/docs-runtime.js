import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import matter from 'gray-matter';

const DOC_LOCALES = ['en', 'ar', 'fr', 'de', 'es', 'ru', 'zh'];
const DOC_SECTIONS = [
  'start',
  'audits',
  'research',
  'product',
  'account',
  'developers',
];
const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

class DocsNotFoundError extends Error {
  constructor(message = 'Documentation page not found') {
    super(message);
    this.name = 'DocsNotFoundError';
  }
}

class DocsContentError extends Error {
  constructor(message) {
    super(message);
    this.name = 'DocsContentError';
  }
}

function assertLocale(locale) {
  if (!DOC_LOCALES.includes(locale)) throw new DocsNotFoundError();
}

function assertSlug(slug) {
  if (!SLUG_RE.test(slug)) throw new DocsNotFoundError();
}

function sourcePath(docsDir, slug, locale) {
  assertLocale(locale);
  assertSlug(slug);
  return path.resolve(docsDir, `${slug}.${locale}.md`);
}

function readSource(docsDir, slug, locale) {
  try {
    return readFileSync(sourcePath(docsDir, slug, locale), 'utf8');
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
      throw new DocsNotFoundError();
    }
    throw error;
  }
}

function parseDoc(source, expectedSlug, expectedLocale) {
  const parsed = matter(source);
  const data = parsed.data;
  const order = Number(data.order);
  const valid =
    typeof data.title === 'string' && data.title.trim().length > 0 &&
    typeof data.description === 'string' && data.description.trim().length > 0 &&
    data.locale === expectedLocale &&
    data.slug === expectedSlug &&
    typeof data.section === 'string' && DOC_SECTIONS.includes(data.section) &&
    Number.isInteger(order) && order >= 0;

  if (!valid) {
    throw new DocsContentError(`Invalid documentation frontmatter: ${expectedSlug}.${expectedLocale}.md`);
  }

  return {
    slug: expectedSlug,
    locale: expectedLocale,
    title: data.title.trim(),
    description: data.description.trim(),
    section: data.section,
    order,
    body: parsed.content.trim(),
  };
}

function readAllDocs(docsDir, locale) {
  assertLocale(locale);
  const suffix = `.${locale}.md`;
  const docs = readdirSync(docsDir)
    .filter((file) => file.endsWith(suffix))
    .map((file) => file.slice(0, -suffix.length))
    .filter((slug) => SLUG_RE.test(slug))
    .map((slug) => parseDoc(readSource(docsDir, slug, locale), slug, locale));

  const sectionIndex = new Map(DOC_SECTIONS.map((section, index) => [section, index]));
  docs.sort((a, b) => {
    const sectionDelta =
      (sectionIndex.get(a.section) ?? DOC_SECTIONS.length) -
      (sectionIndex.get(b.section) ?? DOC_SECTIONS.length);
    return sectionDelta || a.order - b.order || a.title.localeCompare(b.title, locale);
  });
  return docs;
}

function toMeta(doc) {
  return {
    slug: doc.slug,
    locale: doc.locale,
    title: doc.title,
    description: doc.description,
    section: doc.section,
    order: doc.order,
  };
}

function createDocsReader(docsDir) {
  const resolvedDocsDir = path.resolve(docsDir);
  return {
    readCatalog(locale) {
      const all = readAllDocs(resolvedDocsDir, locale);
      const home = all.find((doc) => doc.slug === 'index');
      if (!home) throw new DocsContentError(`Missing documentation index for ${locale}`);
      return {
        locale,
        home: toMeta(home),
        docs: all.filter((doc) => doc.slug !== 'index').map(toMeta),
      };
    },
    readSearch(locale) {
      return {
        locale,
        docs: readAllDocs(resolvedDocsDir, locale)
          .filter((doc) => doc.slug !== 'index')
          .map((doc) => ({ ...toMeta(doc), searchText: doc.body })),
      };
    },
    readArticle(locale, slug) {
      return { doc: parseDoc(readSource(resolvedDocsDir, slug, locale), slug, locale) };
    },
    readRaw(locale, slug) {
      return readSource(resolvedDocsDir, slug, locale);
    },
  };
}

function docsRoutePath(slug, locale) {
  assertLocale(locale);
  assertSlug(slug);
  const base = slug === 'index' ? '/docs' : `/docs/${slug}`;
  return locale === 'en' ? base : `/${locale}${base}`;
}

function explicitlyAcceptsMarkdown(accept = '') {
  return accept
    .split(',')
    .map((value) => value.trim().split(';')[0])
    .includes('text/markdown');
}

export {
  DOC_LOCALES,
  DOC_SECTIONS,
  DocsContentError,
  DocsNotFoundError,
  createDocsReader,
  docsRoutePath,
  explicitlyAcceptsMarkdown,
};
