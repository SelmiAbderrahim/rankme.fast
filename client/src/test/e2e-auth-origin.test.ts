import { afterEach, expect, it, vi } from 'vitest';
import type { Page } from '@playwright/test';
import { logIn, signUp } from '../../e2e/helpers/account';

afterEach(() => vi.unstubAllEnvs());

it.each([signUp, logIn])(
  'refuses credentials after an external authentication redirect',
  async (authenticate) => {
    vi.stubEnv('CLIENT_URL', 'http://127.0.0.1:43011');
    const page = {
      goto: vi.fn().mockResolvedValue(undefined),
      url: () => 'https://app.example/register',
      locator: vi.fn(),
    };
    await expect(
      authenticate(page as unknown as Page, {
        email: 'origin-check@rankme.test',
        password: 'not-submitted',
      }),
    ).rejects.toThrow('outside the isolated app origin');
    expect(page.locator).not.toHaveBeenCalled();
  },
);
