import { useEffect, useRef } from 'react';
import { Link, useLoaderData, useOutletContext } from 'react-router-dom';
import { ArrowLeft, ArrowRight, ChevronDown, Copy, FileCode2, FileText, Link2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { PageHeader } from '@shared/components/PageHeader';
import { docsUrl } from '@shared/docs/docsUrl';
import { APP_PAGE_ICONS } from '@shared/navigation/appPageIcons';
import { Seo, schema } from '@shared/seo';
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from '@shared/ui/breadcrumb';
import { Button } from '@shared/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from '@shared/ui/dropdown-menu';
import type { DocsArticleData, DocsCatalog } from '../types';
import { tableOfContents } from '../markdown';
import { MarkdownContent } from './MarkdownContent';

export const DocsArticle = () => {
  const { doc } = useLoaderData() as DocsArticleData;
  const catalog = useOutletContext<DocsCatalog>();
  const { t } = useTranslation('docs');
  const headingRef = useRef<HTMLHeadingElement>(null);
  const articleBodyRef = useRef<HTMLDivElement>(null);
  const toc = tableOfContents(doc.body);
  const index = catalog.docs.findIndex((item) => item.slug === doc.slug);
  const previous = index > 0 ? catalog.docs[index - 1] : undefined;
  const next = index >= 0 ? catalog.docs[index + 1] : undefined;
  const homePath = catalog.locale === 'en' ? '/' : `/${catalog.locale}`;
  const articlePath = docsUrl(doc.slug, catalog.locale);

  useEffect(() => {
    headingRef.current?.focus();
  }, [doc.slug]);

  const copyToClipboard = async (value: string, format: string) => {
    try {
      await navigator.clipboard.writeText(value);
      toast.success(t('copy.success', { format }));
    } catch {
      toast.error(t('copy.failed'));
    }
  };

  const jsonLd = schema.graph(
    schema.article({ headline: doc.title, description: doc.description, path: articlePath, language: catalog.locale }),
    schema.breadcrumbList([
      { name: t('breadcrumbs.home'), path: homePath },
      { name: t('breadcrumbs.docs'), path: docsUrl('index', catalog.locale) },
      { name: doc.title, path: articlePath },
    ]),
  );

  return (
    <>
      <Seo title={doc.title} description={doc.description} basePath={`/docs/${doc.slug}`} locale={catalog.locale} type="article" jsonLd={jsonLd} />
      <div className="mx-auto grid max-w-6xl gap-12 px-5 py-9 sm:px-8 lg:grid-cols-[minmax(0,1fr)_220px] lg:py-14">
        <article className="min-w-0 max-w-3xl">
          <Breadcrumb className="mb-8">
            <BreadcrumbList>
              <BreadcrumbItem><BreadcrumbLink asChild><Link to={homePath}>{t('breadcrumbs.home')}</Link></BreadcrumbLink></BreadcrumbItem>
              <BreadcrumbSeparator />
              <BreadcrumbItem><BreadcrumbLink asChild><Link to={docsUrl('index', catalog.locale)}>{t('breadcrumbs.docs')}</Link></BreadcrumbLink></BreadcrumbItem>
              <BreadcrumbSeparator />
              <BreadcrumbItem><BreadcrumbPage>{doc.title}</BreadcrumbPage></BreadcrumbItem>
            </BreadcrumbList>
          </Breadcrumb>
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-highlight">{t(`sections.${doc.section}`)}</p>
          <PageHeader
            className="mt-3"
            icon={APP_PAGE_ICONS.docsArticle}
            title={doc.title}
            titleRef={headingRef}
            titleProps={{
              className: 'font-serif text-4xl font-semibold leading-tight outline-none sm:text-5xl',
              tabIndex: -1,
            }}
            actions={<DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm" className="shrink-0">
                  <Copy data-icon="inline-start" aria-hidden="true" />
                  {t('copy.trigger')}
                  <ChevronDown data-icon="inline-end" aria-hidden="true" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-52">
                <DropdownMenuLabel>{t('copy.label')}</DropdownMenuLabel>
                <DropdownMenuGroup>
                  <DropdownMenuItem onSelect={() => void copyToClipboard(doc.body, t('copy.markdown'))}>
                    <FileCode2 aria-hidden="true" />
                    {t('copy.markdown')}
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onSelect={() => void copyToClipboard(
                      [doc.title, doc.description, articleBodyRef.current!.innerText].join('\n\n'),
                      t('copy.plainText'),
                    )}
                  >
                    <FileText aria-hidden="true" />
                    {t('copy.plainText')}
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onSelect={() => void copyToClipboard(
                      new URL(articlePath, window.location.origin).href,
                      t('copy.link'),
                    )}
                  >
                    <Link2 aria-hidden="true" />
                    {t('copy.link')}
                  </DropdownMenuItem>
                </DropdownMenuGroup>
              </DropdownMenuContent>
            </DropdownMenu>}
          />
          <p className="mt-5 border-b pb-8 text-lg leading-8 text-muted-foreground">{doc.description}</p>
          <div ref={articleBodyRef} className="mt-9"><MarkdownContent body={doc.body} locale={catalog.locale} /></div>

          <nav aria-label={t('articleNavigation')} className="mt-14 grid gap-3 border-t pt-7 sm:grid-cols-2">
            {previous ? (
              <Link to={docsUrl(previous.slug, catalog.locale)} className="group border p-4 hover:bg-muted/60">
                <span className="flex items-center gap-2 text-xs uppercase tracking-wide text-muted-foreground"><ArrowLeft className="size-4 rtl:rotate-180" />{t('previous')}</span>
                <span className="mt-2 block font-serif text-lg font-semibold">{previous.title}</span>
              </Link>
            ) : <span />}
            {next ? (
              <Link to={docsUrl(next.slug, catalog.locale)} className="group border p-4 text-end hover:bg-muted/60">
                <span className="flex items-center justify-end gap-2 text-xs uppercase tracking-wide text-muted-foreground">{t('next')}<ArrowRight className="size-4 rtl:rotate-180" /></span>
                <span className="mt-2 block font-serif text-lg font-semibold">{next.title}</span>
              </Link>
            ) : null}
          </nav>
        </article>

        {toc.length ? (
          <aside className="hidden lg:block">
            <nav aria-label={t('onThisPage')} className="sticky top-24 border-s ps-5">
              <h2 className="mb-3 text-xs font-semibold uppercase tracking-[0.14em]">{t('onThisPage')}</h2>
              <ul className="space-y-2 text-sm text-muted-foreground">
                {toc.map((item) => <li key={`${item.id}-${item.label}`} className={item.level === 3 ? 'ps-3' : undefined}><a href={`#${item.id}`} className="transition-colors hover:text-foreground">{item.label}</a></li>)}
              </ul>
            </nav>
          </aside>
        ) : null}
      </div>
    </>
  );
};
