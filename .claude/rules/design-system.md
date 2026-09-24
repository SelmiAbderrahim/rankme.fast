# Design System — shadcn/ui + Aria editorial tokens (warm paper / ink / signal red) — Strict Rule

## MANDATORY REQUIREMENT

Every UI surface — dashboard, auth, settings, billing, report screens, AND the SSR marketing/landing pages — follows **one** design system: shadcn/ui primitives on the shipped rankme.fast token set (Aria-inspired: warm paper surfaces, near-black "ink" primary, a single signal-red `--highlight` accent — reference palette: arianetworks.com). The source of truth is `client/src/styles/tailwind.css` (tokens) plus the shadcn primitives in `client/src/shared/ui/` (`@shared/ui/*`). Never restyle primitives ad hoc, never introduce a second visual language, never hand-roll a component a shadcn primitive already covers.

This rule is the look-and-feel authority. `ui-ux-patterns.md` remains in force for accessibility, forms/feedback, and loading/error states, and defers to this file on all visual questions.

## 0. Typography — two self-hosted families

One sans + one serif, both self-hosted (SEC-07: latin woff2 vendored under `client/public/fonts`, `font-display: swap`, no CDN). Never fall back to the OS system stack for UI text — that is what makes type render differently per machine.

- **`--font-sans` = Inter** (weights 400/500/600/700). The single UI/body face across the WHOLE product — app, marketing, auth. Body applies it in the `@layer base` (`body { @apply font-sans }`). Preload the 400 + 600 + 700 woff2 in `index.html`. Marketing display headlines are **Inter 700** with tight tracking (`h1Class`/`displayClass`/`statValueClass` in `features/marketing/components/shared.tsx`); emphasized words use the SPEC-A7 marker treatment.
- **`--font-serif` = Instrument Serif** (400 only — never faux-bold it). Docs-only display face (`features/docs`). Not used on marketing or app surfaces and not preloaded.
- **`--font-mono` = JetBrains Mono** — code snippets in the product-panel mock only.

These two families (+ mono for code) are the ONLY fonts. Inter and Instrument Serif are both SIL OFL, vendored via `npm pack` (no runtime dep).

## 1. Theme Tokens

Source of truth: `client/src/styles/tailwind.css`. Light mode below; `.dark` mirrors every token.

| Token | Light value | Dark value | Meaning |
|-------|-------------|------------|---------|
| `--background` | `#f2f0ed` (warm paper) | `#0a0a09` (warm black) | Page fill |
| `--card` / `--popover` | `#ffffff` | `#141312` | Surface fills |
| `--foreground` | `#191715` | `#f2f0ed` | Body text |
| `--primary` | `#1c1a18` (ink) | `#f2f0ed` (inverted ink) | Primary fills (buttons, selected states, toggles-on) — monochrome, Aria-style |
| `--primary-foreground` | `#f5f3f0` | `#12100f` | Text on primary |
| `--secondary` | `#dcd8d1` (taupe) | `#262421` | Secondary surfaces and buttons; optional marker tint under SPEC-A7 |
| `--muted` | `#e8e5e0` | `#1c1a18` | Neutral fills |
| `--muted-foreground` | `#59544f` | `#a39f99` | Secondary text (warm gray, ≥6.5:1 on page backgrounds) |
| `--accent` | `#eceae5` | `#262421` | Subtle warm-tinted fills (hover states) |
| `--highlight` | `#b5321e` (signal red) | `#ff5c3f` | THE brand accent — eyebrows, stat bars, serif numerals, focus rings, chart-1. Never a button fill (SPEC-A6) |
| `--destructive` | `#b91c1c` | `#f87171` | Errors (light on the 700 scale, dark on the 400 scale, so chip text passes AA on its own 10% tint in both modes) |
| `--success` | `#166534` | `#22c55e` | Confirmations (800 scale, same AA-on-tint rule) |
| `--border` | `#c8c1b8` | `#3d3833` | Passive 1px card/table/divider borders; deliberately subtle |
| `--input` | `#8b8178` | `#71685f` | Interactive control boundaries; ≥3:1 on page/card surfaces |
| `--ring` | `#b5321e` | `#ff5c3f` | Focus rings (signal red; ≥3:1 on page/card surfaces) |
| `--radius` | `0.5rem` | `0.5rem` | Base radius (cards `rounded-xl`, buttons `rounded-md` via shadcn scale) |
| Chart palette (`--chart-1..5`) | red / teal / ochre / purple / blue (`#b5321e`, `#0d6d66`, `#854d0e`, `#7e22ce`, `#1d4ed8`) | `#ff5c3f`, `#2dd4bf`, `#fbbf24`, `#c084fc`, `#60a5fa` | Series colors; each mark clears 3:1 and each text-on-10%-tint recipe clears 4.5:1 |

