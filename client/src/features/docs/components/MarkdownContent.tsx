import type { ComponentPropsWithoutRef } from 'react';
import { Link } from 'react-router-dom';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { ExternalLink } from 'lucide-react';
import { safeExternalHref } from '@shared/security';
import { docsUrl, isDocsSlug } from '@shared/docs/docsUrl';
import type { SupportedLocale } from '@shared/i18n';
import { headingId, markdownDocsSlug, nodeText } from '../markdown';
import { safeInternalHref } from '@shared/utils/internalHref';

export const MarkdownContent = ({ body, locale }: { body: string; locale: SupportedLocale }) => (
  <div className="docs-markdown max-w-none text-[1.02rem] leading-7 text-foreground">
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        h2: ({ children }) => <h2 id={headingId(nodeText(children))} className="scroll-mt-24 border-t pt-8 font-serif text-3xl font-semibold tracking-tight first:border-0 first:pt-0">{children}</h2>,
        h3: ({ children }) => <h3 id={headingId(nodeText(children))} className="scroll-mt-24 pt-3 font-serif text-2xl font-semibold tracking-tight">{children}</h3>,
        p: ({ children }) => <p className="my-5 text-foreground/85">{children}</p>,
        ul: ({ children }) => <ul className="my-5 list-disc space-y-2 ps-6 marker:text-highlight">{children}</ul>,
        ol: ({ children }) => <ol className="my-5 list-decimal space-y-2 ps-6 marker:font-semibold">{children}</ol>,
        blockquote: ({ children }) => <blockquote className="my-6 border-s-4 border-highlight bg-muted/60 px-5 py-1 text-muted-foreground">{children}</blockquote>,
        table: ({ children }) => <div className="my-6 overflow-x-auto border"><table className="w-full border-collapse text-sm">{children}</table></div>,
        th: ({ children }) => <th className="border-b bg-muted px-4 py-3 text-start font-semibold">{children}</th>,
        td: ({ children }) => <td className="border-b px-4 py-3 align-top">{children}</td>,
        pre: ({ children }) => <pre className="my-6 overflow-x-auto border bg-muted p-4 text-sm text-foreground">{children}</pre>,
        code: ({ className, children, ...props }: ComponentPropsWithoutRef<'code'>) => className ? <code className={className} {...props}>{children}</code> : <code className="border bg-muted px-1.5 py-0.5 text-[0.9em]" {...props}>{children}</code>,
        hr: () => <hr className="my-9 border-border" />,
        a: ({ href = '', children }) => {
          const slug = markdownDocsSlug(href);
          if (slug && isDocsSlug(slug)) return <Link className="font-medium text-highlight underline underline-offset-4" to={docsUrl(slug, locale)}>{children}</Link>;
          if (href.startsWith('/')) {
            const target = safeInternalHref(href);
            return target
              ? <Link className="font-medium text-highlight underline underline-offset-4" to={target}>{children}</Link>
              : <span>{children}</span>;
          }
          if (href.startsWith('#')) return <a className="font-medium text-highlight underline underline-offset-4" href={href}>{children}</a>;
          return <a className="inline-flex items-center gap-1 font-medium text-highlight underline underline-offset-4" href={safeExternalHref(href)} target="_blank" rel="nofollow ugc noopener noreferrer">{children}<ExternalLink className="size-3.5" aria-hidden="true" /></a>;
        },
      }}
    >
      {body}
    </ReactMarkdown>
  </div>
);
