# Design System — shadcn/ui + Aria editorial tokens (warm paper / ink / signal red) — Strict Rule

## MANDATORY REQUIREMENT

Every UI surface — dashboard, auth, settings, report screens and public documentation — follows **one** design system: shadcn/ui primitives on the shipped rankme.fast token set (Aria-inspired: warm paper surfaces, near-black "ink" primary, a single signal-red `--highlight` accent — reference palette: arianetworks.com). The source of truth is `client/src/styles/tailwind.css` (tokens) plus the shadcn primitives in `client/src/shared/ui/` (`@shared/ui/*`). Never restyle primitives ad hoc, never introduce a second visual language, never hand-roll a component a shadcn primitive already covers.

This rule is the look-and-feel authority. `ui-ux-patterns.md` remains in force for accessibility, forms/feedback, and loading/error states, and defers to this file on all visual questions.

## 0. Typography — self-hosted families

The UI families are self-hosted (SEC-07: vendored woff2 under `client/public/fonts`, `font-display: swap`, no CDN). Inter supplies Latin text and Noto Sans Arabic supplies Arabic glyphs in every locale, including mixed-script data.

- **`--font-sans` = Inter, Noto Sans Arabic**, followed by system fallbacks for other scripts. Inter weights 400/500/600/700; Arabic variable weights 100–900. Body applies `font-sans`. Preload Inter 400/600/700 in `index.html`; the Arabic subset loads only when needed. The Arabic asset includes its SIL OFL license alongside the font.
- **`--font-serif` = Instrument Serif**, 400 only. Documentation display text only; never faux-bold or preload it.
- **`--font-mono` = JetBrains Mono**, followed by the system monospace stack, for code.

PDFs use the shared report-export font authority: Noto Sans, Arabic with Latin fallback, and the licensed full Noto Sans SC TrueType font for Chinese. Keep Chinese outlines intact rather than subsetting this font. Arabic lines are shaped and reordered once; the visual-order fontkit adapter must not reverse them again.

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
| `--highlight` | `#b5321e` (signal red) | `#ff5c3f` | THE brand accent — eyebrows, stat bars, serif numerals, chart-1. Never a button fill (SPEC-A6) and never the focus ring |
| `--destructive` | `#b91c1c` | `#f87171` | Errors (light on the 700 scale, dark on the 400 scale, so chip text passes AA on its own 10% tint in both modes) |
| `--overlay` | `rgb(28 26 24 / 0.62)` | `rgb(0 0 0 / 0.72)` | Dialog, sheet and alert-dialog scrims |
| `--warning` | `#854d0e` (ochre) | `#fbbf24` | Pending and attention states, distinct from destructive red |
| `--success` | `#166534` | `#22c55e` | Confirmations (800 scale, same AA-on-tint rule) |
| `--border` | `#c8c1b8` | `#3d3833` | Passive 1px card/table/divider borders; deliberately subtle |
| `--input` | `#8b8178` | `#71685f` | Interactive control boundaries; ≥3:1 on page/card surfaces |
| `--ring` | `#3d3833` (ink) | `#c9c4bd` | Focus rings — neutral ink so focus never reads as an error; red is reserved for `aria-invalid` (`--destructive`). ≥3:1 on page/card/popover/sidebar surfaces (`--sidebar-ring` matches) |
| `--radius` | `0.5rem` | `0.5rem` | Base radius (cards `rounded-xl`, buttons `rounded-md` via shadcn scale) |
| Chart palette (`--chart-1..5`) | red / teal / ochre / purple / blue (`#b5321e`, `#0d6d66`, `#854d0e`, `#7e22ce`, `#1d4ed8`) | `#ff5c3f`, `#2dd4bf`, `#fbbf24`, `#c084fc`, `#60a5fa` | Series colors; each mark clears 3:1 and each text-on-10%-tint recipe clears 4.5:1 |

Rules:

1. **One brand accent: signal red (`--highlight`).** Primary actions are monochrome ink (`--primary`) — a red primary button would read as destructive. Every other decorative color is a chart series, a semantic status, or the warm neutral scale. In the app there is no blue brand hue; blue survives only as `--chart-5` and `--info` stays indigo. Public docs use the blue `.mk-theme` set (§1b).
2. **Semantic utilities only** — `bg-primary`, `text-muted-foreground`, `border-border`, `text-highlight`, … Never raw hex in feature code.
3. **Dark mode** via the `.dark` class + `ThemeProvider` (`client/src/shared/theme/`), toggled by the no-flash head script in `index.html`. Every surface ships and is tested in both modes.
4. **Charts use the 5-color palette** for distinct series. Sparklines/single-series charts stay `--highlight` (chart-1). Never gradient-fill a chart area.
5. **Brand assets follow the palette** — favicon/mark/logo SVGs use ink `#1c1a18` + highlight `#ff5c3f`; `theme-color`/manifest use ink.
6. **Two border roles.** `border-border` is for passive structure; `border-input` is required on controls and interactive outline variants. Do not weaken interactive boundaries with opacity modifiers.
7. **WCAG 2.2 contrast matrix.** Normal text and semantic text-on-tint are ≥4.5:1; controls, meaningful icons, chart marks, and focus indicators are ≥3:1 against every supported surface. Validate light, dark, page, card, popover, sidebar, and sanctioned 10–15% tints.