Rules:

1. **One brand accent: signal red (`--highlight`).** Primary actions are monochrome ink (`--primary`) — a red primary button would read as destructive. Every other decorative color is a chart series, a semantic status, or the warm neutral scale. In the app there is no blue brand hue; blue survives only as `--chart-5` and `--info` stays indigo. Marketing routes swap to the blue `.mk-theme` set (§1b).
2. **Semantic utilities only** — `bg-primary`, `text-muted-foreground`, `border-border`, `text-highlight`, … Never raw hex in feature code.
3. **Dark mode** via the `.dark` class + `ThemeProvider` (`client/src/shared/theme/`), toggled by the no-flash head script in `index.html`. Every surface ships and is tested in both modes.
4. **Charts use the 5-color palette** for distinct series. Sparklines/single-series charts stay `--highlight` (chart-1). Never gradient-fill a chart area.
5. **Brand assets follow the palette** — favicon/mark/logo SVGs use ink `#1c1a18` + highlight `#ff5c3f`; `theme-color`/manifest use ink.
6. **Two border roles.** `border-border` is for passive structure; `border-input` is required on controls and interactive outline variants. Do not weaken interactive boundaries with opacity modifiers.
7. **WCAG 2.2 contrast matrix.** Normal text and semantic text-on-tint are ≥4.5:1; controls, meaningful icons, chart marks, and focus indicators are ≥3:1 against every supported surface. Validate light, dark, page, card, popover, sidebar, and sanctioned 10–15% tints.

## 1a. Sanctioned amendments (SPEC-A) — status tokens, tints, chips, tinted actions

The authenticated app and marketing anatomies introduce eight patterns beyond the base tokens. These are **sanctioned** — they amend, not violate, the bans in §4.

- **SPEC-A1 — Status-semantic tokens.** Beyond `--success`/`--destructive`, the token set includes `--warning` (amber, tuned to amber-700 in light for AA text contrast; brighter in dark) and `--info` (indigo — distinct from the highlight red and the purple chart series), each with a `-foreground`. Defined in `:root`, `.dark`, and the `@theme` block of `client/src/styles/tailwind.css`. Status color language: **success**=paid/completed/active/healthy; **warning**=pending/processing/draft/queued/trialing; **destructive**=overdue/cancelled/failed/past-due/DLQ; **info**=shipping/running/in-progress/informational; **muted**=archived/disabled/none.
- **SPEC-A2 — Soft-tint fills.** The status tokens and `--chart-*` are registered as Tailwind color utilities, so **opacity-modified tints** (`bg-success/10`, `bg-warning/15`, `bg-chart-3/10`) compile. Tint recipe: background = token at 10–15% opacity, icon/text = the full-strength token. The exact token-on-tint pair must retain ≥4.5:1 when it carries text and ≥3:1 for meaningful graphics on both page and card surfaces. This is how pastel stat chips, status chips, icon tiles, and tinted icon buttons are built — never with new hex.
- **SPEC-A3 — `rounded-full` status chips.** Status chips/badges, count badges, and delta pills are pill-shaped everywhere. This amends the "pill only on marketing" clause: pills stay banned on **buttons** in the app, but status **chips** are `rounded-full` app-wide.
- **SPEC-A4 — Tinted icon-button row actions.** Per-row icon actions (edit/view/delete) may be small circular tinted icon buttons. Destructive row action = `bg-destructive/10 text-destructive`.
- **SPEC-A5 — Flat low-opacity area fill.** Area/sparkline charts may use a **flat** fill of the series color at ≤10% opacity under the line. Gradient fills stay banned (§4 unchanged) — a gradient fade is rendered as a flat tint instead.

