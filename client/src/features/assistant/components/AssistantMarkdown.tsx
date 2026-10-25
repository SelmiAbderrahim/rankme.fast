import { memo, type PropsWithChildren } from 'react';
import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { SAFE_EXTERNAL_REL, safeExternalHref } from '@shared/security';
import { remarkSoftBreaks } from '../markdownBreaks';

/**
 * Assistant replies arrive as GFM markdown over SSE. Every element is rendered
 * through an explicit override so nothing depends on a typography plugin, and
 * so untrusted model output never reaches the DOM as markup: no raw-HTML rehype
 * plugin is registered, so react-markdown drops embedded HTML, and links pass
 * the shared scheme guard. Single newlines render as `<br>` (`remarkSoftBreaks`). See `.claude/rules/output-encoding.md`.
 */

// A reply sits under the page h1 and the log's h2, so every markdown heading
// renders as an h3 (QA round 3 F-AQ): a model "# Title" never adds a second h1
// and a "### Note" never skips a level. The original level keeps its size.
const H1 = ({ children }: PropsWithChildren) => (
  <h3 className="mt-1 text-base font-semibold text-foreground">{children}</h3>
);

const H2 = ({ children }: PropsWithChildren) => (
  <h3 className="mt-1 text-sm font-semibold text-foreground">{children}</h3>
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
  // A wide table scrolls sideways inside its own bounded wrapper instead of
  // being clipped by the bubble; `tabIndex` lets keyboard users scroll it.
  table: ({ children }) => (
    <div
      data-slot="assistant-table-scroll"
      tabIndex={0}
      className="max-w-full overflow-x-auto rounded-md border outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
    >
      <table className="w-full border-collapse text-xs [overflow-wrap:normal]">{children}</table>
    </div>
  ),
  th: ({ children }) => (
    <th className="border-b bg-muted px-3 py-2 text-start font-semibold">{children}</th>
  ),
  td: ({ children }) => <td className="border-b px-3 py-2 text-start align-top">{children}</td>,
  // The chip styling below is flattened inside `pre`, so fenced blocks with and
  // without a language info string both render as one plain code box.
  pre: ({ children }) => (
    <pre className="max-w-full overflow-x-auto rounded-md border bg-muted p-3 font-mono text-xs [&_code]:border-0 [&_code]:bg-transparent [&_code]:p-0 [&_code]:text-inherit">
      {children}
    </pre>
  ),
  code: ({ children }) => (
    <code className="rounded border bg-muted px-1 py-0.5 font-mono text-[0.9em]">{children}</code>
  ),
  // `String(href)` keeps this branch-free: a missing or malformed href fails the
  // URL parse inside the guard and comes back as the inert placeholder.
  a: ({ href, children }) =>
    // GFM links a bare `www.` host (its href is the text with `http://`
    // prepended) but not the same domain without `www.`, so a table of domains
    // mixed links and plain text. Bare hosts stay plain text everywhere; a
    // full URL or an explicit `[label](url)` link is still a link.
    typeof children === 'string' && href === `http://${children}` ? (
      <>{children}</>
    ) : (
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
 * A stand-alone internal identifier in assistant prose: a 24-character
 * database id, a 64-character digest, or the shortened `6a7b5c38a…` form the
 * model writes when it abbreviates one. It needs both a digit and a hex letter,
 * so ordinary words and plain numbers are never touched, and it must not be
 * part of a path, query, or word, so links that carry an id keep working.
 * Ids never help the reader (the app links the thing they name), and the model
 * only repeats them because a tool returned them (QA 58).
 */
const INTERNAL_ID = / ?(?<![\w/=:.#-])(?=[0-9a-f]*\d)(?=[0-9a-f]*[a-f])[0-9a-f]{8,64}(?![\w/=-])(?:…|\.{3})?/gi;

/** Assistant text with stand-alone internal ids removed; everything else is untouched. */
export function hideInternalIds(text: string): string {
  // One space before the id goes with it ("audit 6a7b… (Aug 11)" → "audit (Aug 11)").
  return text.replace(INTERNAL_ID, '');
}

/**
 * Memoized so a streaming delta only re-parses the growing text part, not every
 * completed part and earlier message in the log.
 */
export const AssistantMarkdown = memo(function AssistantMarkdown({ text }: { text: string }) {
  return (
    <div className="assistant-markdown min-w-0 space-y-3 leading-6 [overflow-wrap:anywhere]">
      <ReactMarkdown remarkPlugins={[remarkGfm, remarkSoftBreaks]} components={components}>
        {hideInternalIds(text)}
      </ReactMarkdown>
    </div>
  );
});