## 1a. Sanctioned amendments (SPEC-A) — status tokens, tints, chips, tinted actions

The app and public documentation use eight patterns beyond the base tokens. These are **sanctioned** — they amend, not violate, the bans in §4.

- **SPEC-A1 — Status-semantic tokens.** Beyond `--success`/`--destructive`, the token set includes `--warning` (ochre, yellow-800 `#854d0e` in light for AA text contrast and a hue clearly apart from `--destructive`; brighter in dark) and `--info` (indigo — distinct from the highlight red and the purple chart series), each with a `-foreground`. Defined in `:root`, `.dark`, and the `@theme` block of `client/src/styles/tailwind.css`. Status color language: **success**=completed/active/healthy; **warning**=pending/processing/draft/queued; **destructive**=cancelled/failed/DLQ; **info**=shipping/running/in-progress/informational; **muted**=archived/disabled/none.
- **SPEC-A2 — Soft-tint fills.** The status tokens and `--chart-*` are registered as Tailwind color utilities, so **opacity-modified tints** (`bg-success/10`, `bg-warning/15`, `bg-chart-3/10`) compile. Tint recipe: background = token at 10–15% opacity, icon/text = the full-strength token. The exact token-on-tint pair must retain ≥4.5:1 when it carries text and ≥3:1 for meaningful graphics on both page and card surfaces. This is how pastel stat chips, status chips, icon tiles, and tinted icon buttons are built — never with new hex.
- **SPEC-A3 — `rounded-full` status chips.** Status chips/badges, count badges, and delta pills are pill-shaped everywhere. Pills stay banned on app **buttons**; status **chips** are `rounded-full`.
- **SPEC-A4 — Tinted icon-button row actions.** Per-row icon actions (edit/view/delete) may be small circular tinted icon buttons. Destructive row action = `bg-destructive/10 text-destructive`.
- **SPEC-A5 — Flat low-opacity area fill.** Area/sparkline charts may use a **flat** fill of the series color at ≤10% opacity under the line. Gradient fills stay banned (§4 unchanged) — a gradient fade is rendered as a flat tint instead.

- **SPEC-A6 — `--highlight` signal-red accent token.** The single brand accent (burnt red-orange; AA-tuned as text on the paper background). Sanctioned uses: eyebrows, stat accent bars, step numerals, dark-sheet headline accents, and `--chart-1`. It is NOT the focus ring: `--ring` is a neutral ink so a focused control never looks invalid, and invalid fields keep the red `--destructive` ring. FORBIDDEN as a button/background fill in the app and for status meaning — it is deliberately distinct from `--destructive` crimson. Inside the public docs `.mk-theme` (§1b) the token resolves to the blue primary.
- **SPEC-A7 — Marker tint behind display text.** A short span inside an upright serif display headline may carry a marker-like tint made from `--highlight` or `--secondary` at 10–15% opacity. Apply the tint only behind the text, use `box-decoration-clone` so wrapped lines keep the treatment, and keep the glyphs at full `text-foreground`. This is a text-decoration recipe, not permission to use `--highlight` as a button, card, section, or other element fill; the SPEC-A6 fill ban is unchanged.

- **SPEC-A8 — Release-stage banner and badge.** While `VITE_RELEASE_STAGE` is `beta` (default for blank/unknown values), shared app/minimal/public chrome renders `ReleaseStageBanner` above its header and a static outline `ReleaseStageBadge` beside the logo. The banner uses `bg-secondary text-foreground`, a passive border, a lucide `FlaskConical`, “Report a bug”, an optional progress link and an accessible dismiss button. “Report a bug” opens the shared `BugReportDialog`: a public GitHub issue chooser when `VITE_GITHUB_URL` is configured, otherwise the support mailto. It never submits a report automatically. The banner wraps at 320px, uses logical properties, does not pulse or become sticky. Store dismissal per stage in guarded localStorage (`rmf.releaseBanner.dismissed.<stage>`); render on the server and hide after hydration. Setting `VITE_RELEASE_STAGE=ga` removes all beta chrome.

Everything else in §4 stands: no card lift/scale, no `transition: all`, ≤150ms transitions, no glassmorphism, no gradient text/fills, lucide-react only, semantic tokens only, light+dark parity, one `default` button per screen.

## 1b. Public documentation theme (`.mk-theme`) — bright white + blue

Public documentation in `PublicLayout` uses `.mk-theme` to redeclare the full token set (light and dark). Semantic utilities resolve tokens at the element. The contrast contract measures both public blocks as well as the app themes.