- **SPEC-A6 — `--highlight` signal-red accent token.** The single brand accent (burnt red-orange; AA-tuned as text on the paper background). Sanctioned uses: eyebrows, stat accent bars, step numerals, dark-sheet headline accents, focus `--ring`, and `--chart-1`. FORBIDDEN as a button/background fill in the app and for status meaning — it is deliberately distinct from `--destructive` crimson. Inside `.mk-theme` (§1b) the token resolves to the blue primary, so marketing CTAs are blue by design.
- **SPEC-A7 — Marker tint behind display text.** A short span inside an upright serif display headline may carry a marker-like tint made from `--highlight` or `--secondary` at 10–15% opacity. Apply the tint only behind the text, use `box-decoration-clone` so wrapped lines keep the treatment, and keep the glyphs at full `text-foreground`. This is a text-decoration recipe, not permission to use `--highlight` as a button, card, section, or other element fill; the SPEC-A6 fill ban is unchanged.

- **SPEC-A8 — Release-stage banner and badge.** While `VITE_RELEASE_STAGE` is `beta` (the default; blank or unknown values also mean `beta`), the shared chrome shows a public-beta notice: `ReleaseStageBanner` (`client/src/shared/components/`) rendered by every layout (marketing, app, minimal) directly above the shared header/topbar, and a static outline `ReleaseStageBadge` ("Beta") beside the logo in the shared `Header` (both variants and the mobile `Sheet`) and the app sidebar. The banner is `bg-secondary text-foreground` with a passive `border-border` bottom edge, a lucide `FlaskConical` icon, the "Report a bug" link (public issue chooser when `VITE_GITHUB_URL` is set, otherwise the support `mailto:`), a "Follow progress on X" link, and an icon-only dismiss button with an accessible name. It never uses a `--highlight` fill, never pulses, is not sticky (the header keeps its sticky height and z-index), wraps at 320px without horizontal scroll, and uses logical properties. Dismissal is stored per stage in `localStorage` (`rmf.releaseBanner.dismissed.<stage>`, every access guarded); the server always renders the banner and it hides only after hydration. Setting `VITE_RELEASE_STAGE=ga` removes the banner, the badge, and all beta copy at once. Beta chrome is shared layout, not a homepage band: the seven-band anatomy in §3 is unchanged.

Everything else in §4 stands: no card lift/scale, no `transition: all`, ≤150ms transitions, no glassmorphism, no gradient text/fills, lucide-react only, semantic tokens only, light+dark parity, one `default` button per screen.

## 1b. Marketing theme (`.mk-theme`) — bright white + blue

Every public route rendered by `MarketingLayout` (marketing pages AND docs) sits inside a `.mk-theme` wrapper that redeclares the full token set in `client/src/styles/tailwind.css` (`.mk-theme {}` light; `.dark .mk-theme, .mk-theme .dark {}` dark). Utilities resolve to `var(--x)` at the element, so the same semantic classes render blue on marketing and ink on the dashboard. `theme-contrast.test.ts` runs the WCAG matrix on both marketing blocks too.

| Token | Marketing light | Marketing dark | Meaning |
|-------|-----------------|----------------|---------|
| `--background` | `#ffffff` | `#0b1220` (navy) | Page fill |
| `--card` / `--popover` | `#ffffff` | `#111a2e` | Surfaces |
| `--foreground` | `#0f172a` | `#f8fafc` | Body text |
| `--primary` | `#1d4ed8` (blue-700) | `#60a5fa` | Button fills, marker tint, chart-1 |
| `--secondary` | `#dbeafe` / fg `#1e3a8a` | `#1e293b` | Chips, proof icon tiles |
| `--muted` | `#f1f5f9` / fg `#475569` | `#1e293b` / fg `#94a3b8` | Neutral fills, secondary text |
| `--accent` | `#eff6ff` (blue-50) | `#172554` | Hero and get-started band fills |
| `--highlight` / `--ring` | `#1d4ed8` | `#60a5fa` | On marketing the accent IS the primary blue |
| `--border` / `--input` | `#e2e8f0` / `#64748b` | `#243044` / `#64748b` | Passive vs interactive boundaries |
| `--chart-1..5` | blue / teal / ochre / purple / red | `#60a5fa #2dd4bf #fbbf24 #c084fc #ff5c3f` | Series + benefit-tile tints |

