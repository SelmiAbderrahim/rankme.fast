import { describe, expect, it } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import { HelmetProvider } from 'react-helmet-async';
import { Seo } from './Seo';

const renderSeo = (props: Partial<React.ComponentProps<typeof Seo>> = {}) =>
  render(
    <HelmetProvider>
      <Seo title="T" description="D" basePath="/free-audit" locale="en" {...props} />
    </HelmetProvider>,
  );

describe('Seo', () => {
  it('renders the default (indexable, website, object json-ld) variant', () => {
    expect(() =>
      renderSeo({ jsonLd: { '@type': 'WebSite' } }),
    ).not.toThrow();
  });

  it('renders with no json-ld provided', () => {
    expect(() => renderSeo()).not.toThrow();
  });

  it('renders the noindex + article + rtl + json-ld-array variant', () => {
    expect(() =>
      renderSeo({
        locale: 'ar',
        noindex: true,
        type: 'article',
        datePublished: '2026-01-01',
        dateModified: '2026-02-02',
        image: 'https://x/og.png',
        jsonLd: [{ '@type': 'A' }, { '@type': 'B' }],
      }),
    ).not.toThrow();
  });

  it('emits og:locale and og:locale:alternate values in xx_XX format', async () => {
    renderSeo();

    await waitFor(() => {
      expect(
        document.head.querySelector('meta[property="og:locale"]')?.getAttribute('content'),
      ).toBe('en_US');
    });
    const alternates = Array.from(
      document.head.querySelectorAll('meta[property="og:locale:alternate"]'),
      (node) => node.getAttribute('content'),
    );
    expect(alternates).toEqual(['ar_AR', 'fr_FR', 'de_DE', 'es_ES', 'ru_RU', 'zh_CN']);
  });

  it('escapes </script> and angle brackets in JSON-LD so a value cannot break out of the tag', async () => {
    const payload = {
      '@type': 'FAQPage',
      name: '</script><script>alert(1)</script>',
      note: 'a < b & c > d',
    };
    renderSeo({ jsonLd: payload });

    await waitFor(() => {
      expect(
        document.head.querySelector('script[type="application/ld+json"]'),
      ).toBeInTheDocument();
    });

    const contents = Array.from(
      document.head.querySelectorAll('script[type="application/ld+json"]'),
      (node) => node.textContent ?? '',
    );
    // No raw tag characters survive in ANY emitted JSON-LD block — a
    // `</script>` payload is neutralized to its \uXXXX escape.
    for (const c of contents) {
      expect(c).not.toContain('</script>');
      expect(c).not.toContain('<');
      expect(c).not.toContain('>');
    }
    // The escaped block is still valid JSON that round-trips to the original
    // object (a compliant JSON-LD parser decodes the \uXXXX sequences).
    const parsed = contents.map((c) => {
      try {
        return JSON.parse(c) as unknown;
      } catch {
        return null;
      }
    });
    expect(parsed).toContainEqual(payload);
  });

  it('keeps the hreflang cluster untouched', async () => {
    renderSeo({ locale: 'fr' });

    await waitFor(() => {
      expect(
        document.head.querySelector('link[rel="alternate"][hreflang="x-default"]'),
      ).toBeInTheDocument();
    });
    expect(
      document.head.querySelector('link[rel="alternate"][hreflang="ar"]'),
    ).toBeInTheDocument();
    expect(
      document.head.querySelector('link[rel="alternate"][hreflang="fr"]'),
    ).toBeInTheDocument();
  });
});
