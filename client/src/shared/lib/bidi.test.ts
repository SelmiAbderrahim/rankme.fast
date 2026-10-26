import { describe, expect, it } from 'vitest';
import { dominantDirection, isolateDominant, isolateLtr, isolateText } from './bidi';

describe('text direction and isolation', () => {
  it.each([
    ['EpisodeBrief · كيف يعمل EpisodeBrief؟', 'rtl'],
    ['A long English title with كلمة', 'ltr'],
    ['Example مرحبا', 'rtl'],
    ['שלום', 'rtl'],
    ['ܫܠܡܐ', 'rtl'],
    ['ސަލާމް', 'rtl'],
    ['ߒߞߏ', 'rtl'],
    ['你好世界', 'ltr'],
    ['123 (٤٥) …', 'auto'],
    ['', 'auto'],
  ] as const)('resolves the dominant direction of %s', (text, direction) => {
    expect(dominantDirection(text)).toBe(direction);
  });

  it('isolates text in plain strings without changing its contents', () => {
    expect(isolateText('عنوان (example)')).toBe('\u2068عنوان (example)\u2069');
    expect(isolateDominant('مرحبا')).toBe('\u2067مرحبا\u2069');
    expect(isolateDominant('example')).toBe('\u2066example\u2069');
    expect(isolateDominant('123')).toBe('\u2068123\u2069');
    expect(isolateLtr('\u200f2026/10/24\u200e\u061c')).toBe('\u20662026/10/24\u2069');
  });
});
