import { useState } from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { changeLanguage, initI18n } from '@shared/i18n';
import { writeToClipboard } from '@shared/lib/clipboard';
import { parsePhraseList, reviewPhraseList } from '@shared/lib/phraseList';
import { PhraseListPreview } from './PhraseListPreview';
import { CompetitorDomainsInput } from './CompetitorDomainsInput';

vi.mock('@shared/lib/clipboard', () => ({ writeToClipboard: vi.fn() }));

beforeEach(async () => {
  vi.clearAllMocks();
  initI18n({ initialLocale: 'en' });
  await changeLanguage('en');
});

describe('phrase preview', () => {
  it('copies quoted separators without changing phrase identities when pasted again', async () => {
    const review = reviewPhraseList('"best crm, free"; "BEST CRM, FREE"; "a;b"; plain', { maxLength: 30, maxItems: 10 });
    vi.mocked(writeToClipboard).mockResolvedValueOnce(true);
    render(<PhraseListPreview review={review} countLabel="4 detected" maxItems={10} onRemove={vi.fn()} testIdPrefix="phrases" countId="count" />);
    fireEvent.click(screen.getByTestId('phrases-copy'));
    await screen.findByRole('status');
    const copied = vi.mocked(writeToClipboard).mock.calls[0]![0];
    expect(copied).toBe('"best crm, free"\n"a;b"\nplain');
    expect(parsePhraseList(copied)).toEqual(['best crm, free', 'a;b', 'plain']);
  });

  it('shows verdicts in words and removes the selected item', () => {
    const review = reviewPhraseList('a, A, old, waytoolong', { maxLength: 5, maxItems: 10, existingKeys: new Set(['old']) });
    const onRemove = vi.fn();
    render(<PhraseListPreview review={review} countLabel="4 detected" maxItems={10} onRemove={onRemove} verdictLabels={{ existing: 'Tracked' }} testIdPrefix="phrases" countId="count" />);
    expect(screen.getByTestId('phrases-count')).toHaveAttribute('aria-live', 'polite');
    expect(screen.getByTestId('phrases-count')).toHaveTextContent('4 detected');
    expect(screen.getAllByTestId('phrases-item').map((node) => node.dataset.verdict)).toEqual(['ready', 'repeated', 'existing', 'tooLong']);
    expect(screen.getByText('· Tracked')).toBeInTheDocument();
    expect(screen.getByText('· Repeated')).toBeInTheDocument();
    expect(screen.getByText('· Too long')).toBeInTheDocument();
    fireEvent.click(screen.getAllByRole('button', { name: /Remove/ })[0]!);
    expect(onRemove).toHaveBeenCalledWith(review.items[0], 0);
  });

  it('explains spreadsheet handling and caps the visible list', () => {
    const rows = Array.from({ length: 102 }, (_, i) => `keyword${i}\t${i}`);
    const review = reviewPhraseList(['Keyword\tVolume', ...rows].join('\n'), { maxLength: 20, maxItems: 101 });
    render(<PhraseListPreview review={review} countLabel="101 detected" maxItems={101} onRemove={vi.fn()} testIdPrefix="phrases" countId="count" />);
    expect(screen.getAllByTestId('phrases-item')).toHaveLength(100);
    expect(screen.getByTestId('phrases-more')).toHaveTextContent('1 more');
    expect(screen.getByTestId('phrases-columns')).toHaveTextContent('first column');
    expect(screen.getByTestId('phrases-header')).toHaveTextContent('Keyword');
    expect(screen.getByTestId('phrases-paste-limit')).toHaveTextContent('another batch');
  });

  it('disables copying while pending and reports success or failure', async () => {
    const review = reviewPhraseList('a,A,b', { maxLength: 20, maxItems: 100 });
    let resolveCopy!: (value: boolean) => void;
    vi.mocked(writeToClipboard).mockReturnValueOnce(new Promise((resolve) => { resolveCopy = resolve; })).mockResolvedValueOnce(false);
    render(<PhraseListPreview review={review} countLabel="3 detected" maxItems={100} onRemove={vi.fn()} testIdPrefix="phrases" countId="count" />);
    const button = screen.getByTestId('phrases-copy');
    fireEvent.click(button);
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute('aria-busy', 'true');
    expect(writeToClipboard).toHaveBeenCalledWith('a\nb');
    await act(async () => { resolveCopy(true); });
    expect(screen.getByRole('status')).toHaveTextContent('Copied, one item per line.');
    fireEvent.click(button);
    expect(await screen.findByText('Could not copy. Select the text and copy it yourself.')).toBeInTheDocument();
    expect(button).toBeEnabled();
  });

  it('does not offer copying or an empty list before items exist', () => {
    render(<PhraseListPreview review={reviewPhraseList('', { maxLength: 20, maxItems: 100 })} countLabel="0 detected" maxItems={100} onRemove={vi.fn()} testIdPrefix="phrases" countId="count" />);
    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.queryByRole('list')).toBeNull();
  });
});

