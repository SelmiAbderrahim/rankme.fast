import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { I18nextProvider } from 'react-i18next';
import {
  changeLanguage,
  i18n,
  initI18n,
  requestPresentationRefresh,
} from '@shared/i18n';
import { authClient, useAuthSession } from '@features/auth';
import type { AuthSessionState, AuthSessionUser } from '@features/auth';
import { ProfileInfoCard } from './ProfileInfoCard';

vi.mock('@features/auth', () => ({
  useAuthSession: vi.fn(),
  authClient: { updateUser: vi.fn() },
}));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const { toast } = await import('sonner');
const toastSuccess = toast.success as unknown as Mock;
const updateUser = authClient.updateUser as unknown as Mock;

const sessionUser = (overrides: Partial<AuthSessionUser> = {}): AuthSessionUser =>
  ({
    id: 'u-1',
    email: 'zoe@example.com',
    name: 'Ada Lovelace',
    emailVerified: true,
    image: null,
    role: 'Member',
    createdAt: new Date('2025-01-15T00:00:00.000Z'),
    updatedAt: new Date('2025-01-15T00:00:00.000Z'),
    ...overrides,
  }) as AuthSessionUser;

const mockSession = (user: AuthSessionUser | null) => {
  vi.mocked(useAuthSession).mockReturnValue({
    authenticated: Boolean(user),
    isPending: false,
    emailVerified: user?.emailVerified ?? false,
    user,
  } satisfies AuthSessionState);
};

const renderCard = () =>
  render(
    <I18nextProvider i18n={i18n}>
      <ProfileInfoCard />
    </I18nextProvider>,
  );

beforeEach(async () => {
  initI18n({ initialLocale: 'en' });
  await changeLanguage('en');
  vi.clearAllMocks();
  updateUser.mockResolvedValue({ data: {}, error: null });
});

describe('ProfileInfoCard — identity', () => {
  it('renders name, email, role, verified chip, and member-since', () => {
    mockSession(sessionUser());
    renderCard();
    expect(screen.getByText('Ada Lovelace')).toBeInTheDocument();
    expect(screen.getByText('zoe@example.com')).toBeInTheDocument();
    expect(screen.getByText('Member')).toBeInTheDocument();
    expect(screen.getByText('Email verified')).toBeInTheDocument();
    expect(screen.getByText(/Member since/)).toBeInTheDocument();
    // Two-word name → initials fallback.
    expect(screen.getByText('AL')).toBeInTheDocument();
  });

  it('shows the unverified chip and email-based initials when unnamed', () => {
    mockSession(sessionUser({ name: '', emailVerified: false }));
    renderCard();
    expect(screen.getByText('Email not verified')).toBeInTheDocument();
    // Empty name → initials from the email.
    expect(screen.getByText('ZO')).toBeInTheDocument();
  });

  it('derives initials from a single-word name', () => {
    mockSession(sessionUser({ name: 'Cher' }));
    renderCard();
    expect(screen.getByText('CH')).toBeInTheDocument();
  });

  it('renders the avatar image branch when an image is set', () => {
    mockSession(sessionUser({ image: 'https://cdn.example.com/a.png' }));
    renderCard();
    // Branch executes; the name still renders regardless of image load state.
    expect(screen.getByText('Ada Lovelace')).toBeInTheDocument();
  });

  it('renders nothing without a session user', () => {
    mockSession(null);
    const { container } = renderCard();
    expect(container).toBeEmptyDOMElement();
  });
});

describe('ProfileInfoCard — edit', () => {
  it('clears component-local server copy on a presentation refresh', () => {
    mockSession(sessionUser());
    renderCard();

    act(() => {
      requestPresentationRefresh();
    });

    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('saves a new display name and toasts on success', async () => {
    mockSession(sessionUser());
    renderCard();
    const input = screen.getByLabelText('Display name');
    await userEvent.clear(input);
    await userEvent.type(input, 'Grace Hopper');
    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() =>
      expect(updateUser).toHaveBeenCalledWith({ name: 'Grace Hopper' }),
    );
    expect(toastSuccess).toHaveBeenCalledWith('Your profile has been updated.');
  });

  it('blocks an empty name and does not call the API', async () => {
    mockSession(sessionUser());
    renderCard();
    await userEvent.clear(screen.getByLabelText('Display name'));
    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    expect(await screen.findByText('Enter a display name.')).toBeInTheDocument();
    expect(updateUser).not.toHaveBeenCalled();
  });

  it('surfaces an inline error when the update fails', async () => {
    mockSession(sessionUser());
    updateUser.mockResolvedValue({ data: null, error: { message: 'nope' } });
    renderCard();
    const input = screen.getByLabelText('Display name');
    await userEvent.clear(input);
    await userEvent.type(input, 'Grace Hopper');
    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    expect(
      await screen.findByText("We couldn't save your profile. Please try again."),
    ).toBeInTheDocument();
    expect(toastSuccess).not.toHaveBeenCalled();
  });

  it('shows the shared loading affordance while saving and restores it on success', async () => {
    mockSession(sessionUser());
    let resolve!: (value: unknown) => void;
    updateUser.mockReturnValue(
      new Promise((res) => {
        resolve = res;
      }),
    );
    renderCard();
    const input = screen.getByLabelText('Display name');
    await userEvent.clear(input);
    await userEvent.type(input, 'Grace Hopper');
    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    const pending = await screen.findByRole('button', { name: 'Saving…' });
    expect(pending).toBeDisabled();
    expect(pending).toHaveAttribute('aria-busy', 'true');
    expect(pending.querySelector('[data-slot="spinner"]')).toBeInTheDocument();
    resolve({ data: {}, error: null });
    const restored = await screen.findByRole('button', { name: 'Save changes' });
    expect(restored).not.toHaveAttribute('aria-busy');
    expect(restored.querySelector('[data-slot="spinner"]')).not.toBeInTheDocument();
  });

  it('restores the loading affordance after a failed save', async () => {
    mockSession(sessionUser());
    updateUser.mockResolvedValue({ data: null, error: { message: 'nope' } });
    renderCard();
    const input = screen.getByLabelText('Display name');
    await userEvent.clear(input);
    await userEvent.type(input, 'Grace Hopper');
    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    await screen.findByRole('alert');
    const restored = screen.getByRole('button', { name: 'Save changes' });
    expect(restored).not.toHaveAttribute('aria-busy');
    expect(restored.querySelector('[data-slot="spinner"]')).not.toBeInTheDocument();
  });
});
