# Shared Layout System — Strict Rule

## MANDATORY REQUIREMENT — ZERO TOLERANCE

**There is exactly one Header, one Footer, and one shell *system* in `client/src/shared/`. Marketing and app are VARIANTS composed from those building blocks — never inlined, never divergent, never a second visual language. Adding a page NEVER means hand-rolling a new header or footer.**

## Why this rule exists

Fragmented headers and footers are a top tell of an unpolished app. A user must not visibly cross layout styles mid-funnel (marketing → signup). One shell system means a fix to sticky height, z-index, the mobile-menu mechanism, theme/locale controls, or an i18n label lands everywhere at once, and no feature can fork its own chrome.

## Correct

```tsx
// ONE shared Header, variant-driven.
// client/src/shared/components/Header.tsx
export const Header = ({ variant = 'app' }: { variant?: 'app' | 'marketing' }) => { ... };

// ONE shared Footer, variant-driven.
// client/src/shared/components/Footer.tsx
export const Footer = ({ variant = 'minimal' }: { variant?: 'minimal' | 'sitemap' }) => { ... };

// Layouts COMPOSE the shared building blocks — they never inline chrome.
// client/src/shared/components/AppLayout.tsx        → app shell (sidebar + topbar + in-frame Footer variant="minimal")
// client/src/features/marketing/components/MarketingLayout.tsx → Header variant="marketing" + Footer variant="sitemap"
```

- Theme toggle + locale switcher present on every surface, both variants.
- Every visible label goes through `t(...)` in all 7 locales — no hardcoded English.
- Mobile menu uses the shared `Sheet` mechanism everywhere — not native `<details>`, not a bespoke drawer.
- Consistent sticky height and z-index across surfaces.
- A richer surface (marketing) is the boldest expression of the SAME system — never a second language.

## Forbidden

```tsx
// WRONG — a feature layout inlines its own header markup
export const MarketingLayout = () => (
  <div>
    <header className="...">{/* bespoke nav, logo, links */}</header>   // ← fork
    <Outlet />
  </div>
);

// WRONG — a second footer with hardcoded English
<footer>© 2026 RankMeFast · About · Blog</footer>   // not localized, not the shared Footer

// WRONG — a page hand-rolls chrome instead of composing the shell
// WRONG — native <details> mobile menu on one surface, Sheet on another
```

## Validation Checklist

- [ ] Exactly one `Header` and one `Footer` component, variant-driven, in `shared/components/`
- [ ] `AppLayout` and `MarketingLayout` compose the shared blocks — no inlined `<header>`/`<footer>` markup
- [ ] Theme + locale controls on every surface; every label via `t(...)` in 7 locales
- [ ] Mobile menu = shared `Sheet` everywhere; consistent sticky height + z-index
- [ ] No surface visibly crosses into a second layout language mid-funnel