function Domains({ initial = [], error, help }: { initial?: string[]; error?: string; help?: string }) {
  const [value, onChange] = useState(initial);
  return <CompetitorDomainsInput id="domains" label="Competitors" value={value} onChange={onChange} ownDomain="example.com" testIdPrefix="domains" error={error} help={help} />;
}

const enterDomain = (value: string) => {
  const input = screen.getByRole('textbox', { name: 'Competitors' });
  fireEvent.change(input, { target: { value } });
  fireEvent.keyDown(input, { key: 'Enter' });
};

describe('competitor domain field', () => {
  it('normalizes domains, explains duplicates and clears own-site errors when editing', () => {
    render(<Domains />);
    const input = screen.getByRole('textbox', { name: 'Competitors' });
    expect(input).toHaveAttribute('placeholder', '\u2068e.g. competitor.com\u2069');
    expect(input).toHaveAttribute('dir', 'ltr');
    expect(input).toHaveAccessibleDescription(expect.stringContaining('Domains: 0 of 3'));
    enterDomain('www.example.com');
    expect(screen.getByTestId('domains-own')).toHaveTextContent('your own site');
    expect(input).toHaveAttribute('aria-invalid', 'true');
    fireEvent.change(input, { target: { value: 'other.test' } });
    expect(screen.queryByTestId('domains-own')).toBeNull();
    expect(input).not.toHaveAttribute('aria-invalid');
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(screen.getByTestId('domains-chip-other.test')).toHaveTextContent('other.test');
    enterDomain('https://WWW.Other.test/path');
    expect(screen.getByTestId('domains-duplicate')).toHaveTextContent('Already added');
    enterDomain('<img src=x onerror=alert(1)>');
    expect(screen.getByTestId('domains-invalid')).toHaveTextContent('<img src=x onerror=alert(1)>');
    expect(document.querySelector('img')).toBeNull();
  });

  it('reports a full field and lets a removed chip be replaced', () => {
    render(<Domains initial={['one.test', 'two.test', 'three.test']} error="Review this field" help="Choose comparable sites." />);
    expect(screen.getByTestId('domains-error')).toHaveTextContent('Review this field');
    expect(screen.getByText('Choose comparable sites.')).toBeInTheDocument();
    enterDomain('four.test');
    expect(screen.getByTestId('domains-limit')).toHaveTextContent('up to 3');
    fireEvent.click(screen.getAllByRole('button', { name: /Remove/ })[0]!);
    expect(screen.queryByTestId('domains-limit')).toBeNull();
    expect(screen.queryByTestId('domains-chip-one.test')).toBeNull();
    enterDomain('four.test');
    expect(screen.getByTestId('domains-chip-four.test')).toBeInTheDocument();
    expect(screen.getByTestId('domains-count')).toHaveTextContent('Domains: 3 of 3');
  });
});
