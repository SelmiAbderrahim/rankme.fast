import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { changeLanguage, initI18n } from '@shared/i18n';
import { readLastMarket } from './initialMarket';
import { SiteMarketProvider, usePickerMarket, useSiteMarket } from './siteMarket';
import { MarketProvenance } from './MarketProvenance';
import { ScriptMismatchWarning } from './ScriptMismatchWarning';

const FR = { locationCode: 2250, languageCode: 'fr', device: 'desktop' as const };
beforeEach(async () => { window.localStorage.clear(); initI18n({ initialLocale: 'en' }); await changeLanguage('en'); });

function Picker() {
  const picker = usePickerMarket('research');
  const context = useSiteMarket();
  return <><span data-testid="picker" data-ready={picker.ready} data-in-site={picker.inSite}>{picker.initial.source}:{picker.initial.locationCode}:{context?.market?.source}</span><button onClick={() => picker.remember(FR)}>Remember</button></>;
}

describe('site market context', () => {
  it('distinguishes global, loading, missing and resolved site defaults', () => {
    const { rerender } = render(<><Picker /><MarketProvenance /></>);
    expect(screen.getByTestId('picker')).toHaveAttribute('data-ready', 'true');
    expect(screen.getByTestId('picker')).toHaveAttribute('data-in-site', 'false');
    expect(screen.queryByTestId('market-provenance')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Remember' }));
    expect(readLastMarket('research')).toEqual(FR);
    rerender(<SiteMarketProvider market={undefined}><Picker /><MarketProvenance /></SiteMarketProvider>);
    expect(screen.getByTestId('picker')).toHaveAttribute('data-ready', 'false');
    expect(screen.getByTestId('picker')).toHaveAttribute('data-in-site', 'true');
    rerender(<SiteMarketProvider market={null}><Picker /><MarketProvenance /></SiteMarketProvider>);
    expect(screen.getByTestId('picker')).toHaveAttribute('data-ready', 'true');
    expect(screen.queryByTestId('market-provenance')).toBeNull();
    rerender(<SiteMarketProvider market={{ ...FR, source: 'owner' }}><Picker /><MarketProvenance /></SiteMarketProvider>);
    expect(screen.getByTestId('picker')).toHaveTextContent('site:2250:owner');
    expect(screen.getByTestId('market-provenance')).toHaveTextContent('saved market');
    rerender(<SiteMarketProvider market={JSON.parse('{"locationCode":2250}')}><Picker /><MarketProvenance /></SiteMarketProvider>);
    expect(screen.queryByTestId('market-provenance')).toBeNull();
  });

  it.each([
    ['owner', 'saved market'], ['search_console', 'Search Console traffic'], ['cctld', "site's country"],
    ['site_language', 'page language'], ['assumed', 'fallback market'],
  ] as const)('labels %s defaults honestly', (source, expected) => {
    render(<SiteMarketProvider market={{ ...FR, source }}><MarketProvenance /></SiteMarketProvider>);
    expect(screen.getByTestId('market-provenance')).toHaveTextContent(expected);
    expect(screen.getByTestId('market-provenance')).toHaveAttribute('data-source', source);
    if (source === 'assumed') expect(screen.getByTestId('market-provenance')).toHaveAttribute('role', 'status');
  });

  it('names the actual fallback and asks for confirmation without keyword-specific advice (issue #60)', () => {
    const edit = vi.fn();
    render(<SiteMarketProvider market={{ ...FR, source: 'assumed' }} onEditMarket={edit}><MarketProvenance /></SiteMarketProvider>);
    const notice = screen.getByTestId('market-provenance');
    expect(notice).toHaveTextContent('Using a fallback market');
    expect(notice).toHaveTextContent('France');
    expect(notice).toHaveTextContent('French');
    expect(notice).toHaveTextContent('Save this default or choose another market');
    expect(notice).not.toHaveTextContent('adding keywords');
    fireEvent.click(screen.getByRole('button', { name: 'Change site default' }));
    expect(edit).toHaveBeenCalledOnce();
  });

  it('offers editing while the current picker uses the site market and hides stale captions', () => {
    const edit = vi.fn();
    const { rerender } = render(<SiteMarketProvider market={{ ...FR, source: 'owner' }} onEditMarket={edit}><MarketProvenance current={FR} hint="Choose another if needed." className="my-2" data-testid="provenance" /></SiteMarketProvider>);
    expect(screen.getByTestId('provenance')).toHaveTextContent('Choose another if needed.');
    fireEvent.click(screen.getByTestId('provenance-edit'));
    expect(edit).toHaveBeenCalledOnce();
    rerender(<SiteMarketProvider market={{ ...FR, source: 'owner' }}><MarketProvenance current={{ ...FR, locationCode: 2840 }} /></SiteMarketProvider>);
    expect(screen.queryByTestId('market-provenance')).toBeNull();
    rerender(<SiteMarketProvider market={{ ...FR, source: 'owner' }}><MarketProvenance current={{ ...FR, languageCode: 'en' }} /></SiteMarketProvider>);
    expect(screen.queryByTestId('market-provenance')).toBeNull();
    rerender(<SiteMarketProvider market={FR}><MarketProvenance /></SiteMarketProvider>);
    expect(screen.queryByTestId('market-provenance')).toBeNull();
    rerender(<SiteMarketProvider market={{ ...FR, source: 'owner', locationCode: 999, languageCode: 'qzz' }}><MarketProvenance /></SiteMarketProvider>);
    expect(screen.getByTestId('market-provenance')).toHaveTextContent('Unknown country');
    expect(screen.getByTestId('market-provenance')).toHaveTextContent('Unknown language');
  });
});

describe('script mismatch advice', () => {
  it('offers a language switch only when the selected market offers it', () => {
    const onSwitch = vi.fn();
    const { rerender } = render(<ScriptMismatchWarning text="تطبيق مكافآت" languageCode="en" languages={['en', 'ar']} onSwitch={onSwitch} />);
    expect(screen.getByRole('status')).toHaveTextContent('looks like Arabic');
    fireEvent.click(screen.getByTestId('script-mismatch-switch'));
    expect(onSwitch).toHaveBeenCalledWith('ar');
    rerender(<ScriptMismatchWarning text="تطبيق مكافآت" languageCode="en" languages={['en']} onSwitch={onSwitch} />);
    expect(screen.getByRole('status')).toHaveTextContent('does not offer');
    expect(screen.queryByRole('button')).toBeNull();
    rerender(<ScriptMismatchWarning text="تطبيق مكافآت" languageCode="ar" languages={['ar']} onSwitch={onSwitch} />);
    expect(screen.queryByRole('status')).toBeNull();
    rerender(<ScriptMismatchWarning text="搜索排名" languageCode="qzz" languages={['zh']} onSwitch={onSwitch} />);
    expect(screen.getByRole('status')).toHaveTextContent('Unknown language');
    expect(screen.getByRole('status')).not.toHaveTextContent('qzz');
  });
});
