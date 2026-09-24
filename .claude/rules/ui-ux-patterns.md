# UI/UX Patterns - Best Practice Guide

> **UPDATE (design-system rule).** The look-and-feel authority is
> **`.claude/rules/design-system.md`** — shadcn/ui on the shipped
> rankme.fast tokens: warm-paper surfaces, ink `--primary`, signal-red
> `--highlight` accent, flat 1px-bordered cards,
> five-color chart palette (`--chart-1..5`), and the conversion-led editorial
> landing anatomy: a theme-responsive free-audit hero, a short eight-band
> homepage path, and a dark closing sheet and footer. Tokens live in `client/src/styles/tailwind.css`;
> primitives in `@shared/ui/*`. That rule **supersedes** the visual
> constraints below wherever they conflict (e.g. marketing hero CTAs may be
> `rounded-full`; app buttons use the shadcn default radius). Do NOT
> hand-fight shadcn defaults. Use semantic tokens (`bg-primary`,
> `text-muted-foreground`, …) rather than raw colors.
>
> **Still fully in force:** the **Accessibility**, **Touch & Interaction**, **Forms &
> Feedback**, **Loading/Error states**, and **responsive/layout** sections below, plus
> "no emoji as icons" (use lucide-react) and light/dark contrast parity. Prefer existing
> shadcn components over custom markup (Alert, Empty, Skeleton, Badge, Separator, Sonner).

## MANDATORY REQUIREMENT

All UI components MUST follow these patterns. Build interfaces that feel human-designed, functional, and honest — not like default AI-generated output.

## Anti-Codex Principles

AI-generated UIs share recognizable tells: card lift effects, decorative animations, shadow escalation, gradient text, glassmorphism, pill-shaped buttons, and excessive rounded corners. Eliminate them.

| Element | Correct | Wrong |
|---------|---------|-------|
| Cards | Flat, `border: 1px solid`, subtle shadow or none | Lift on hover (`translateY`), shadow escalation |
| Buttons | `border-radius: 6px`, solid fill or outline | Pill shape (`border-radius: 9999px`), gradient fill |
| Transitions | `color` or `opacity`, 150ms max | `all`, 300ms+, with transforms |
| Shadows | One subtle shadow level, or none | Escalating shadows on hover |
| Typography | System font stack, regular weights | Multiple decorative fonts, gradient text |
| Spacing | 4/8/12/16/24/32px consistent scale | Arbitrary values (`13px`, `22px`) |
| Status indicators | Static badge with semantic color | Pulsing or bouncing animations |
| Hover states | Background color change | Scale transforms, shadow escalation |

## Banned Patterns

| Pattern | Why | Alternative |
|---------|-----|-------------|
| Card lift on hover | AI-generated tell | Background or border-color change |
| Bounce animation | Decorative, distracting | Spin on loader icon for loading only |
| Pulse on badges/buttons | False urgency | Static badge with semantic color |
| `transition: all` | Over-broad, causes layout shifts | `transition: color` or `transition: opacity` |
| Transition duration > 200ms | Sluggish feel | 150ms max |
| Over-rounded containers (`>12px`) | Toy-like appearance | 8px for cards, 6px for buttons |
| Gradient backgrounds | Decorative, not functional | Solid background color |
| Gradient text | AI-generated signature | Solid text color |
| Backdrop blur / glassmorphism | Hurts readability, decorative | Solid background |
| Scale on hover | Zoom effect is an AI tell | No scale transforms on hover |
| Hidden-until-hover content | Undiscoverable | Always-visible inline actions |

## Accessibility Requirements

### Keyboard Navigation

- All interactive elements MUST be reachable via `Tab` key
- Focus indicators MUST be visible (never `outline: none` without a replacement)
- Modal dialogs MUST trap focus and return focus on close
- Dropdowns MUST support `Escape` to close, arrow keys to navigate
- Use semantic HTML: `<button>` for actions, `<a>` for navigation, `<input>` for form fields

### ARIA

- Add `aria-label` to icon-only buttons
- Use `role="alert"` for error messages that appear dynamically
- Use `aria-live="polite"` for status updates (loading, success)
- Use `aria-expanded` on toggleable elements
- Use `aria-describedby` to link form fields to their error messages

### Loading States

- Show a spinner or skeleton while data loads — never a blank screen
- Disable submit buttons during submission to prevent double-clicks
- Show loading text alongside spinners (e.g. "Saving...")
- Use consistent loading indicators across the app

### Error States

- Display validation errors inline, next to the relevant field
- Show a clear error message (not just a red border)
- Provide actionable guidance (e.g. "Password must be at least 8 characters")
- Use color + text for errors — never color alone

## Color Guidelines

1. **Define a palette** — Use CSS custom properties for all colors
2. **Semantic naming** — `--color-primary`, `--color-error`, `--color-success`
3. **Dark mode** — Use the shared `.dark` ThemeProvider strategy; all components MUST work in light, dark, and resolved system mode
4. **Text contrast** — WCAG 2.2 AA minimum 4.5:1 for normal text and 3:1 for large text
5. **Non-text contrast** — Interactive boundaries, focus indicators, meaningful icons, and chart marks MUST be ≥3:1 against adjacent surfaces
6. **Border roles** — `border-border` is passive structure; controls and interactive outline variants use the stronger `border-input`
7. **Tint testing** — Validate full-strength token text/icons on every sanctioned 10–15% tint over both page and card surfaces
8. **Never hardcode hex** — Use the defined custom properties everywhere, except validated user-provided branding and format-level brand assets

## Animation Rules

| Allowed | Context | Duration |
|---------|---------|----------|
| Spin | Loading spinners only | Continuous |
| `color` / `opacity` transition | Hover/focus state changes | 150ms max |
| Fade in/out | Show/hide elements | 150ms max |

| Banned | Why |
|--------|-----|
| Bounce | Decorative, distracting |
| Pulse (on non-skeleton elements) | False urgency |
| Scale on hover | AI-generated tell |
| Lift on hover | AI-generated tell |
| Duration > 200ms on interactive elements | Sluggish |

## Validation Checklist

- [ ] No card lift / translate on hover
- [ ] No bounce or pulse animations (except skeleton placeholders)
- [ ] No gradient text or backgrounds on UI components
- [ ] Button border-radius <= 8px
- [ ] Card border-radius <= 12px
- [ ] All interactive elements keyboard-reachable
- [ ] Focus indicators visible on all interactive elements
- [ ] Loading states shown for all async operations
- [ ] Error messages are inline, text-based, and actionable
- [ ] Colors use CSS custom properties, not hardcoded hex
- [ ] Normal text and semantic text-on-tint meet 4.5:1 in light and dark modes
- [ ] Controls, focus indicators, meaningful icons, and chart marks meet 3:1 against every adjacent surface
