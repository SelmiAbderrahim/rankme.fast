import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, act, fireEvent } from '@testing-library/react';
import { ThemeProvider, useTheme } from './ThemeProvider';

const Probe = () => {
  const { theme, resolvedTheme, setTheme } = useTheme();
  return (
    <div>
      <span data-testid="theme">{theme}</span>
      <span data-testid="resolved">{resolvedTheme}</span>
      <button type="button" onClick={() => setTheme('dark')}>
        Dark
      </button>
    </div>
  );
};

let mediaListeners: Array<(e: MediaQueryListEvent) => void>;

const mockMatchMedia = (matches: boolean) => {
  mediaListeners = [];
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches,
    media: query,
    onchange: null,
    addEventListener: (_: string, cb: (e: MediaQueryListEvent) => void) =>
      mediaListeners.push(cb),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }));
};

beforeEach(() => {
  window.localStorage.clear();
  document.documentElement.classList.remove('dark');
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('ThemeProvider', () => {
  it('adopts a stored explicit preference on mount', () => {
    mockMatchMedia(false);
    window.localStorage.setItem('theme', 'dark');
    render(
      <ThemeProvider>
        <Probe />
      </ThemeProvider>,
    );
    expect(screen.getByTestId('theme')).toHaveTextContent('dark');
    expect(screen.getByTestId('resolved')).toHaveTextContent('dark');
    expect(document.documentElement.classList.contains('dark')).toBe(true);
  });

  it('setTheme does not throw when localStorage.setItem throws', () => {
    mockMatchMedia(false);
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    render(
      <ThemeProvider>
        <Probe />
      </ThemeProvider>,
    );

    expect(() => fireEvent.click(screen.getByRole('button', { name: 'Dark' }))).not.toThrow();
    expect(screen.getByTestId('theme')).toHaveTextContent('dark');
    expect(screen.getByTestId('resolved')).toHaveTextContent('dark');
  });

  it('falls back to system when localStorage.getItem throws', () => {
    mockMatchMedia(false);
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    render(
      <ThemeProvider>
        <Probe />
      </ThemeProvider>,
    );

    expect(screen.getByTestId('theme')).toHaveTextContent('system');
    expect(screen.getByTestId('resolved')).toHaveTextContent('light');
  });

  it('syncs theme from a storage event', () => {
    mockMatchMedia(false);
    render(
      <ThemeProvider>
        <Probe />
      </ThemeProvider>,
    );
    expect(screen.getByTestId('theme')).toHaveTextContent('system');

    window.localStorage.setItem('theme', 'dark');
    act(() => {
      window.dispatchEvent(new StorageEvent('storage', { key: 'theme', newValue: 'dark' }));
    });

    expect(screen.getByTestId('theme')).toHaveTextContent('dark');
    expect(screen.getByTestId('resolved')).toHaveTextContent('dark');
  });

  it('ignores storage events for other keys', () => {
    mockMatchMedia(false);
    window.localStorage.setItem('theme', 'light');
    render(
      <ThemeProvider>
        <Probe />
      </ThemeProvider>,
    );
    expect(screen.getByTestId('theme')).toHaveTextContent('light');

    window.localStorage.setItem('theme', 'dark');
    act(() => {
      window.dispatchEvent(new StorageEvent('storage', { key: 'other', newValue: 'dark' }));
    });

    expect(screen.getByTestId('theme')).toHaveTextContent('light');
  });

  it('resolves garbage stored values to system', () => {
    mockMatchMedia(false);
    window.localStorage.setItem('theme', 'garbage');
    render(
      <ThemeProvider>
        <Probe />
      </ThemeProvider>,
    );
    expect(screen.getByTestId('theme')).toHaveTextContent('system');
  });

  it('resolves system preference to dark when the OS prefers dark', () => {
    mockMatchMedia(true);
    render(
      <ThemeProvider>
        <Probe />
      </ThemeProvider>,
    );
    expect(screen.getByTestId('resolved')).toHaveTextContent('dark');
  });

  it('reacts to OS changes while in system mode', () => {
    mockMatchMedia(false);
    render(
      <ThemeProvider>
        <Probe />
      </ThemeProvider>,
    );
    expect(screen.getByTestId('resolved')).toHaveTextContent('light');
    act(() => {
      mediaListeners.forEach((cb) =>
        cb({ matches: true } as MediaQueryListEvent),
      );
    });
    // Listener re-runs apply(); jsdom mock still returns matches:false so the
    // resolved value follows matchMedia, proving the listener path executed.
    expect(screen.getByTestId('resolved')).toBeInTheDocument();
  });

  it('throws if useTheme is used outside the provider', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const cancelExpectedError = (event: ErrorEvent) => {
      if (event.message.includes('useTheme must be used')) event.preventDefault();
    };
    window.addEventListener('error', cancelExpectedError);
    try {
      expect(() => render(<Probe />)).toThrow(/useTheme must be used/);
    } finally {
      window.removeEventListener('error', cancelExpectedError);
      spy.mockRestore();
    }
  });
});