| Token | Public light | Public dark | Meaning |
|-------|-----------------|----------------|---------|
| `--background` | `#ffffff` | `#0b1220` (navy) | Page fill |
| `--card` / `--popover` | `#ffffff` | `#111a2e` | Surfaces |
| `--foreground` | `#0f172a` | `#f8fafc` | Body text |
| `--primary` | `#1d4ed8` (blue-700) | `#60a5fa` | Button fills, marker tint, chart-1 |
| `--secondary` | `#dbeafe` / fg `#1e3a8a` | `#1e293b` | Chips, proof icon tiles |
| `--muted` | `#f1f5f9` / fg `#475569` | `#1e293b` / fg `#94a3b8` | Neutral fills, secondary text |
| `--accent` | `#eff6ff` (blue-50) | `#172554` | Hero and get-started band fills |
| `--highlight` / `--ring` | `#1d4ed8` | `#60a5fa` | In public docs the accent IS the primary blue |
| `--border` / `--input` | `#e2e8f0` / `#64748b` | `#243044` / `#64748b` | Passive vs interactive boundaries |
| `--chart-1..5` | blue / teal / ochre / purple / red | `#60a5fa #2dd4bf #fbbf24 #c084fc #ff5c3f` | Series + benefit-tile tints |

Status tokens (`--destructive/--success/--warning/--info`) keep the global values except public dark `--info`, which uses `#a5b4fc` for additional contrast headroom; app dark retains `#818cf8`, which already meets AA. Because `--highlight` equals `--primary` here, SPEC-A6's "never a button fill" ban applies to the dashboard red only; in public docs the blue primary is the action fill.

## 2. App Surfaces (dashboard, auth, settings, reports)

| Element | Pattern |
|---------|---------|
| Cards | Flat `bg-card`, passive `1px border-border`, `rounded-xl`, `shadow-sm` max. Section title (semibold) + muted description line, then content. No hover lift/scale/shadow escalation. |
| Buttons | shadcn variants as shipped: `default` = ink solid (`bg-primary`); `outline` = 1px border on background; `secondary`/`ghost` for tertiary. Exactly ONE `default` button per screen (the primary action). Picker triggers use the shared `field` variant/size, with Input-like boundaries, padding and tap height; do not override another variant’s internals. |
| Forms | Label above input; `Input`, `Textarea`, `Select`, `Checkbox`, `RadioGroup`, `Switch` primitives use `border-input`; option pickers as bordered **radio cards** (selected = `border-primary`); OAuth screens = centered bordered card, provider `outline` buttons with `border-input`, "OR CONTINUE WITH" divider, full-width `default` submit. Inline errors below the field. |
| Data tables | shadcn `Table`: optional checkbox-select column, muted header row, right-aligned numeric columns, per-row `⋯` `DropdownMenu`, footer "`N of M row(s) selected`" + `Previous`/`Next` outline buttons. Tables collapse to cards at narrow widths. |
| Stat cards | Small muted label → large semibold value → muted delta line ("+20.1% from last month") → optional minimal chart. |
| Charts | Minimal: single-series lines/sparklines stay `--highlight`/chart-1 (~2px line, small dot markers); multi-series charts use the five `--chart-*` tokens in declaration order; sparse or no gridlines; flat bars for bar charts. Series also differ through labels, point shapes, line styles, or direct annotation—never color alone. **No gradient area fills, no decorative gauges.** Every chart has an accessible data-table fallback. |
| Badges / status | Static `Badge` with semantic color + text. Never pulse, never color alone. |
| Switches / toggles | shadcn `Switch` — ink when on. |
| Chat / feed | Incoming = muted bubble; outgoing = primary (ink) bubble; round icon send button. |
| Icons | lucide-react only, 16–20px stroke icons. No emoji as icons. |

## 3. Public documentation

Public docs use `PublicLayout` and the existing `.mk-theme` wrapper. Its name is retained for compatibility; it supplies the documented public color tokens below. Root and locale-root routes redirect to login. Do not add landing pages or commerce surfaces.

Docs use the same primitives, accessibility rules and self-hosted fonts as the app. Instrument Serif is limited to documentation display text. Navigation, theme and locale controls keep accessible names and keyboard operation in both directions. Body text, links and code remain readable in both themes.

## 4. Banned Everywhere

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
- [ ] One `default` (primary) button per app screen; pill shapes are reserved for status chips
- [ ] Cards flat: 1px border, ≤`shadow-sm`, no hover motion
- [ ] Tables follow the data-table pattern (muted header, `⋯` menu, Previous/Next footer where paginated)
- [ ] Charts use `--primary` (single-series) or the five `--chart-*` tokens (multi-series) with data-table fallback
- [ ] Light AND dark mode verified on every new surface
- [ ] lucide-react icons only; no emoji icons
- [ ] No banned pattern from §4 present
