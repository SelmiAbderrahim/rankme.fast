import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { I18nextProvider } from 'react-i18next';
import { changeLanguage, i18n, initI18n } from '@shared/i18n';
import * as api from '../api';
import type { LocalizedFinding } from '../types';
import { NotApplicableSection } from './NotApplicableSection';
import { ComparisonBadge, urlComparisonStatus } from './ComparisonBadge';

vi.mock('../api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api')>()),
  markLocalBusinessRequest: vi.fn(),
}));

const mocked = vi.mocked(api);

const finding = (ruleId: string, title: string): LocalizedFinding => ({
  ruleId,
  bucket: 'watch',
  notEvaluated: true,
  severity: 'warning',
  affectedUrls: [],
  applicability: 'not_applicable',
  meta: { insufficientData: true, reason: 'not-configured' },
  copy: {
    title,
    why: 'Why',
    fix: 'Fix',
    passedLabel: 'Passed',
    titleKey: `auditRules.${ruleId}.title`,
    whyKey: `auditRules.${ruleId}.why`,
    fixKey: `auditRules.${ruleId}.fix`,
    passedLabelKey: `auditRules.${ruleId}.passedLabel`,
  },
});

const findings = [finding('nap-inconsistency', 'Business details differ'), finding('low-review-count', 'Few reviews')];

const show = (items: LocalizedFinding[], onChanged = vi.fn()) => {
  render(
    <I18nextProvider i18n={i18n}>
      <NotApplicableSection findings={items} siteId="site-1" onChanged={onChanged} />
    </I18nextProvider>,
  );
  return onChanged;
};

beforeEach(async () => {
  initI18n({ initialLocale: 'en' });
  await changeLanguage('en');
  mocked.markLocalBusinessRequest.mockReset();
});

describe('NotApplicableSection', () => {
  it('renders nothing when every check applies', () => {
    show([]);
    expect(screen.queryByTestId('report-not-applicable')).toBeNull();
  });

  it('is a collapsed, neutral group listing the checks with their count', async () => {
    show(findings);
    const trigger = screen.getByRole('button', { name: /Not applicable to this site/ });
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    expect(trigger).toHaveTextContent('(2)');
    await userEvent.click(trigger);
    expect(screen.getAllByTestId('report-not-applicable-item').map((item) => item.textContent)).toEqual([
      'Business details differ',
      'Few reviews',
    ]);
  });

  it('marks the site as a local business and asks the page to reload the report', async () => {
    mocked.markLocalBusinessRequest.mockResolvedValue({});
    const onChanged = show(findings);
    await userEvent.click(screen.getByRole('button', { name: /Not applicable to this site/ }));
    await userEvent.click(screen.getByTestId('report-not-applicable-opt-in'));
    expect(mocked.markLocalBusinessRequest).toHaveBeenCalledWith('site-1');
    expect(onChanged).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId('report-not-applicable-error')).toBeNull();
  });

  it('says so when the opt-in fails and keeps the report as it is', async () => {
    mocked.markLocalBusinessRequest.mockRejectedValue(new Error('offline'));
    const onChanged = show(findings);
    await userEvent.click(screen.getByRole('button', { name: /Not applicable to this site/ }));
    await userEvent.click(screen.getByTestId('report-not-applicable-opt-in'));
    expect(await screen.findByTestId('report-not-applicable-error')).toHaveTextContent("We couldn't save that. Try again.");
    expect(onChanged).not.toHaveBeenCalled();
    expect(screen.getByTestId('report-not-applicable-opt-in')).not.toBeDisabled();
  });

  it('renders in Arabic', async () => {
    await changeLanguage('ar');
    show(findings);
    expect(screen.getByRole('button', { name: /لا ينطبق على هذا الموقع/ })).toBeInTheDocument();
  });
});

describe('ComparisonBadge', () => {
  it.each(['new', 'regressed', 'improved', 'resolved', 'not_comparable'] as const)('renders %s as text plus a description', (status) => {
    render(
      <I18nextProvider i18n={i18n}>
        <ComparisonBadge status={status} />
      </I18nextProvider>,
    );
    const badge = screen.getByTestId(`report-comparison-${status}`);
    expect(badge).toHaveAttribute('title', i18n.t(`report:comparison.description.${status}`));
    expect(badge.querySelector('.sr-only')).toHaveTextContent(i18n.t(`report:comparison.description.${status}`));
  });

  it('renders nothing for unchanged or no status', () => {
    const { container } = render(
      <I18nextProvider i18n={i18n}>
        <ComparisonBadge status="unchanged" />
        <ComparisonBadge status={undefined} />
      </I18nextProvider>,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('maps per-URL diff kinds onto the same vocabulary', () => {
    expect(urlComparisonStatus('fixed')).toBe('resolved');
    expect(urlComparisonStatus('regressed')).toBe('regressed');
    expect(urlComparisonStatus('new')).toBe('new');
    expect(urlComparisonStatus('unchanged')).toBeUndefined();
    expect(urlComparisonStatus(undefined)).toBeUndefined();
  });
});
