import type { LoaderFunctionArgs } from 'react-router-dom';
import { isDocsSlug } from '@shared/docs/docsUrl';
import { resolveMarketingRoute } from '@shared/i18n/localePath';
import {
  apiFetch,
  captureRequestLocale,
  isCurrentRequestLocale,
} from '@shared/api/client';
import { getPresentationLocaleSnapshot } from '@shared/i18n';
import type { SupportedLocale } from '@shared/i18n';
import type {
  DocsArticleData,
  DocsCatalog,
  DocsRequestContext,
  DocsSearchData,
} from './types';

function docsError(error: unknown): never {
  if (error instanceof Response) throw error;
  const name = error instanceof Error ? error.name : '';
  if (name === 'DocsNotFoundError') throw new Response(null, { status: 404 });
  throw new Response(null, { status: 500 });
}

async function fetchDocsData<T>(
  request: Request,
  path: string,
  locale: SupportedLocale,
): Promise<T> {
  const presentationGeneration = getPresentationLocaleSnapshot().generation;
  const requestLocale = captureRequestLocale({
    locale,
    presentationGeneration,
  });
  const response = await apiFetch(new URL(path, request.url).toString(), {
    localeMode: 'presentation',
    locale,
    presentationGeneration,
    workspace: 'omit',
    headers: { Accept: 'application/json' },
    signal: request.signal,
  });
  if (!response.ok) throw new Response(null, { status: response.status });
  const payload = (await response.json()) as T;
  if (!isCurrentRequestLocale(requestLocale)) {
    throw new DOMException('Presentation locale changed', 'AbortError');
  }
  return payload;
}

function localeFor(request: Request) {
  return resolveMarketingRoute(new URL(request.url).pathname).locale;
}

export async function docsCatalogLoader({ request, context }: LoaderFunctionArgs) {
  const locale = localeFor(request);
  const reader = (context as DocsRequestContext | undefined)?.docsReader;
  try {
    return reader
      ? reader.readCatalog(locale)
      : await fetchDocsData<DocsCatalog>(request, `/_docs-data/${locale}/catalog`, locale);
  } catch (error) {
    return docsError(error);
  }
}

export async function docsSearchLoader({ request, context }: LoaderFunctionArgs) {
  const locale = localeFor(request);
  const reader = (context as DocsRequestContext | undefined)?.docsReader;
  try {
    return reader
      ? reader.readSearch(locale)
      : await fetchDocsData<DocsSearchData>(request, `/_docs-data/${locale}/search`, locale);
  } catch (error) {
    return docsError(error);
  }
}

export async function docsArticleLoader({ request, params, context }: LoaderFunctionArgs) {
  const locale = localeFor(request);
  const slug = params.slug;
  if (!isDocsSlug(slug) || slug === 'index') {
    throw new Response(null, { status: 404 });
  }
  const reader = (context as DocsRequestContext | undefined)?.docsReader;
  try {
    return reader
      ? reader.readArticle(locale, slug)
      : await fetchDocsData<DocsArticleData>(request, `/_docs-data/${locale}/${slug}`, locale);
  } catch (error) {
    return docsError(error);
  }
}
