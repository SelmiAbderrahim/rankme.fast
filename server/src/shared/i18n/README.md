# Server i18n

Seven supported locales, single-file dictionaries per locale, one shape enforced by TypeScript.

## Supported locales

`en, ar, fr, de, es, ru, zh`. `en` is the default and the fallback. Source of truth: `locales.ts` (`SUPPORTED_LOCALES`, `DEFAULT_LOCALE`, `RTL_LOCALES`).

## Namespaces (top-level keys)

- `common` — generic UI words (OK/Cancel/Save/Delete).
- `errors` — every `HttpError` message key lives here. `errors.notFound`, `errors.projectNotFound`, `errors.invalidCredentials`.
- `auth` — auth flows (login/register/reset).
- `billing` — checkout + portal.
- `email` — subjects + bodies for transactional email.
- `language` — switcher label + language display names.

Each feature module ADDS its own top-level namespace when a feature prompt lands (e.g. `ranks`, `audits`, `sites`). Every added key must appear in **all 7** dictionaries with identical `{{var}}` placeholders.

## Key style

- Dotted paths: `email.passwordReset.subject`.
- Leaf keys are `lowerCamel`.
- Interpolation uses `{{var}}`. Placeholder names MUST match across every locale.

## Files

```
locales.ts              # constants
dictionaries/en.ts      # canonical shape (DictionaryShape)
dictionaries/ar.ts      # typed against DictionaryShape
dictionaries/fr.ts
dictionaries/de.ts
dictionaries/es.ts
dictionaries/ru.ts
dictionaries/zh.ts
index.ts                # DICTIONARIES, translate(), resolveLanguage(), verifyKeyParity()
```

## Runtime helpers

- `translate(locale, key, vars?)` — dotted-path lookup with `{{var}}` interpolation. Falls back to English, then returns the raw key.
- `resolveLanguage({ override, cookieValue, acceptLanguage, defaultLocale })` — honors `x-lang` header, then the `lang` cookie, then `Accept-Language` (parses `q=`), then the default.
- `verifyKeyParity()` — used by the parity test to prove every locale is a superset of `en` and that placeholders match.

## Wiring

`server/src/shared/middleware/language.ts` mounts on every request (`app.ts`, after `requestId`, before routes). It sets:

- `req.language: SupportedLocale`
- `req.t: (key, vars?) => string`

Typed keys resolve automatically when a route throws
`HttpError.notFound({ code: 'PROJECT_NOT_FOUND', messageKey: 'errors.projectNotFound' })`;
the wrapped `error-handler.ts` translates the key to the caller's language.

## Adding a feature namespace

1. Add the namespace top-level key to `dictionaries/en.ts` (canonical shape).
2. Extend `DictionaryShape` implicitly by re-typing every other locale to `DictionaryShape` — TS errors on missing keys until you add them.
3. Add translations for the 6 non-English locales.
4. The parity test in `shared/i18n/i18n.test.ts` will pass once all seven locales are aligned.
