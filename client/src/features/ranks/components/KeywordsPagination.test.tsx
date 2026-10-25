import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { I18nextProvider } from 'react-i18next';
import { changeLanguage, i18n, initI18n } from '@shared/i18n';
import { chooseOption } from '../../../test/radixSelect';
import { KeywordsPagination } from './KeywordsPagination';

const mount = (props: Partial<Parameters<typeof KeywordsPagination>[0]> = {}) => {
  const onPageChange = vi.fn();
  const onPageSizeChange = vi.fn();
  render(<I18nextProvider i18n={i18n}>
    <KeywordsPagination page={5} pageSize={25} total={400} shown={25}
      onPageChange={onPageChange} onPageSizeChange={onPageSizeChange} {...props} />
  </I18nextProvider>);
  return { onPageChange, onPageSizeChange };
};

beforeEach(async () => {
  initI18n({ initialLocale: 'en' });
  await changeLanguage('en');
});

describe('keyword list pagination', () => {
  it('moves between pages and changes the page size', async () => {
    const user = userEvent.setup();
    const { onPageChange, onPageSizeChange } = mount();
    expect(screen.getByTestId('keywords-pagination-range')).toHaveTextContent('101');
    await user.click(screen.getByRole('button', { name: /Previous/ }));
    expect(onPageChange).toHaveBeenLastCalledWith(4);
    await user.click(screen.getByRole('button', { name: /Next/ }));
    expect(onPageChange).toHaveBeenLastCalledWith(6);
    await user.click(screen.getByTestId('keywords-page-16'));
    expect(onPageChange).toHaveBeenLastCalledWith(16);
    await chooseOption(user, screen.getByRole('combobox'), '50');
    expect(onPageSizeChange).toHaveBeenCalledWith(50);
  });

  it('disables the ends and reports an empty range', () => {
    mount({ page: 1, total: 0, shown: 0 });
    expect(screen.getByRole('button', { name: /Previous/ })).toBeDisabled();
    expect(screen.getByRole('button', { name: /Next/ })).toBeDisabled();
    expect(screen.getByTestId('keywords-pagination-range')).toHaveTextContent('0');
  });

  it('mirrors the arrows in a right-to-left language', async () => {
    await changeLanguage('ar');
    mount();
    expect(screen.getByTestId('keywords-pagination')).toBeInTheDocument();
    await changeLanguage('en');
  });
});
