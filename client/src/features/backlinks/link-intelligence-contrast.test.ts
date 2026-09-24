import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const css = readFileSync(resolve(__dirname, '../../styles/tailwind.css'), 'utf8');

function themeBlock(selector: ':root' | '.dark'): string {
  const escaped = selector === ':root' ? ':root' : '\\.dark';
  const match = css.match(new RegExp(`${escaped}\\s*\\{([\\s\\S]*?)\\n\\}`));
  if (!match?.[1]) throw new Error(`Missing ${selector} theme block`);
  return match[1];
}

function token(block: string, name: string): string {
  const match = block.match(new RegExp(`--${name}:\\s*(#[0-9a-f]{6})`, 'i'));
  if (!match?.[1]) throw new Error(`Missing --${name}`);
  return match[1];
}

function linear(channel: number): number {
  const value = channel / 255;
  return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
}

function luminance(hex: string): number {
  const value = Number.parseInt(hex.slice(1), 16);
  return (
    0.2126 * linear(value >> 16) +
    0.7152 * linear((value >> 8) & 255) +
    0.0722 * linear(value & 255)
  );
}

function ratio(foreground: string, background: string): number {
  const first = luminance(foreground);
  const second = luminance(background);
  return Number(((Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05)).toFixed(2));
}

function contrastSnapshot(selector: ':root' | '.dark') {
  const block = themeBlock(selector);
  return {
    surface: ratio(token(block, 'foreground'), token(block, 'background')),
    card: ratio(token(block, 'card-foreground'), token(block, 'card')),
    muted: ratio(token(block, 'muted-foreground'), token(block, 'muted')),
    primary: ratio(token(block, 'primary-foreground'), token(block, 'primary')),
    destructive: ratio(token(block, 'destructive-foreground'), token(block, 'destructive')),
    destructiveAlert: ratio(token(block, 'destructive'), token(block, 'card')),
  };
}

describe('Link Intelligence light/dark contrast contract', () => {
  it('keeps every text/surface pair at WCAG AA and snapshots both themes together', () => {
    const paired = {
      light: contrastSnapshot(':root'),
      dark: contrastSnapshot('.dark'),
    };
    for (const theme of Object.values(paired)) {
      for (const value of Object.values(theme)) expect(value).toBeGreaterThanOrEqual(4.5);
    }
    expect(paired).toMatchInlineSnapshot(`
      {
        "dark": {
          "card": 16.31,
          "destructive": 7.16,
          "destructiveAlert": 6.71,
          "muted": 6.59,
          "primary": 16.68,
          "surface": 17.41,
        },
        "light": {
          "card": 17.88,
          "destructive": 6.47,
          "destructiveAlert": 6.47,
          "muted": 5.96,
          "primary": 15.67,
          "surface": 15.72,
        },
      }
    `);
  });
});
