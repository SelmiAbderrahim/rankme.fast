/**
 * useGoogleRange tests — URL round-trip (`?range=`), invalid/absent fallback
 * to the 28-day default, default-write deletes the param, and the pure
 * helpers (`isGoogleRange`, `rangeDays`).
 */
import { describe, expect, it } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import type { ReactNode } from 'react';
import {
  DEFAULT_GOOGLE_RANGE,
  GOOGLE_RANGES,
  isGoogleRange,
  rangeDays,
  useGoogleRange,
} from './range';

const useProbe = () => {
  const [range, setRange] = useGoogleRange();
  const location = useLocation();
  return { range, setRange, search: location.search };
};

const renderProbe = (initialEntry: string) =>
  renderHook(useProbe, {
    wrapper: ({ children }: { children: ReactNode }) => (
      <MemoryRouter initialEntries={[initialEntry]}>{children}</MemoryRouter>
    ),
  });

describe('useGoogleRange', () => {
  it('defaults to 28d when the param is absent', () => {
    const { result } = renderProbe('/sites/site-1?tab=google');
    expect(result.current.range).toBe('28d');
  });

  it('reads a valid ?range= value', () => {
    const { result } = renderProbe('/sites/site-1?tab=google&range=90d');
    expect(result.current.range).toBe('90d');
  });

  it('falls back to the default on an invalid value', () => {
    const { result } = renderProbe('/sites/site-1?tab=google&range=weekly');
    expect(result.current.range).toBe('28d');
  });

  it('writes non-default ranges to the URL, preserving other params', () => {
    const { result } = renderProbe('/sites/site-1?tab=google');
    act(() => result.current.setRange('7d'));
    expect(result.current.range).toBe('7d');
    expect(result.current.search).toBe('?tab=google&range=7d');
  });

  it('deletes the param when the default range is selected', () => {
    const { result } = renderProbe('/sites/site-1?tab=google&range=7d');
    act(() => result.current.setRange('28d'));
    expect(result.current.range).toBe('28d');
    expect(result.current.search).toBe('?tab=google');
  });
});

describe('range helpers', () => {
  it('isGoogleRange accepts exactly the three windows', () => {
    for (const value of GOOGLE_RANGES) {
      expect(isGoogleRange(value)).toBe(true);
    }
    expect(isGoogleRange('weekly')).toBe(false);
    expect(isGoogleRange(null)).toBe(false);
    expect(isGoogleRange(28)).toBe(false);
  });

  it('rangeDays maps each window to its day count', () => {
    expect(rangeDays('7d')).toBe(7);
    expect(rangeDays('28d')).toBe(28);
    expect(rangeDays('90d')).toBe(90);
    expect(rangeDays(DEFAULT_GOOGLE_RANGE)).toBe(28);
  });
});