Status tokens (`--destructive/--success/--warning/--info`) keep the global values. Because `--highlight` equals `--primary` here, SPEC-A6's "never a button fill" ban applies to the dashboard red only; on marketing the blue primary is the CTA fill.

## 2. App Surfaces (dashboard, auth, settings, billing, reports)

| Element | Pattern |
|---------|---------|
| Cards | Flat `bg-card`, passive `1px border-border`, `rounded-xl`, `shadow-sm` max. Section title (semibold) + muted description line, then content. No hover lift/scale/shadow escalation. |
| Buttons | shadcn variants as shipped: `default` = ink solid (`bg-primary`); `outline` = 1px border on background; `secondary`/`ghost` for tertiary. Exactly ONE `default` button per screen (the primary action). |
| Forms | Label above input; `Input`, `Textarea`, `Select`, `Checkbox`, `RadioGroup`, `Switch` primitives use `border-input`; plan/option pickers as bordered **radio cards** (selected = `border-primary`); OAuth screens = centered bordered card, provider `outline` buttons with `border-input`, "OR CONTINUE WITH" divider, full-width `default` submit. Inline errors below the field. |
| Data tables | shadcn `Table`: optional checkbox-select column, muted header row, right-aligned numeric columns, per-row `⋯` `DropdownMenu`, footer "`N of M row(s) selected`" + `Previous`/`Next` outline buttons. Tables collapse to cards at narrow widths. |
| Stat cards | Small muted label → large semibold value → muted delta line ("+20.1% from last month") → optional minimal chart. |
| Charts | Minimal: single-series lines/sparklines stay `--highlight`/chart-1 (~2px line, small dot markers); multi-series charts use the five `--chart-*` tokens in declaration order; sparse or no gridlines; flat bars for bar charts. Series also differ through labels, point shapes, line styles, or direct annotation—never color alone. **No gradient area fills, no decorative gauges.** Every chart has an accessible data-table fallback. |
| Badges / status | Static `Badge` with semantic color + text. Never pulse, never color alone. |
| Switches / toggles | shadcn `Switch` — ink when on. |
| Chat / feed | Incoming = muted bubble; outgoing = primary (ink) bubble; round icon send button. |
| Icons | lucide-react only, 16–20px stroke icons. No emoji as icons. |

## 3. Marketing / Landing Pages (SSR surface) — bright, bold, seven bands

> **Self-hosted (OSS) edition:** this repository ships no marketing or landing pages. `/` and each locale root redirect to `/login`; the only public SSR surface is `/docs` inside `PublicLayout` (`.mk-theme`). The anatomy below documents the hosted marketing site and does not apply here — do not reintroduce it.

Marketing uses the `.mk-theme` tokens (§1b) and the shared primitives. Bold statements in few words, one obvious CTA per band, and the visitor reaches the categorized benefits and the buy/self-host choice within two scrolls at 1440×1000. The hero is `bg-accent` (blue-50) in light mode and never locally `dark`. The sample-report band, the closing CTA sheet, and the sitemap footer are locally dark in both themes. Secondary marketing routes use the same tokens, fonts, and primitives but do not reproduce the homepage sequence. **Exceptions scoped to marketing only:**

1. Hero/nav/closing-sheet CTAs may be `rounded-full` (pill) and oversized (`h-14 px-9 text-lg`). Primary = blue `default`; secondary = `outline`/`ghost`. A trailing `→` is allowed.
2. Display headlines are **Inter 700** via `h1Class`/`displayClass` (`features/marketing/components/shared.tsx`). Emphasized headline spans use SPEC-A7 (blue marker) or `text-highlight`.
3. The marketing header CTA and the hero CTA are both `default`: one primary button per band, not per page.

The app dashboard NEVER uses pill buttons, oversized CTAs, or the blue marketing tokens.

Build the closing sheet and footer by scoping the `dark` class on their wrappers (`<section className="dark bg-background text-foreground …">`) so the tokens flip locally and these regions stay dark in both themes. Never hardcode dark colors.

