/**
 * DocsLink — inline "Learn more" link into the /docs surface.
 *
 * Small, subdued anchor. Deliberately not a Button — help pointers are
 * secondary UI.
 */
import { useTranslation } from 'react-i18next';
import { docsUrl, type DocsSlug } from './docsUrl';

export interface DocsLinkProps {
  slug: DocsSlug;
  /** Override the default "Learn more →" label with a specific i18n key. */
  labelKey?: string;
  className?: string;
  /** data-testid override for the anchoring screen's assertions. */
  testId?: string;
}

export const DocsLink = ({
  slug,
  labelKey = 'docsLink.learnMore',
  className,
  testId,
}: DocsLinkProps) => {
  const { t, i18n } = useTranslation('common');
  const href = docsUrl(slug, i18n.language);
  return (
    <a
      href={href}
      className={
        className ??
        'text-muted-foreground hover:text-foreground text-xs underline underline-offset-2'
      }
      data-testid={testId ?? `docs-link-${slug}`}
    >
      {t(labelKey)}
    </a>
  );
};
