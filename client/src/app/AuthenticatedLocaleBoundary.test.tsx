import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuthSessionState } from '@features/auth';

const authState = vi.hoisted(() => ({
  current: {
    authenticated: true,
    isPending: false,
    emailVerified: true,
    user: { id: 'user-a' } as AuthSessionState['user'],
  } as AuthSessionState,
}));
const preference = vi.hoisted(() => ({
  get: vi.fn(),
  patch: vi.fn(),
}));

vi.mock('@features/auth', () => ({
  useAuthSession: () => authState.current,
}));
vi.mock('@shared/i18n/preferenceApi', () => ({
  getLanguagePreference: preference.get,
  patchLanguagePreference: preference.patch,
}));
vi.mock('sonner', () => ({ toast: { error: vi.fn() } }));

import { toast } from 'sonner';
import { AuthenticatedLocaleBoundary } from './AuthenticatedLocaleBoundary';
import { LanguageSwitcher } from '@shared/i18n/LanguageSwitcher';
import { changeLanguage, i18n, initI18n } from '@shared/i18n';
import { useLocaleContext } from '@shared/i18n/LocaleContext';

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason: unknown) => void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const Harness = () => (
  <I18nextProvider i18n={i18n}>
    <AuthenticatedLocaleBoundary>
      <span>ready</span>
      <LanguageSwitcher />
    </AuthenticatedLocaleBoundary>
  </I18nextProvider>
);

const DirectLocaleChange = ({ locale }: { locale: string }) => {
  const { changeLocale } = useLocaleContext();
  return <button onClick={() => void changeLocale(locale as never)}>direct locale</button>;
};

beforeEach(async () => {
  initI18n({ initialLocale: 'en' });
  await changeLanguage('en');
  document.cookie = 'lang=; Max-Age=0; path=/';
  document.documentElement.lang = 'en';
  document.documentElement.dir = 'ltr';
  authState.current = {
    authenticated: true,
    isPending: false,
    emailVerified: true,
    user: { id: 'user-a' } as AuthSessionState['user'],
  };
  preference.get.mockReset();
  preference.patch.mockReset();
  vi.mocked(toast.error).mockReset();
});

