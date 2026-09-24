import { Form, Link, useLoaderData, useOutletContext, useSearchParams } from 'react-router-dom';
import { ArrowUpRight, Search } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { PageHeader } from '@shared/components/PageHeader';
import { docsUrl } from '@shared/docs/docsUrl';
import { APP_PAGE_ICONS } from '@shared/navigation/appPageIcons';
import { Seo, schema } from '@shared/seo';
import { Badge } from '@shared/ui/badge';
import { Button } from '@shared/ui/button';
import { Input } from '@shared/ui/input';
import { cn } from '@shared/lib/utils';
import { filterDocs } from '../search';
import { DOC_SECTION_IDS, type DocsCatalog, type DocsSearchData, type DocsSection } from '../types';

export const DocsHome = () => {
  const search = useLoaderData() as DocsSearchData;
  const catalog = useOutletContext<DocsCatalog>();
  const [params] = useSearchParams();
  const { t } = useTranslation('docs');
  const query = params.get('q') ?? '';
  const requestedSection = params.get('section');
  const section = DOC_SECTION_IDS.includes(requestedSection as DocsSection)
    ? requestedSection as DocsSection
    : undefined;
  const results = filterDocs(search.docs, query, section);
  const isFiltered = Boolean(query || section);
  const hrefFor = (nextSection?: DocsSection) => {
    const next = new URLSearchParams();
    if (query) next.set('q', query);
    if (nextSection) next.set('section', nextSection);
    const suffix = next.toString();
    return `${docsUrl('index', catalog.locale)}${suffix ? `?${suffix}` : ''}`;
  };
  const jsonLd = schema.graph(
    schema.breadcrumbList([{ name: t('breadcrumbs.home'), path: catalog.locale === 'en' ? '/' : `/${catalog.locale}` }, { name: catalog.home.title, path: docsUrl('index', catalog.locale) }]),
    schema.itemList(catalog.docs.map((doc) => ({ name: doc.title, path: docsUrl(doc.slug, catalog.locale) }))),
  );

  return (
    <>
      <Seo title={catalog.home.title} description={catalog.home.description} basePath="/docs" locale={catalog.locale} jsonLd={jsonLd} />
      <section className="dark overflow-hidden border-b bg-background px-5 py-14 text-foreground sm:px-8 sm:py-20">
        <div className="mx-auto max-w-4xl">
          <Badge className="mb-5 rounded-none border-foreground/20 bg-transparent text-foreground">{t('eyebrow')}</Badge>
          <PageHeader
            icon={APP_PAGE_ICONS.docs}
            title={catalog.home.title}
            titleProps={{ className: 'max-w-3xl font-serif text-4xl font-semibold leading-tight sm:text-6xl' }}
            description={catalog.home.description}
            descriptionClassName="mt-5 max-w-2xl text-base leading-7 sm:text-lg"
          />
          <Form role="search" className="relative mt-8 max-w-2xl">
            <Search className="pointer-events-none absolute start-4 top-3.5 size-5 text-muted-foreground" />
            <Input key={query} type="search" name="q" defaultValue={query} aria-label={t('searchLabel')} placeholder={t('searchPlaceholder')} className="h-12 border-border bg-card ps-12 text-card-foreground sm:pe-32 dark:bg-card" />
            {section ? <input type="hidden" name="section" value={section} /> : null}
            <Button type="submit" className="mt-2 h-9 w-full rounded-md sm:absolute sm:end-1.5 sm:top-1.5 sm:mt-0 sm:w-auto">{t('searchAction')}</Button>
          </Form>
        </div>
      </section>

      <div className="mx-auto max-w-6xl px-5 py-10 sm:px-8 sm:py-14">
        <nav aria-label={t('filterLabel')} className="mb-9 flex flex-wrap gap-2">
          <Link to={hrefFor()} className={cn('border px-3 py-1.5 text-sm transition-colors', !section ? 'border-highlight bg-highlight/10 text-foreground' : 'hover:bg-muted')}>{t('allSections')}</Link>
          {DOC_SECTION_IDS.map((id) => (
            <Link key={id} to={hrefFor(id)} className={cn('border px-3 py-1.5 text-sm transition-colors', section === id ? 'border-highlight bg-highlight/10 text-foreground' : 'hover:bg-muted')}>{t(`sections.${id}`)}</Link>
          ))}
        </nav>

        {isFiltered ? (
          <div>
            <p className="mb-6 text-sm text-muted-foreground">{t('resultCount', { count: results.length })}</p>
            {results.length ? (
              <div className="grid gap-px border bg-border md:grid-cols-2">
                {results.map((doc) => (
                  <Link key={doc.slug} to={docsUrl(doc.slug, catalog.locale)} className="group bg-background p-6 transition-colors hover:bg-muted/60">
                    <span className="text-xs font-semibold uppercase tracking-wide text-highlight">{t(`sections.${doc.section}`)}</span>
                    <h2 className="mt-2 font-serif text-2xl font-semibold group-hover:underline">{doc.title}</h2>
                    <p className="mt-2 text-sm leading-6 text-muted-foreground">{doc.description}</p>
                  </Link>
                ))}
              </div>
            ) : (
              <div className="border border-dashed p-10 text-center">
                <h2 className="font-serif text-2xl font-semibold">{t('noResultsTitle')}</h2>
                <p className="mt-2 text-muted-foreground">{t('noResultsBody')}</p>
                <Button asChild variant="outline" className="mt-5"><Link to={docsUrl('index', catalog.locale)}>{t('clearFilters')}</Link></Button>
              </div>
            )}
          </div>
        ) : (
          <div className="space-y-12">
            {DOC_SECTION_IDS.map((id) => {
              const docs = catalog.docs.filter((doc) => doc.section === id);
              if (!docs.length) return null;
              return (
                <section key={id} aria-labelledby={`section-${id}`}>
                  <div className="mb-4 flex flex-col items-start justify-between gap-2 border-b pb-3 sm:flex-row sm:items-end sm:gap-4">
                    <h2 id={`section-${id}`} className="font-serif text-3xl font-semibold">{t(`sections.${id}`)}</h2>
                    <Link to={hrefFor(id)} className="text-sm text-muted-foreground hover:text-foreground">{t('viewSection')}</Link>
                  </div>
                  <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                    {docs.map((doc) => (
                      <Link key={doc.slug} to={docsUrl(doc.slug, catalog.locale)} className="group flex min-h-40 flex-col border bg-card p-5 transition-colors hover:border-foreground/40">
                        <h3 className="font-serif text-xl font-semibold">{doc.title}</h3>
                        <p className="mt-2 flex-1 text-sm leading-6 text-muted-foreground">{doc.description}</p>
                        <span className="mt-4 inline-flex items-center gap-1 text-sm font-medium">{t('readGuide')}<ArrowUpRight className="size-4" /></span>
                      </Link>
                    ))}
                  </div>
                </section>
              );
            })}
          </div>
        )}
      </div>
    </>
  );
};