| Section | Pattern |
|---------|---------|
| Root header | Slim sticky bar: logo left (with the static outline Beta badge beside it while `VITE_RELEASE_STAGE` is `beta`, SPEC-A8); links to Benefits, Sample report, Get started, Pricing, and FAQ (`#benefits`, `#sample-report`, `#get-started`, `/pricing`, `#faq`); theme and locale controls; one bold blue `default` Start free pill to signup; a GitHub text chip only when `VITE_GITHUB_URL` is set. Other marketing routes keep the full shared navigation. The free audit is not linked from the root header or deep nav; `/free-audit` stays footer-reachable. |
| Homepage order | Exactly seven bands (`data-home-band`): `hero`, `proof`, `benefits`, `sample`, `get-started`, `faq`, `closing`. Do not add a score demo, showcase tabs, testimonials, a free-audit form, logo walls, carousels, or duplicate product demos. |
| Hero | `bg-accent`, centered. Eyebrow chip (open-source variant only when `VITE_GITHUB_URL` is set); a two-line `displayClass` headline of at most eight words with one SPEC-A7 marker span; one line of body copy; the oversized blue `default` Start free pill to signup (the only `default` button in `main`); a `ghost` "Self-host it" link to `#get-started`; honest no-card microcopy; one static aria-hidden digit-free product mock. The full Start free control stays above the fold at 320×720. No typewriter copy, forms, gradients, or full-viewport minimum height. |
| Proof strip | `bg-background` row of four bold facts, each digit ledger-backed (audit rule count, seven locales including RTL, one-command Docker boot, data ownership), then honest "Works with" and "Checks AI answers on" text-chip rows naming only integrations and AI surfaces the product actually reads. Never customer proof. |
| Benefits | `id="benefits"`. One bold statement headline ("Get seen. Get cited. Get it fixed."), one line, then exactly four flat category cards (`grid sm:grid-cols-2 lg:grid-cols-4`): tinted lucide icon tile, bold title, one line, and link chips (`rounded-full border-input`) to every live feature route (fifteen today). Benefits are categorized, never a flat wall of tiles. Keep existing destinations intact. |
| Sample report | `id="sample-report"`, `dark`-scoped statement band with `data-claim-surface`: a bold two-part headline (accent in `text-highlight`) and one line beside a compact illustrative report card matching the public DTO (illustrative label, counts marked `data-claim-exempt`, finding title, affected URL, why, action). No score, gauge, tabs, fake timing, PageSpeed/Core Web Vitals, or AI output. |
| Get started | `id="get-started"`, `bg-accent`, `data-claim-surface`. Two flat cards side by side: Cloud ("Plans from" the first paid `MARKETING_TIERS` price, claim-key bound; one line; outline "See plans" to `/pricing`; no-card note) and Self-hosted ("Free forever", digit-free; bring-your-own vendor keys line; the REAL compose commands in a `font-mono` `dir="ltr"` frame with a ghost copy button; outline "Setup guide" to `/docs/getting-started`; security link). Open-source elements (`git clone`, license badge, repository CTA) render only when `VITE_GITHUB_URL` is set. "See more" is a link, never a paragraph. |
| Section headings | Bold Inter sans headings (`text-4xl sm:text-6xl` for band statements). Marker emphasis follows SPEC-A7; no italic-only or serif emphasis. |
| Steps | Numbered steps: large bold numeral in `--highlight`, semibold sans title, muted copy. |
| Capability mosaic | Section intro + grid of flat bordered cards: small lucide icon inside a 1px-bordered rounded tile on `bg-muted`, semibold title, and one muted paragraph. Keep existing destinations intact; additive cards must not displace them. |
| Product visuals | Use `bg-accent` bands and `bg-card` frames for report and product mocks. Show real product output and preserve captions, honesty limits, and claim surfaces. |
| Integrations | Two wrapping rows of static, bordered lucide chips. Use text labels rather than third-party logo assets. No marquee or brand-colored fills. |
| Pillars | Evidence, work, outcomes, and honesty pillars on the light surface, with restrained `.mk-story-orbit` decoration. Keep the honesty limits plain and visible. |
| Social proof | Use only verified product facts. Do not invent testimonials, customer counts, logos, social links, or competitor metrics. A Product-Hunt-style badge is allowed only when a real fact supports it. |
| FAQ | shadcn `Accordion` with bordered rows and a chevron indicator; four questions on the homepage. Visible localized answers and FAQ JSON-LD come from the same source. |
| Closing CTA sheet | Full-width, `dark`-scoped sheet with a rounded top (`rounded-t-[2.5rem]`): eyebrow; a giant bold `displayClass` "Start free →" link to signup; a small truthful footnote. Secondary pages keep the `DarkCtaSheet` strike-line variant. No paid-trial promise, inverted button pair, or transform effect. |
| Footer | Dark-scoped sitemap footer with multi-column links and a muted copyright line. Render the optional social row only when verified links exist; the shipped empty list stays hidden. |