describe('AuthenticatedLocaleBoundary', () => {
  it('initializes a null preference once and applies the database winner', async () => {
    preference.get.mockResolvedValue({ language: null });
    preference.patch.mockResolvedValue({ language: 'ar' });

    render(<Harness />);
    expect(screen.queryByText('ready')).not.toBeInTheDocument();
    expect(await screen.findByText('ready')).toBeInTheDocument();

    expect(preference.patch).toHaveBeenCalledOnce();
    expect(preference.patch).toHaveBeenCalledWith(
      'en',
      expect.objectContaining({ ifUnset: true, signal: expect.any(AbortSignal) }),
    );
    expect(i18n.resolvedLanguage).toBe('ar');
    expect(document.documentElement.lang).toBe('ar');
    expect(document.documentElement.dir).toBe('rtl');
  });

  it('falls back to English when the browser-resolved locale is unsupported', async () => {
    const read = deferred<{ language: null }>();
    preference.get.mockReturnValue(read.promise);
    preference.patch.mockResolvedValue({ language: 'en' });

    render(<Harness />);
    await waitFor(() => expect(preference.get).toHaveBeenCalledOnce());
    Reflect.set(i18n, 'resolvedLanguage', 'pt');
    read.resolve({ language: null });
    await waitFor(() => expect(preference.patch).toHaveBeenCalledWith(
      'en',
      expect.objectContaining({ ifUnset: true }),
    ));
  });

  it('does not publish readiness when hydration is aborted during language application', async () => {
    preference.get.mockResolvedValue({ language: 'ar' });
    const languageChange = deferred<void>();
    const localeModule = await import('@shared/i18n');
    const changeSpy = vi.spyOn(localeModule, 'changeLanguage').mockReturnValueOnce(
      languageChange.promise,
    );
    const view = render(<Harness />);
    await waitFor(() => expect(changeSpy).toHaveBeenCalledWith('ar'));
    view.unmount();
    languageChange.resolve();
    await act(async () => languageChange.promise);
    expect(screen.queryByText('ready')).not.toBeInTheDocument();
    changeSpy.mockRestore();
  });

  it('refuses an unsupported compare-and-set winner', async () => {
    preference.get.mockResolvedValue({ language: null });
    preference.patch.mockResolvedValue({ language: 'pt' });
    const view = render(<Harness />);
    await waitFor(() => expect(preference.patch).toHaveBeenCalledOnce());
    expect(screen.queryByText('ready')).not.toBeInTheDocument();
    view.unmount();
  });

  it('does not mark an aborted preference read as ready', async () => {
    preference.get.mockRejectedValue(new DOMException('aborted', 'AbortError'));
    const view = render(<Harness />);
    await waitFor(() => expect(preference.get).toHaveBeenCalledOnce());
    expect(screen.queryByText('ready')).not.toBeInTheDocument();
    view.unmount();
  });

  it('hydrates an existing preference without repeating initialization', async () => {
    preference.get.mockResolvedValue({ language: 'de' });
    render(<Harness />);
    expect(await screen.findByText('ready')).toBeInTheDocument();
    expect(i18n.resolvedLanguage).toBe('de');
    expect(preference.patch).not.toHaveBeenCalled();
  });

  it('persists a successful authenticated switch and applies the stored winner', async () => {
    preference.get.mockResolvedValue({ language: 'en' });
    preference.patch.mockResolvedValue({ language: 'ar' });
    render(<Harness />);
    const select = await screen.findByLabelText('Language') as HTMLSelectElement;
    fireEvent.change(select, { target: { value: 'ar' } });
    await waitFor(() => expect(i18n.resolvedLanguage).toBe('ar'));
    expect(preference.patch).toHaveBeenLastCalledWith(
      'ar',
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    expect(select).not.toBeDisabled();
  });

  it('rolls back when a successful response contains an unsupported winner', async () => {
    preference.get.mockResolvedValue({ language: 'en' });
    preference.patch.mockResolvedValue({ language: 'pt' });
    render(<Harness />);
    const select = await screen.findByLabelText('Language') as HTMLSelectElement;
    fireEvent.change(select, { target: { value: 'ar' } });
    await waitFor(() => expect(toast.error).toHaveBeenCalledOnce());
    expect(i18n.resolvedLanguage).toBe('en');
  });

  it('discards a stale GET when the authenticated principal changes', async () => {
    const oldGet = deferred<{ language: 'ar' }>();
    preference.get
      .mockImplementationOnce(() => oldGet.promise)
      .mockResolvedValueOnce({ language: 'fr' });
    const view = render(<Harness />);

    authState.current = {
      authenticated: true,
      isPending: false,
      emailVerified: true,
      user: { id: 'user-b' } as AuthSessionState['user'],
    };
    view.rerender(<Harness />);
    expect(await screen.findByText('ready')).toBeInTheDocument();
    expect(i18n.resolvedLanguage).toBe('fr');

    oldGet.resolve({ language: 'ar' });
    await act(async () => oldGet.promise);
    expect(i18n.resolvedLanguage).toBe('fr');
  });

  it('resets on logout and hydrates a later account independently', async () => {
    preference.get.mockResolvedValueOnce({ language: 'de' });
    const view = render(<Harness />);
    expect(await screen.findByText('ready')).toBeInTheDocument();
    expect(i18n.resolvedLanguage).toBe('de');

    authState.current = {
      authenticated: false,
      isPending: false,
      emailVerified: false,
      user: null,
    };
    view.rerender(<Harness />);
    expect(screen.getByText('ready')).toBeInTheDocument();

    preference.get.mockResolvedValueOnce({ language: 'zh' });
    authState.current = {
      authenticated: true,
      isPending: false,
      emailVerified: true,
      user: { id: 'user-b' } as AuthSessionState['user'],
    };
    view.rerender(<Harness />);
    await waitFor(() => expect(i18n.resolvedLanguage).toBe('zh'));
    expect(preference.get).toHaveBeenCalledTimes(2);
  });

  it('optimistically switches, serializes selection, and rolls back with restored copy', async () => {
    preference.get.mockResolvedValue({ language: 'en' });
    const save = deferred<{ language: 'ar' }>();
    preference.patch.mockImplementation(() => save.promise);
    render(<Harness />);
    const select = await screen.findByLabelText('Language') as HTMLSelectElement;

    fireEvent.change(select, { target: { value: 'ar' } });
    await waitFor(() => expect(i18n.resolvedLanguage).toBe('ar'));
    expect(select).toBeDisabled();
    fireEvent.change(select, { target: { value: 'fr' } });
    expect(preference.patch).toHaveBeenCalledOnce();

    save.reject(new Error('offline'));
    await waitFor(() => expect(i18n.resolvedLanguage).toBe('en'));
    expect(document.documentElement.lang).toBe('en');
    expect(document.documentElement.dir).toBe('ltr');
    expect(document.cookie).toContain('lang=en');
    expect(toast.error).toHaveBeenCalledWith(
      "We couldn't save your language. Your previous language has been restored.",
    );
    expect(select).not.toBeDisabled();
  });

  it('prevents a stale PATCH from overwriting a newer principal hydration', async () => {
    preference.get
      .mockResolvedValueOnce({ language: 'en' })
      .mockResolvedValueOnce({ language: 'de' });
    const oldPatch = deferred<{ language: 'ar' }>();
    preference.patch.mockImplementationOnce(() => oldPatch.promise);
    const view = render(<Harness />);
    const select = await screen.findByLabelText('Language') as HTMLSelectElement;
    fireEvent.change(select, { target: { value: 'ar' } });
    await waitFor(() => expect(i18n.resolvedLanguage).toBe('ar'));

    authState.current = {
      authenticated: true,
      isPending: false,
      emailVerified: true,
      user: { id: 'user-b' } as AuthSessionState['user'],
    };
    view.rerender(<Harness />);
    await waitFor(() => expect(i18n.resolvedLanguage).toBe('de'));
    oldPatch.resolve({ language: 'ar' });
    await act(async () => oldPatch.promise);
    expect(i18n.resolvedLanguage).toBe('de');
  });

  it('ignores a stale rejected PATCH after a principal change', async () => {
    preference.get
      .mockResolvedValueOnce({ language: 'en' })
      .mockResolvedValueOnce({ language: 'de' });
    const oldPatch = deferred<{ language: 'ar' }>();
    preference.patch.mockImplementationOnce(() => oldPatch.promise);
    const view = render(<Harness />);
    fireEvent.change(await screen.findByLabelText('Language'), {
      target: { value: 'ar' },
    });

    authState.current = {
      authenticated: true,
      isPending: false,
      emailVerified: true,
      user: { id: 'user-b' } as AuthSessionState['user'],
    };
    view.rerender(<Harness />);
    await waitFor(() => expect(i18n.resolvedLanguage).toBe('de'));
    oldPatch.reject(new Error('late failure'));
    await act(async () => oldPatch.promise.catch(() => undefined));
    expect(i18n.resolvedLanguage).toBe('de');
    expect(toast.error).not.toHaveBeenCalled();
  });

  it('ignores a stale compare-and-set winner after a principal change', async () => {
    const oldWinner = deferred<{ language: 'ar' }>();
    preference.get
      .mockResolvedValueOnce({ language: null })
      .mockResolvedValueOnce({ language: 'fr' });
    preference.patch.mockImplementationOnce(() => oldWinner.promise);
    const view = render(<Harness />);
    await waitFor(() => expect(preference.patch).toHaveBeenCalledOnce());

    authState.current = {
      authenticated: true,
      isPending: false,
      emailVerified: true,
      user: { id: 'user-b' } as AuthSessionState['user'],
    };
    view.rerender(<Harness />);
    await waitFor(() => expect(i18n.resolvedLanguage).toBe('fr'));
    oldWinner.resolve({ language: 'ar' });
    await act(async () => oldWinner.promise);
    expect(i18n.resolvedLanguage).toBe('fr');
  });

  it('keeps unauthenticated switching immediate and cookie-only', async () => {
    authState.current = {
      authenticated: false,
      isPending: false,
      emailVerified: false,
      user: null,
    };
    render(<Harness />);
    const select = screen.getByLabelText('Language') as HTMLSelectElement;
    fireEvent.change(select, { target: { value: 'ar' } });
    await waitFor(() => expect(i18n.resolvedLanguage).toBe('ar'));
    expect(document.cookie).toContain('lang=ar');
    expect(document.documentElement.dir).toBe('rtl');
    expect(preference.get).not.toHaveBeenCalled();
    expect(preference.patch).not.toHaveBeenCalled();
  });

  it('treats a repeated selection as a no-op and aborts hydration on unmount', async () => {
    const pending = deferred<{ language: 'en' }>();
    let signal: AbortSignal | undefined;
    preference.get.mockImplementation((nextSignal: AbortSignal) => {
      signal = nextSignal;
      return pending.promise;
    });
    const view = render(<Harness />);
    view.unmount();
    expect(signal?.aborted).toBe(true);

    authState.current = {
      authenticated: false,
      isPending: false,
      emailVerified: false,
      user: null,
    };
    render(<Harness />);
    fireEvent.change(screen.getByLabelText('Language'), { target: { value: 'en' } });
    expect(preference.patch).not.toHaveBeenCalled();
  });

  it('does not strand product paint when preference loading fails', async () => {
    preference.get.mockRejectedValue(new Error('offline'));
    render(<Harness />);
    expect(await screen.findByText('ready')).toBeInTheDocument();
    expect(i18n.resolvedLanguage).toBe('en');
  });

  it('rejects unsupported direct context values before storage', async () => {
    preference.get.mockResolvedValue({ language: 'en' });
    render(
      <I18nextProvider i18n={i18n}>
        <AuthenticatedLocaleBoundary>
          <DirectLocaleChange locale="pt" />
        </AuthenticatedLocaleBoundary>
      </I18nextProvider>,
    );
    fireEvent.click(await screen.findByRole('button', { name: 'direct locale' }));
    expect(preference.patch).not.toHaveBeenCalled();
    expect(i18n.resolvedLanguage).toBe('en');
  });

  it('does not block while the session is pending or when an authenticated user has no id', () => {
    authState.current = {
      authenticated: true,
      isPending: true,
      emailVerified: true,
      user: null,
    };
    const view = render(<Harness />);
    expect(screen.getByText('ready')).toBeInTheDocument();
    expect(preference.get).not.toHaveBeenCalled();

    authState.current = { ...authState.current, isPending: false };
    view.rerender(<Harness />);
    expect(screen.getByText('ready')).toBeInTheDocument();
    expect(preference.get).not.toHaveBeenCalled();
  });

  it('keeps the server render path free of session effects', () => {
    const originalWindow = globalThis.window;
    vi.stubGlobal('window', undefined);
    expect(AuthenticatedLocaleBoundary({ children: <span>server child</span> })).toBeTruthy();
    vi.stubGlobal('window', originalWindow);
    expect(preference.get).not.toHaveBeenCalled();
  });
});
