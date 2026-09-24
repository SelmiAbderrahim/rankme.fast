import { useState } from 'react';
import { Form, Link, NavLink, Outlet, useLoaderData, useLocation } from 'react-router-dom';
import { Menu, Search } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { docsUrl, isDocsSlug } from '@shared/docs/docsUrl';
import { cn } from '@shared/lib/utils';
import { Button } from '@shared/ui/button';
import { Input } from '@shared/ui/input';
import { ScrollArea } from '@shared/ui/scroll-area';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from '@shared/ui/sheet';
import type { DocsCatalog } from '../types';
import { DOC_SECTION_IDS } from '../types';

function DocsNavigation({ catalog, onNavigate }: { catalog: DocsCatalog; onNavigate?: () => void }) {
  const { t } = useTranslation('docs');
  const groups = DOC_SECTION_IDS.map((section) => ({
    section,
    docs: catalog.docs.filter((doc) => doc.section === section),
  })).filter((group) => group.docs.length > 0);

  return (
    <nav aria-label={t('navigationLabel')} className="space-y-6">
      {groups.map(({ section, docs }) => (
        <div key={section}>
          <h2 className="mb-2 text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            {t(`sections.${section}`)}
          </h2>
          <ul className="space-y-0.5">
            {docs.map((doc) => (
              <li key={doc.slug}>
                <NavLink
                  to={docsUrl(doc.slug, catalog.locale)}
                  onClick={onNavigate}
                  className={({ isActive }) => cn(
                    'block border-s-2 px-3 py-1.5 text-sm leading-snug transition-colors',
                    isActive
                      ? 'border-highlight bg-highlight/5 font-medium text-foreground'
                      : 'border-transparent text-muted-foreground hover:border-border hover:text-foreground',
                  )}
                >
                  {doc.title}
                </NavLink>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </nav>
  );
}

export const DocsLayout = () => {
  const catalog = useLoaderData() as DocsCatalog;
  const { t } = useTranslation('docs');
  const [open, setOpen] = useState(false);
  const location = useLocation();
  const activeSlug = location.pathname.split('/').filter(Boolean).at(-1);
  const pageTitle = activeSlug && isDocsSlug(activeSlug)
    ? catalog.docs.find((doc) => doc.slug === activeSlug)?.title
    : catalog.home.title;

  return (
    <div className="border-t bg-background">
      <div className="container mx-auto flex min-h-[calc(100dvh-3.5rem)] max-w-[1440px]">
        <aside className="hidden w-72 shrink-0 border-e px-5 py-8 lg:block">
          <Link to={docsUrl('index', catalog.locale)} className="mb-6 block font-serif text-2xl font-semibold">
            {t('title')}
          </Link>
          <Form action={docsUrl('index', catalog.locale)} className="relative mb-8">
            <Search className="pointer-events-none absolute start-3 top-2.5 size-4 text-muted-foreground" />
            <Input type="search" name="q" aria-label={t('searchLabel')} placeholder={t('searchPlaceholder')} className="ps-9" />
          </Form>
          <ScrollArea className="h-[calc(100dvh-14rem)] pe-3">
            <DocsNavigation catalog={catalog} />
          </ScrollArea>
        </aside>

        <div className="min-w-0 flex-1">
          <div className="sticky top-14 z-30 flex h-12 items-center gap-3 border-b bg-background/95 px-4 backdrop-blur lg:hidden">
            <Sheet open={open} onOpenChange={setOpen}>
              <SheetTrigger asChild>
                <Button variant="ghost" size="icon" aria-label={t('openNavigation')}>
                  <Menu className="size-5" />
                </Button>
              </SheetTrigger>
              <SheetContent side="left" className="w-[88vw] max-w-80">
                <SheetHeader>
                  <SheetTitle className="font-serif text-xl">{t('title')}</SheetTitle>
                </SheetHeader>
                <div className="px-4">
                  <Form action={docsUrl('index', catalog.locale)} className="relative mb-6" onSubmit={() => setOpen(false)}>
                    <Search className="pointer-events-none absolute start-3 top-2.5 size-4 text-muted-foreground" />
                    <Input type="search" name="q" aria-label={t('searchLabel')} placeholder={t('searchPlaceholder')} className="ps-9" />
                  </Form>
                  <ScrollArea className="h-[calc(100dvh-10rem)] pe-3">
                    <DocsNavigation catalog={catalog} onNavigate={() => setOpen(false)} />
                  </ScrollArea>
                </div>
              </SheetContent>
            </Sheet>
            <span className="truncate text-sm font-medium">{pageTitle}</span>
          </div>
          <Outlet context={catalog} />
        </div>
      </div>
    </div>
  );
};