The free audit lives only on `/free-audit` (footer-reachable; never linked from the homepage or the primary nav). Its form requires URL and email, then opens a single-use report in the browser. It does not email a report or produce a reusable sharing link. Its public response is limited to localized counts and findings; it omits PageSpeed/Core Web Vitals, AI summaries, provider metadata, and account data. Never use paid-report or account-report capabilities to describe this public funnel.

Open-source wording discipline: while `VITE_GITHUB_URL` is unset, marketing copy says "self-hostable" / "runs on your infrastructure" — never "open source", a license name, a star count, or a GitHub link. Setting the env var (repo public) flips every gated element at once; strings for both states ship in all seven locales.

Landing motion is limited to scroll `Reveal`s and a canvas only where they materially explain content. Each MUST honor `prefers-reduced-motion`, render complete static content when motion is reduced, and avoid layout shift. Any canvas pauses off-screen and when the tab is hidden. Fonts follow §0: Inter 400/600/700 are preloaded; nothing else is on the hero LCP path.

## 4. Banned Everywhere (both surfaces)

- Gradient text, gradient button/card fills, glassmorphism, backdrop blur
- Card lift (`translateY`), scale transforms, shadow escalation on hover
- `transition: all`; any transition >150ms; transitions on properties other than `color`/`opacity`/`background-color`
- Bounce/pulse animations (skeleton shimmer excepted)
- Decorative multicolor palettes outside the five `--chart-*` tokens, emoji icons, hidden-until-hover actions
- Raw color values in components (hex, rgb) — semantic tokens only
- Restyled shadcn primitives (overriding variant internals instead of composing)

## Validation Checklist

- [ ] All colors via semantic token utilities; zero raw color values in feature code
- [ ] Text/token tint pairs meet 4.5:1; controls, focus indicators, meaningful icons, and chart marks meet 3:1 on page/card/popover/sidebar surfaces
- [ ] Passive structure uses `border-border`; controls and interactive outlines use `border-input` without opacity reduction
- [ ] One `default` (primary) button per screen in the app; on marketing one per band (header + hero may both be `default`); pills confined to the marketing surface
- [ ] Cards flat: 1px border, ≤`shadow-sm`, no hover motion
- [ ] Tables follow the data-table pattern (muted header, `⋯` menu, Previous/Next footer where paginated)
- [ ] Charts use `--primary` (single-series) or the five `--chart-*` tokens (multi-series) with data-table fallback
- [ ] The root landing page implements the §3 seven-band bright anatomy inside `.mk-theme`; secondary marketing pages keep the same tokens, Inter display type, and primitives without duplicating that exact sequence
- [ ] Light AND dark mode verified on every new surface
- [ ] lucide-react icons only; no emoji icons
- [ ] No banned pattern from §4 present

## 2026-09-22 product-led marketing amendment

This amendment supersedes earlier marketing-only constraints on the eight-word headline, digit-free/aria-hidden mock, ghost self-host CTA, and text-only integration chips. Marketing supports equally sized solid/outline actions without arrows, accessible localized illustrative product previews, larger integration tiles, and static decorative background artwork with soft lighting. Actual UI surfaces retain semantic colors and contrast; no gradient text/buttons, hover lift, or decorative motion. Seven homepage bands and environment-gated repository elements remain. Dashboard styling is unchanged.
