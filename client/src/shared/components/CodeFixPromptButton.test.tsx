import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createInstance } from 'i18next';
import { I18nextProvider, initReactI18next } from 'react-i18next';
import { toast } from 'sonner';
import enCommon from '@shared/i18n/locales/en/common.json';
import arCommon from '@shared/i18n/locales/ar/common.json';
import { writeToClipboard } from '@shared/lib/clipboard';
import { CodeFixPromptButton, type CodeFixPromptInput } from './CodeFixPromptButton';

vi.mock('@shared/lib/clipboard', () => ({ writeToClipboard: vi.fn() }));
vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

const testI18n = createInstance();
const clipboard = vi.mocked(writeToClipboard);

const input: CodeFixPromptInput = {
  reference: 'title-missing-or-weak',
  problem: 'The title is missing.',
  whyItMatters: 'Search results need a useful title.',
  recommendedFix: 'Add a descriptive title.',
  affectedUrls: ['https://example.com/'],
};

function renderButton() {
  return render(
    <I18nextProvider i18n={testI18n}>
      <CodeFixPromptButton input={input} />
    </I18nextProvider>,
  );
}

beforeAll(async () => {
  await testI18n.use(initReactI18next).init({
    lng: 'en',
    fallbackLng: 'en',
    resources: {
      en: { common: enCommon },
      ar: { common: arCommon },
    },
  });
});

beforeEach(async () => {
  vi.clearAllMocks();
  await testI18n.changeLanguage('en');
});

describe('CodeFixPromptButton', () => {
  it('copies once, shows its loading state, and reports success', async () => {
    let finishCopy: ((copied: boolean) => void) | undefined;
    clipboard.mockReturnValue(
      new Promise((resolve) => {
        finishCopy = resolve;
      }),
    );
    renderButton();
    const button = screen.getByRole('button', { name: 'Copy code prompt' });

    fireEvent.click(button);
    fireEvent.click(button);

    expect(clipboard).toHaveBeenCalledOnce();
    expect(button).toBeDisabled();
    expect(button).toHaveAccessibleName('Copying prompt…');
    expect(clipboard.mock.calls[0]![0]).toContain('BEGIN_UNTRUSTED_FIX_CONTEXT');

    finishCopy!(true);
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Code-fix prompt copied.'));
    expect(button).toBeEnabled();
    expect(toast.error).not.toHaveBeenCalled();
  });

  it('shows a retryable error when clipboard access fails', async () => {
    clipboard.mockResolvedValue(false);
    renderButton();

    fireEvent.click(screen.getByRole('button', { name: 'Copy code prompt' }));

    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith('Could not copy the code-fix prompt. Try again.'),
    );
    expect(screen.getByRole('button', { name: 'Copy code prompt' })).toBeEnabled();
    expect(toast.success).not.toHaveBeenCalled();
  });

  it('uses the active RTL locale for its visible label and prompt prose', async () => {
    clipboard.mockResolvedValue(true);
    await testI18n.changeLanguage('ar');
    renderButton();

    fireEvent.click(screen.getByRole('button', { name: 'نسخ موجّه إصلاح الكود' }));

    await waitFor(() => expect(clipboard).toHaveBeenCalledOnce());
    expect(clipboard.mock.calls[0]![0]).toContain('أصلح أصغر تغيير آمن في المستودع الحالي');
  });
});
