import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import { MemoryRouter } from 'react-router-dom';
import { changeLanguage, i18n, initI18n } from '@shared/i18n';
import { AiVisibilityBlock } from './AiVisibilityBlock';
import type { AiVisibilitySection } from '../types';

const wrap = (ui: React.ReactNode) =>
  render(
    <I18nextProvider i18n={i18n}>
      <MemoryRouter>{ui}</MemoryRouter>
    </I18nextProvider>,
  );

const okSection = (overrides: Partial<AiVisibilitySection> = {}): AiVisibilitySection => ({
  status: 'ok',
  aiOverviewCitedCount: 3,
  aiOverviewTotalChecked: 10,
  llmMentionedCount: 5,
  llmTotalChecked: 8,
  shareOfVoicePct: 60,
  sentiment: { positive: 4, neutral: 2, negative: 1 },
  notMentionedPrompts: [],
  ...overrides,
});

beforeEach(async () => {
  initI18n({ initialLocale: 'en' });
  await changeLanguage('en');
});

afterEach(() => {});

describe('AiVisibilityBlock', () => {
  // -----------------------------------------------------------------------
  // Guard clauses — null / unavailable / no-prompts
  // -----------------------------------------------------------------------

  it('renders unavailable note when section is null', () => {
    wrap(<AiVisibilityBlock section={null} siteId="s-1" />);
    expect(
      screen.getByText(i18n.t('report:aiVisibilityBlock.unavailableTitle')),
    ).toBeInTheDocument();
    expect(screen.queryByTestId('report-ai-visibility-block')).not.toBeInTheDocument();
  });

  it('renders unavailable note when status is "unavailable"', () => {
    wrap(
      <AiVisibilityBlock section={okSection({ status: 'unavailable' })} siteId="s-1" />,
    );
    expect(
      screen.getByText(i18n.t('report:aiVisibilityBlock.unavailableTitle')),
    ).toBeInTheDocument();
    expect(
      screen.getByText(i18n.t('report:aiVisibilityBlock.unavailableBody')),
    ).toBeInTheDocument();
    expect(screen.queryByTestId('report-ai-visibility-block')).not.toBeInTheDocument();
  });

  it('renders no-prompts note with a link when status is "no-prompts-tracked"', () => {
    wrap(
      <AiVisibilityBlock
        section={okSection({ status: 'no-prompts-tracked' })}
        siteId="s-1"
      />,
    );
    expect(
      screen.getByText(i18n.t('report:aiVisibilityBlock.noPromptsTitle')),
    ).toBeInTheDocument();
    expect(
      screen.getByText(i18n.t('report:aiVisibilityBlock.noPromptsBody')),
    ).toBeInTheDocument();
    const link = screen.getByRole('link', {
      name: i18n.t('report:aiVisibilityBlock.noPromptsCta'),
    });
    expect(link).toHaveAttribute('href', '/sites/s-1?tab=ai-visibility');
    expect(screen.queryByTestId('report-ai-visibility-block')).not.toBeInTheDocument();
  });

  // -----------------------------------------------------------------------
  // Full ok block — shareOfVoicePct present
  // -----------------------------------------------------------------------

  it('renders the full block with share-of-voice percentages when shareOfVoicePct is set', () => {
    wrap(<AiVisibilityBlock section={okSection({ shareOfVoicePct: 60 })} siteId="s-1" />);
    expect(screen.getByTestId('report-ai-visibility-block')).toBeInTheDocument();

    // counts
    expect(screen.getByText('3/10')).toBeInTheDocument();
    expect(screen.getByText('5/8')).toBeInTheDocument();

    // share-of-voice header
    expect(
      screen.getByText(i18n.t('report:aiVisibilityBlock.shareOfVoice')),
    ).toBeInTheDocument();

    // percentage cells (not "No data")
    expect(
      screen.queryByText(i18n.t('report:aiVisibilityBlock.noData')),
    ).not.toBeInTheDocument();

    // sentiment chips
    expect(screen.getByText(/Warm.*4/)).toBeInTheDocument();
    expect(screen.getByText(/Plain.*2/)).toBeInTheDocument();
    expect(screen.getByText(/Critical.*1/)).toBeInTheDocument();
  });

  // -----------------------------------------------------------------------
  // shareOfVoicePct === null → "No data" for both brand + competitor rows
  // -----------------------------------------------------------------------

  it('renders "No data" in both rows when shareOfVoicePct is null', () => {
    wrap(
      <AiVisibilityBlock section={okSection({ shareOfVoicePct: null })} siteId="s-1" />,
    );
    expect(screen.getByTestId('report-ai-visibility-block')).toBeInTheDocument();
    const noDataCells = screen.getAllByText(i18n.t('report:aiVisibilityBlock.noData'));
    expect(noDataCells).toHaveLength(2);
  });

  // -----------------------------------------------------------------------
  // notMentionedPrompts — list present / empty
  // -----------------------------------------------------------------------

  it('renders not-mentioned prompt list when notMentionedPrompts is non-empty', () => {
    wrap(
      <AiVisibilityBlock
        section={okSection({ notMentionedPrompts: ['best SEO tool', 'rank tracker'] })}
        siteId="s-1"
      />,
    );
    expect(screen.getByText('best SEO tool')).toBeInTheDocument();
    expect(screen.getByText('rank tracker')).toBeInTheDocument();
    expect(
      screen.getAllByText(i18n.t('report:aiVisibilityBlock.notMentioned')),
    ).toHaveLength(2);
  });

  it('renders no list when notMentionedPrompts is empty', () => {
    wrap(<AiVisibilityBlock section={okSection({ notMentionedPrompts: [] })} siteId="s-1" />);
    expect(
      screen.queryByText(i18n.t('report:aiVisibilityBlock.notMentioned')),
    ).not.toBeInTheDocument();
  });
});
