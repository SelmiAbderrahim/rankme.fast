# Interaction Hygiene — Strict Rule

## MANDATORY REQUIREMENT — ZERO TOLERANCE

**Every interactive element ships pointer affordance, all interaction states, and — for anything that triggers async work — one shared in-button loading affordance. These are fixed at the primitive level so they cascade; never patched per call site.**

## Why this rule exists

The "boring" fundamentals are where a product loses the award-level feel. A button with no pointer cursor, an async action that freezes the UI with no signal, a hover style with no keyboard equivalent — each reads as unfinished. Pinning these to the shared primitives (`Button`, `Link`, `Spinner`) means every surface inherits them and no feature can regress them.

## Correct

### Pointer affordance (set on the base primitive)

```tsx
// client/src/shared/ui/button.tsx — cva base string
const buttonVariants = cva(
  'inline-flex shrink-0 cursor-pointer items-center justify-center ... ' +
    'disabled:pointer-events-none disabled:opacity-50 disabled:cursor-not-allowed',
  { /* variants */ },
);
```

- Every clickable (button, link, tab, menu item, switch, clickable card) shows `cursor: pointer` on hover.
- Disabled controls show `cursor: not-allowed` + reduced opacity.
- Set it once on the primitive — never on individual usages.

### One shared in-button loading affordance

```tsx
// The moment an async action fires, the control disables + shows a spinner in place.
<Button loading={isSubmitting} loadingLabel={t('common.saving')} onClick={onSave}>
  {t('common.save')}
</Button>
```

`Button` owns a `loading` prop that: (1) disables immediately to prevent double-submit, (2) renders the shared `<Spinner/>` in place (`shared/ui/spinner.tsx`, lucide `Loader2` + `animate-spin`), (3) sets `aria-busy`, (4) restores on success **and** on error. There is ONE loading affordance across the app — not per-feature `isSubmitting`/`adding`/`connecting` flags rendering ad-hoc markup.

### Every interactive element ships all states

default · hover · focus-visible · active/pressed · disabled · loading (where it does async work). No element ships with only a default state. Visible feedback within ~100ms of any click. Every hover affordance has a focus-visible equivalent — nothing is discoverable by mouse only.

## Forbidden

```tsx
// WRONG — clickable without pointer cursor (fix on the primitive, not here)
<div onClick={...}>Go</div>

// WRONG — async action with no in-place progress; UI freezes
<Button onClick={submit}>{t('save')}</Button>   // no loading/disable → double-submit

// WRONG — per-feature ad-hoc loading flag rendering its own spinner markup
{adding ? <MyLocalSpinner/> : <button>Add</button>}

// WRONG — hover-only affordance with no focus-visible equivalent
className="opacity-0 hover:opacity-100"   // keyboard users never see it
```

## Validation Checklist

- [ ] `cursor: pointer` on every clickable; disabled → `cursor: not-allowed` + reduced opacity — set on the base primitive
- [ ] Async actions disable immediately + show the shared in-button `Spinner`; restore on success and error; no double-submit
- [ ] ONE shared loading affordance (`Button` `loading` prop) — no per-feature spinner flags
- [ ] Every interactive element ships default/hover/focus-visible/active/disabled(/loading) states
- [ ] Feedback within ~100ms of any click; hover affordances have focus-visible equivalents
