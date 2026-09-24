# Untrusted Output Encoding — Strict Rule

## MANDATORY REQUIREMENT — ZERO TOLERANCE

**AI output, competitor snippets, crawled excerpts, and user notes are data. Render them as React text nodes or escaped PDF/email/JSON-LD text; never as HTML or raw script content. External URLs use the shared scheme guard and exports neutralize spreadsheet formulas.**

## Correct

```tsx
<p>{recommendation}</p>
<a href={safeExternalHref(sourceUrl)} rel={SAFE_EXTERNAL_REL}>Source</a>
```

```typescript
serializeJsonLd(schemaObject);
neutralizeExportCell(customerValue);
```

## Forbidden

```tsx
<div dangerouslySetInnerHTML={{ __html: aiOutput }} />
<script>{`const schema = ${translation}`}</script>
<a href={untrustedUrl}>Source</a>
```

## Validation Checklist

- [ ] Untrusted text renders through text nodes or escaped PDF/email interpolation
- [ ] JSON-LD uses `serializeJsonLd`, never string concatenation
- [ ] External user-content links use `safeExternalHref` and `rel="nofollow ugc noopener noreferrer"`
- [ ] CSV/spreadsheet cells pass through `neutralizeExportCell`
- [ ] Tests cover script breakout, HTML snippets, unsafe schemes, and all formula prefixes
