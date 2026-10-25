import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { I18nextProvider } from 'react-i18next';
import { changeLanguage, i18n, initI18n } from '@shared/i18n';
import { ResourceScanOption, RESOURCE_SCAN_MAX_PAGES } from './ResourceScanOption';

beforeAll(async () => {
  await initI18n();
  await changeLanguage('en');
});

function renderOption(props: Partial<React.ComponentProps<typeof ResourceScanOption>> = {}) {
  const onCheckedChange = vi.fn();
  render(
    <I18nextProvider i18n={i18n}>
      <ResourceScanOption checked onCheckedChange={onCheckedChange} pageLimit={100} {...props} />
    </I18nextProvider>,
  );
  return { onCheckedChange };
}

describe('ResourceScanOption', () => {
  it('describes the scan and its page limit', () => {
    renderOption();
    expect(screen.getByLabelText('Scan images, scripts and styles')).toBeChecked();
    expect(screen.getByText(/limits the audit to 1,000 pages/)).toBeInTheDocument();
    expect(screen.queryByTestId('report-resource-scan-note')).toBeNull();
  });

  it('reports a change of the checkbox', async () => {
    const { onCheckedChange } = renderOption();
    await userEvent.setup().click(screen.getByTestId('report-resource-scan'));
    expect(onCheckedChange).toHaveBeenCalledWith(false);
  });

  it('keeps a page limit at the scan limit without a note', () => {
    renderOption({ pageLimit: RESOURCE_SCAN_MAX_PAGES });
    expect(screen.queryByTestId('report-resource-scan-note')).toBeNull();
  });

  it('warns that a ticked scan crawls at most the scan limit when the page limit is higher or the maximum', () => {
    const { unmount } = render(
      <I18nextProvider i18n={i18n}>
        <ResourceScanOption checked onCheckedChange={vi.fn()} pageLimit={RESOURCE_SCAN_MAX_PAGES + 1} />
      </I18nextProvider>,
    );
    expect(screen.getByTestId('report-resource-scan-note')).toHaveTextContent(
      'This audit will crawl at most 1,000 pages. Untick the scan to crawl more.',
    );
    unmount();
    renderOption({ pageLimit: null });
    expect(screen.getByTestId('report-resource-scan-note')).toBeInTheDocument();
  });

  it('shows no note once the scan is unticked, and disables the box while a run is starting', () => {
    renderOption({ checked: false, pageLimit: null, disabled: true });
    expect(screen.queryByTestId('report-resource-scan-note')).toBeNull();
    expect(screen.getByTestId('report-resource-scan')).toBeDisabled();
  });
});
