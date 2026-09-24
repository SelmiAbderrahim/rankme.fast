# Seven Locales, Always — Strict Rule

## MANDATORY REQUIREMENT — ZERO TOLERANCE

**Every user-facing string ships in all seven locales: `en, ar, fr, de, es, ru, zh`. Parity tests fail the build on missing keys. RTL is required for `ar`. Rule copy is plain-language.**

## Why this rule exists

We ship in seven markets from day one. A missing translation is either an English string leaking into an Arabic UI or a `report.ruleTitle.missingH1` key rendered raw — both look broken. Parity tests catch this at build time.

## Correct

Client-side (`i18next` + `react-i18next`):

```typescript
// client/src/shared/i18n/locales/en/report.json
{
  "ruleTitle": {
    "missingH1": "Page is missing a top-level heading",
    "duplicateTitle": "Duplicate page title"
  },
  "buckets": {
    "fixNow": "Fix now",
    "watch": "Nice to have",
    "advisory": "Advisory"
  }
}
```

The SAME keys with the SAME placeholders exist in `ar`, `fr`, `de`, `es`, `ru`, and `zh`. Register the namespace in `client/src/shared/i18n/resources.ts`.

```tsx
// client/src/features/report/components/RuleRow.tsx
import { useTranslation } from "react-i18next";

export function RuleRow({ ruleId }: Props) {
  const { t } = useTranslation("report");
  return <h3>{t(`ruleTitle.${ruleId}`)}</h3>;
}
```

Server-side (hand-written typed dictionaries):

```typescript
// server/src/shared/i18n/locales/en.ts
export const en = {
  common: { unauthorized: "You need to sign in." },
  billing: { overCap: "You've reached your monthly {{metric}} cap." },
  // ...
} as const;
```

```typescript
// server/src/shared/i18n/index.ts (excerpt)
export function translate(lang: SupportedLang, key: string, vars?: Record<string, string>) {
  const dict = LOCALES[lang] ?? LOCALES[DEFAULT_LOCALE];
  return interpolate(get(dict, key), vars);
}
```

Every module surfaces its errors with i18n keys, not literal English:

```typescript
throw HttpError.forbidden("billing.overCap", { metric: "audits" });
```

## Auto-detection

- **Client:** `i18next-browser-languagedetector` reads `navigator.language`, then a cookie, then falls back to `DEFAULT_LOCALE` (default `en`).
- **Server:** `languageMiddleware()` in `shared/middleware/language.ts` parses `Accept-Language`, honours `x-lang` header and the `lang` cookie in that order, and falls back to `DEFAULT_LOCALE`. `req.language` is the resolved code.

## RTL

Arabic (`ar`) requires RTL. On the SSR entrypoint and on the client root:

```tsx
<html lang={lang} dir={lang === "ar" ? "rtl" : "ltr"}>
```

Design-system rules on physical vs logical CSS properties (`ms-*` / `me-*` / `text-start`) apply. Do NOT use `ml-*` / `mr-*` / `text-left` in shared components; local one-shots for LTR-only surfaces (marketing hero with a specific direction) are the only exception.

## Parity tests

- `client/src/shared/i18n/i18n.test.tsx` enumerates every locale directory and asserts:
  - Every namespace present in `en/` is present in every other locale.
  - Every JSON key path present in `en/<ns>.json` is present in every other `<lang>/<ns>.json`.
  - Every `{{placeholder}}` in `en` matches the same placeholder in the sibling files.
- `server/src/shared/i18n/i18n.test.ts` runs `verifyKeyParity(LOCALES)` — same guarantee for the typed dictionaries.
- Neither test allows a "skip this key" file. Fix the missing translation instead.

## Plain-language rule copy

Audit rule titles, descriptions, and fix hints target a general audience — not an SEO expert. Guidelines:

- Prefer verbs over nouns. "Add a `<title>` tag." not "Missing title element."
- Explain *why* in one sentence, not two paragraphs. Link to the docs page for depth.
- Numbers spelled out under ten. "Add three or more internal links." not "Add 3+ internal links."
- Never leak vendor jargon. "DataForSEO says the page is slow" is wrong; "The page loads slowly on mobile" is right.
- Keep the same tone across all seven locales — that's why the translation is per-key, not a machine sweep.

## Forbidden

```tsx
// WRONG — literal English in a component
<h3>Fix now</h3>

// WRONG — key that only exists in one locale
{t("newFeature.title")}   // added to en/ but not ar/, fr/, …

// WRONG — server error message in English
throw HttpError.badRequest("Invalid site URL");

// WRONG — hand-picked "safe" locales
// (we ship in seven; there is no smaller shortlist)

// WRONG — machine-translated rule copy pasted in bulk
// (rule copy is plain-language and reviewed per locale; parity tests
//  catch missing keys but not tone drift — that's on the reviewer)
```

## Adding a new user-facing string

1. Add the English source string with its final key in `client/src/shared/i18n/locales/en/<namespace>.json` (client) or `server/src/shared/i18n/locales/en.ts` (server).
2. Add the SAME key in each of the six sibling locale files with a human translation.
3. Confirm `{{placeholders}}` line up in every file.
4. Re-run the parity test.

## Validation Checklist

- [ ] Every user-facing string is fetched via `t(...)` or the server `translate(...)`
- [ ] Every new key exists in all 7 locale files with matching `{{placeholders}}`
- [ ] Parity tests are green (client + server)
- [ ] `dir="rtl"` is set when `lang === 'ar'`
- [ ] Rule copy is plain-language: verbs first, no vendor jargon, ≤ 2 sentences per rule
