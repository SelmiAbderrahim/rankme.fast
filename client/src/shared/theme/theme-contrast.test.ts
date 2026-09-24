import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const css = readFileSync(resolve(__dirname, '../../styles/tailwind.css'), 'utf8');

function themeBlock(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = css.match(new RegExp(`${escaped}\\s*\\{([\\s\\S]*?)\\n\\}`));
  if (!match?.[1]) throw new Error(`Missing ${selector} theme block`);
  return match[1];
}

function token(block: string, name: string): string {
  const match = block.match(new RegExp(`--${name}:\\s*(#[0-9a-f]{6})`, 'i'));
  if (!match?.[1]) throw new Error(`Missing --${name}`);
  return match[1];
}

function rgb(hex: string): [number, number, number] {
  const value = Number.parseInt(hex.slice(1), 16);
  return [value >> 16, (value >> 8) & 255, value & 255];
}

function linear(channel: number): number {
  const value = channel / 255;
  return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
}

function luminance(hex: string): number {
  const [red, green, blue] = rgb(hex);
  return 0.2126 * linear(red) + 0.7152 * linear(green) + 0.0722 * linear(blue);
}

function contrast(first: string, second: string): number {
  const firstLuminance = luminance(first);
  const secondLuminance = luminance(second);
  return (
    (Math.max(firstLuminance, secondLuminance) + 0.05) /
    (Math.min(firstLuminance, secondLuminance) + 0.05)
  );
}

function blend(foreground: string, background: string, alpha: number): string {
  const foregroundRgb = rgb(foreground);
  const backgroundRgb = rgb(background);
  const channels = foregroundRgb.map((channel, index) =>
    Math.round(channel * alpha + backgroundRgb[index]! * (1 - alpha)),
  );
  return `#${channels.map((channel) => channel.toString(16).padStart(2, '0')).join('')}`;
}

function expectPair(
  block: string,
  foreground: string,
  background: string,
  minimum: number,
): void {
  expect(
    contrast(token(block, foreground), token(block, background)),
    `--${foreground} on --${background}`,
  ).toBeGreaterThanOrEqual(minimum);
}

describe.each([
  ['light', ':root'],
  ['dark', '.dark'],
  ['marketing light', '.mk-theme'],
  ['marketing dark', '.dark .mk-theme,\n.mk-theme .dark'],
] as const)('%s theme contrast contract', (_theme, selector) => {
  const block = themeBlock(selector);

  it('keeps normal and secondary text at WCAG AA or better', () => {
    for (const [foreground, background] of [
      ['foreground', 'background'],
      ['card-foreground', 'card'],
      ['popover-foreground', 'popover'],
      ['muted-foreground', 'background'],
      ['muted-foreground', 'card'],
      ['muted-foreground', 'muted'],
      ['primary-foreground', 'primary'],
      ['secondary-foreground', 'secondary'],
      ['accent-foreground', 'accent'],
      ['destructive-foreground', 'destructive'],
      ['success-foreground', 'success'],
      ['warning-foreground', 'warning'],
      ['info-foreground', 'info'],
      ['highlight-foreground', 'highlight'],
    ] as const) {
      expectPair(block, foreground, background, 4.5);
    }
  });

  it('keeps controls and focus indicators visibly distinct', () => {
    for (const surface of ['background', 'card', 'sidebar'] as const) {
      expectPair(block, surface === 'sidebar' ? 'sidebar-border' : 'input', surface, 3);
    }
    for (const surface of ['background', 'card'] as const) {
      expectPair(block, 'ring', surface, 3);
    }
    expect(token(block, 'input')).not.toBe(token(block, 'border'));
  });

  it('keeps semantic text readable on page, card, and sanctioned soft tints', () => {
    for (const name of ['destructive', 'success', 'warning', 'info', 'highlight'] as const) {
      const color = token(block, name);
      for (const surfaceName of ['background', 'card'] as const) {
        const surface = token(block, surfaceName);
        expect(contrast(color, surface), `--${name} on --${surfaceName}`).toBeGreaterThanOrEqual(4.5);
        expect(
          contrast(color, blend(color, surface, 0.1)),
          `--${name} on its 10% tint over --${surfaceName}`,
        ).toBeGreaterThanOrEqual(4.5);
      }
    }
  });

  it('keeps every chart series perceivable and tint-safe', () => {
    for (const name of ['chart-1', 'chart-2', 'chart-3', 'chart-4', 'chart-5'] as const) {
      const color = token(block, name);
      for (const surfaceName of ['background', 'card'] as const) {
        const surface = token(block, surfaceName);
        expect(contrast(color, surface), `--${name} on --${surfaceName}`).toBeGreaterThanOrEqual(3);
        expect(
          contrast(color, blend(color, surface, 0.1)),
          `--${name} on its 10% tint over --${surfaceName}`,
        ).toBeGreaterThanOrEqual(4.5);
      }
    }
  });
});
