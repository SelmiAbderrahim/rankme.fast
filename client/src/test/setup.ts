import '@testing-library/jest-dom/vitest';
import { afterAll, vi } from 'vitest';
import { configure } from '@testing-library/dom';

// Parallel fork processes in constrained Docker runners starve the CPU during
// heavy React+i18n+jsdom setups. The @testing-library/dom default findBy*
// timeout is 1 000 ms — far too short when the renderer needs to settle lazy
// route imports under scheduling pressure. 10 s matches the vitest testTimeout
// set in vitest.config.ts and still catches genuinely infinite loops.
configure({ asyncUtilTimeout: 10_000 });

// Better Auth's nanostore deliberately defers its final unmount by 1 second
// so rapid React remounts do not churn the session listeners. A test file can
// otherwise finish and let jsdom remove `window` before that deferred cleanup
// runs, leaving an unhandled broadcast-channel exception after every assertion
// has passed. Wait only in files that actually mounted the real session store;
// mocked auth clients and non-auth tests pay no delay.
afterAll(async () => {
  const broadcastChannel = (
    globalThis as unknown as Record<PropertyKey, { listeners?: Set<unknown> } | undefined>
  )[Symbol.for('better-auth:broadcast-channel')];
  if (broadcastChannel?.listeners?.size) {
    await new Promise<void>((resolve) => setTimeout(resolve, 1_050));
  }
});

// jsdom lacks several browser APIs that shadcn/Radix primitives and the theme
// provider rely on. Polyfill them once, globally, so component tests can mount
// Sidebar, Select, DropdownMenu, ScrollArea, etc.

// Guard for web-server.test.ts which runs in a non-jsdom fork (Node env):
// that test imports node:http and doesn't need any DOM polyfills, so we
// skip the window/DOM setup entirely when window is absent.
if (typeof window !== 'undefined' && !window.matchMedia) {
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }));
}

if (!(globalThis as { ResizeObserver?: unknown }).ResizeObserver) {
  (globalThis as { ResizeObserver?: unknown }).ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}

if (typeof AbortSignal !== 'undefined' && !AbortSignal.any) {
  AbortSignal.any = (signals: AbortSignal[]): AbortSignal => {
    const controller = new AbortController();
    const abort = () => controller.abort();
    for (const signal of signals) {
      if (signal.aborted) {
        controller.abort();
        break;
      }
      signal.addEventListener('abort', abort, { once: true });
    }
    return controller.signal;
  };
}

// Radix (Select/DropdownMenu/Dialog) calls these on elements during interaction.
// Only needed in jsdom — Element is not defined in the Node env.
if (typeof Element !== 'undefined') {
  if (!Element.prototype.scrollIntoView) {
    Element.prototype.scrollIntoView = vi.fn();
  }
  if (!Element.prototype.hasPointerCapture) {
    Element.prototype.hasPointerCapture = vi.fn(() => false);
  }
  if (!Element.prototype.setPointerCapture) {
    Element.prototype.setPointerCapture = vi.fn();
  }
  if (!Element.prototype.releasePointerCapture) {
    Element.prototype.releasePointerCapture = vi.fn();
  }
}

// jsdom exposes scrollTo but reports every call as unimplemented. Marketing
// route tests only need to observe that the reset is safe to invoke.
if (typeof window !== 'undefined') {
  window.scrollTo = vi.fn();
}

// jsdom deliberately leaves canvas rendering unimplemented and reports a
// console error every time getContext is called. Most component tests only
// need the marketing globe to degrade to its documented no-canvas state; the
// dedicated HeroGlobe suite spies on this method with a full 2D context.
if (typeof HTMLCanvasElement !== 'undefined') {
  Object.defineProperty(HTMLCanvasElement.prototype, 'getContext', {
    configurable: true,
    writable: true,
    value: vi.fn(() => null),
  });
}

// jsdom schedules an unimplemented navigation after programmatic attachment
// downloads. Cancel only anchors that explicitly carry `download`; ordinary
// router and external-link clicks retain their browser-default behavior.
if (typeof document !== 'undefined') {
  document.addEventListener('click', (event) => {
    const target = event.target;
    if (!(target instanceof Element)) return;
    const anchor = target.closest('a[download]');
    if (anchor) event.preventDefault();
  });
}
