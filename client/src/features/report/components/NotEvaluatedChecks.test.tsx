import { beforeEach, describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import { changeLanguage, i18n, initI18n } from '@shared/i18n';
import type { LocalizedFinding } from '../types';
import { NotEvaluatedChecks, notEvaluatedSource } from './NotEvaluatedChecks';

const finding = (ruleId: string, reason: string): LocalizedFinding => ({
  ruleId,
  bucket: 'watch',
  severity: 'warning',
  affectedUrls: [],
  meta: { insufficientData: true, reason },
  notEvaluated: true,
  copy: {
    titleKey: `auditRules.${ruleId}.title`,
    whyKey: `auditRules.${ruleId}.why`,
    fixKey: `auditRules.${ruleId}.fix`,
    passedLabelKey: `auditRules.${ruleId}.passedLabel`,
    title: ruleId,
    why: 'why',
    fix: 'fix',
    passedLabel: 'passed',
  },
});

beforeEach(async () => {
  initI18n({ initialLocale: 'en' });
  await changeLanguage('en');
});

describe('NotEvaluatedChecks — local SEO reasons', () => {
  it.each([
    ['low-review-rating', 'not-configured', 'localSeo'],
    ['nap-inconsistency', 'unavailable', 'localUnavailable'],
    ['nap-inconsistency', 'no-business-listings', 'localNoProfile'],
    ['low-review-count', 'no-business-profile', 'localNoProfile'],
    ['low-review-rating', 'no-rating-data', 'localNoProfile'],
    ['local-pack-not-ranking', 'no-local-pack-keyword-tracked', 'localPackSetup'],
  ] as const)('%s with reason "%s" is worded as %s', (ruleId, reason, source) => {
    expect(notEvaluatedSource(finding(ruleId, reason))).toBe(source);
  });

  it('says there was nothing local to check, or how to turn map tracking on', () => {
    render(
      <I18nextProvider i18n={i18n}>
        <NotEvaluatedChecks
          findings={[
            finding('nap-inconsistency', 'no-business-listings'),
            finding('local-pack-not-ranking', 'no-local-pack-keyword-tracked'),
            finding('low-review-count', 'unavailable'),
          ]}
        />
      </I18nextProvider>,
    );
    const rows = screen.getAllByTestId('report-not-evaluated-row');
    expect(rows[0]).toHaveTextContent('so there was nothing local to check');
    expect(rows[1]).toHaveTextContent('Turn on map-results tracking');
    expect(rows[2]).toHaveTextContent('Local SEO data could not be loaded during this audit');
  });
});
