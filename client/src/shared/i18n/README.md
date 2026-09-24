# Client i18n

Runs on `i18next` + `react-i18next`, with `i18next-browser-languagedetector`.
Seven locales, one namespace per file, per-language JSON.

## Layout

```
locales.ts                    # SUPPORTED_LOCALES, DEFAULT_LOCALE, NAMESPACES, RTL_LOCALES
resources.ts                  # bundles every locale JSON at build time
index.ts                      # initI18n(), changeLanguage(), applyLocaleToDocument(), i18n
LanguageSwitcher.tsx          # accessible <select> switcher
locales/{en,ar,fr,de,es,ru,zh}/
  common.json
  errors.json
  auth.json
  billing.json
  email.json
  language.json
```

## Namespaces & key style

- Files under `locales/<lng>/<namespace>.json`.
- Keys inside a namespace file use dotted paths (`login.email`, `passwordReset.subject`).
- Interpolation uses `{{var}}`. Placeholder names MUST match across every locale.
- Consumer calls: `useTranslation('auth')` then `t('login.email')`.

## Detection

1. `lang` cookie (persisted via `saveCookie`).
2. `navigator.language` (via `i18next-browser-languagedetector`).
3. Fallback: `en`.

`initI18n()` reads the cookie manually so tests can seed it, then attaches the browser detector as the secondary source.

## RTL

Arabic (`ar`) is RTL. `applyLocaleToDocument()` sets:

- `document.documentElement.lang = locale`
- `document.documentElement.dir = 'rtl' | 'ltr'`

Called on init and on every `languageChanged` event.

## Cookie

- Name: `lang` (constant `LANGUAGE_COOKIE`).
- Max-age: 1 year.
- Set via the shared `saveCookie` helper — DO NOT roll a new cookie util.

## Adding a feature namespace

1. Add `<name>.json` for every locale under `locales/<lng>/`.
2. Extend `NAMESPACES` in `locales.ts` and the `RESOURCES` map in `resources.ts`.
3. Use `useTranslation('name')` inside the feature.
4. The parity test in `shared/i18n/i18n.test.ts` will pass once every locale has the same key set.
