import { memo, type PropsWithChildren } from 'react';
import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { SAFE_EXTERNAL_REL, safeExternalHref } from '@shared/security';

/**
 * Assistant replies arrive as GFM markdown over SSE. Every element is rendered
 * through an explicit override so nothing depends on a typography plugin, and
 * so untrusted model output never reaches the DOM as markup: no raw-HTML rehype
 * plugin is registered, so react-markdown drops embedded HTML, and links pass
 * the shared scheme guard. See `.claude/rules/output-encoding.md`.
 */

const H1 = ({ children }: PropsWithChildren) => (
  <h1 className="mt-1 text-base font-semibold text-foreground">{children}</h1>
);

const H2 = ({ children }: PropsWithChildren) => (
  <h2 className="mt-1 text-sm font-semibold text-foreground">{children}</h2>
);

// ponytail: h4–h6 reuse this renderer — a chat bubble has no room for six sizes.
const H3 = ({ children }: PropsWithChildren) => (
  <h3 className="mt-1 text-sm font-semibold text-muted-foreground">{children}</h3>
);

const components: Components = {
  h1: H1,
  h2: H2,
  h3: H3,
  h4: H3,
  h5: H3,
  h6: H3,
  ul: ({ children }) => <ul className="list-disc space-y-1 ps-5">{children}</ul>,
  ol: ({ children }) => <ol className="list-decimal space-y-1 ps-5">{children}</ol>,
  blockquote: ({ children }) => (
    <blockquote className="border-s-2 ps-3 text-muted-foreground">{children}</blockquote>
  ),
  hr: () => <hr className="border-border" />,
  table: ({ children }) => (
    <div className="overflow-x-auto rounded-md border">
      <table className="w-full border-collapse text-xs">{children}</table>
    </div>
  ),
  th: ({ children }) => (
    <th className="border-b bg-muted px-3 py-2 text-start font-semibold">{children}</th>
  ),
  td: ({ children }) => <td className="border-b px-3 py-2 text-start align-top">{children}</td>,
  // The chip styling below is flattened inside `pre`, so fenced blocks with and
  // without a language info string both render as one plain code box.
  pre: ({ children }) => (
    <pre className="overflow-x-auto rounded-md border bg-muted p-3 font-mono text-xs [&_code]:border-0 [&_code]:bg-transparent [&_code]:p-0 [&_code]:text-inherit">
      {children}
    </pre>
  ),
  code: ({ children }) => (
    <code className="rounded border bg-muted px-1 py-0.5 font-mono text-[0.9em]">{children}</code>
  ),
  // `String(href)` keeps this branch-free: a missing or malformed href fails the
  // URL parse inside the guard and comes back as the inert placeholder.
  a: ({ href, children }) => (
    // eslint-disable-next-line react/jsx-no-target-blank -- SAFE_EXTERNAL_REL includes noopener and noreferrer.
    <a
      className="font-medium text-highlight underline underline-offset-4"
      href={safeExternalHref(String(href))}
      target="_blank"
      rel={SAFE_EXTERNAL_REL}
    >
      {children}
    </a>
  ),
  // The dashboard CSP allows `img-src 'self' data:` only, so a remote image is a
  // guaranteed broken icon. Show the alt text instead.
  img: ({ alt }) => <span className="text-muted-foreground">{alt}</span>,
};

/**
 * Memoized so a streaming delta only re-parses the growing text part, not every
 * completed part and earlier message in the log.
 */
export const AssistantMarkdown = memo(function AssistantMarkdown({ text }: { text: string }) {
  return (
    <div className="assistant-markdown space-y-3 break-words leading-6">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {text}
      </ReactMarkdown>
    </div>
  );
});
