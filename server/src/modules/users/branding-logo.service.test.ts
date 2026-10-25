import { beforeEach, describe, expect, it, vi } from 'vitest';

const sharpMocks = vi.hoisted(() => {
  const metadata = vi.fn();
  const toBuffer = vi.fn();
  const pipeline = {
    metadata,
    rotate: vi.fn(),
    ensureAlpha: vi.fn(),
    resize: vi.fn(),
    png: vi.fn(),
    toBuffer,
  };
  pipeline.ensureAlpha.mockReturnValue(pipeline);
  pipeline.resize.mockReturnValue(pipeline);
  pipeline.png.mockReturnValue(pipeline);
  const factory = Object.assign(vi.fn(() => pipeline), {
    kernel: { lanczos3: 'lanczos3' },
  });
  return { factory, metadata, pipeline, toBuffer };
});

vi.mock('sharp', () => ({ default: sharpMocks.factory }));

import {
  assertCompleteJpegEnvelope,
  assertCompletePngEnvelope,
  assertSafeSvgSource,
  BRANDING_LOGO_MAX_INPUT_BYTES,
  BRANDING_LOGO_MAX_OUTPUT_BYTES,
  normalizeBrandingLogo,
} from './branding-logo.service.js';

const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

function pngChunk(type: string, data = Buffer.alloc(0)): Buffer {
  const chunk = Buffer.alloc(12 + data.length);
  chunk.writeUInt32BE(data.length, 0);
  chunk.write(type, 4, 4, 'ascii');
  data.copy(chunk, 8);
  return chunk;
}

const IHDR = pngChunk('IHDR', Buffer.alloc(13));
const IDAT = pngChunk('IDAT');
const IEND = pngChunk('IEND');
const VALID_ENVELOPE = Buffer.concat([PNG_SIGNATURE, IHDR, IDAT, IEND]);
const VALID_DATA_URL = `data:image/png;base64,${VALID_ENVELOPE.toString('base64')}`;

function expectMalformed(action: () => unknown): void {
  expect(action).toThrowError(
    expect.objectContaining({
      status: 400,
      message: 'branding.errors.logoMalformed',
    }),
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  sharpMocks.pipeline.ensureAlpha.mockReturnValue(sharpMocks.pipeline);
  sharpMocks.pipeline.resize.mockReturnValue(sharpMocks.pipeline);
  sharpMocks.pipeline.png.mockReturnValue(sharpMocks.pipeline);
  sharpMocks.metadata.mockResolvedValue({ format: 'png', width: 24, height: 12, pages: 1 });
  sharpMocks.toBuffer.mockResolvedValue({
    data: VALID_ENVELOPE,
    info: { width: 24, height: 12 },
  });
});

describe('assertCompletePngEnvelope', () => {
  it('accepts one complete IHDR/IDAT/IEND envelope', () => {
    expect(() => assertCompletePngEnvelope(VALID_ENVELOPE)).not.toThrow();
  });

  it('rejects truncated chunks, invalid chunk names, invalid first chunks, repeats, and missing IEND', () => {
    const malformed = [
      Buffer.alloc(0),
      Buffer.concat([PNG_SIGNATURE, IHDR, Buffer.from([0])]),
      Buffer.concat([PNG_SIGNATURE, pngChunk('1HDR', Buffer.alloc(13))]),
      Buffer.concat([PNG_SIGNATURE, IDAT, IEND]),
      Buffer.concat([PNG_SIGNATURE, IHDR, IHDR, IDAT, IEND]),
      Buffer.concat([PNG_SIGNATURE, IHDR, IEND]),
      Buffer.concat([PNG_SIGNATURE, IHDR, IDAT]),
    ];
    for (const bytes of malformed) expectMalformed(() => assertCompletePngEnvelope(bytes));
  });
});

describe('normalizeBrandingLogo defensive failures', () => {
  it('rejects a non-PNG URL, invalid base64, and non-canonical base64 before decode', async () => {
    await expect(normalizeBrandingLogo('https://example.test/logo.png')).rejects.toMatchObject({
      status: 400,
      message: 'branding.errors.logoMalformed',
    });
    await expect(normalizeBrandingLogo('data:image/png;base64,abc')).rejects.toMatchObject({
      status: 400,
      message: 'branding.errors.logoMalformed',
    });
    await expect(normalizeBrandingLogo('data:image/png;base64,/x==')).rejects.toMatchObject({
      status: 400,
      message: 'branding.errors.logoMalformed',
    });
    expect(sharpMocks.factory).not.toHaveBeenCalled();
  });

  it('rejects an input above the encoded upload budget before parsing its envelope', async () => {
    const oversized = Buffer.alloc(BRANDING_LOGO_MAX_INPUT_BYTES + 1).toString('base64');
    await expect(
      normalizeBrandingLogo(`data:image/png;base64,${oversized}`),
    ).rejects.toMatchObject({
      status: 400,
      message: 'branding.errors.logoTooLarge',
    });
  });

  it('localizes decoder metadata failures as malformed-logo errors', async () => {
    sharpMocks.metadata.mockRejectedValueOnce(new Error('decoder refused input'));
    await expect(normalizeBrandingLogo(VALID_DATA_URL)).rejects.toMatchObject({
      status: 400,
      message: 'branding.errors.logoMalformed',
    });
  });

  it('rejects missing dimensions and multi-page decoder metadata', async () => {
    sharpMocks.metadata.mockResolvedValueOnce({ format: 'png', height: 12, pages: 1 });
    await expect(normalizeBrandingLogo(VALID_DATA_URL)).rejects.toMatchObject({
      status: 400,
      message: 'branding.errors.logoDimensions',
    });
    sharpMocks.metadata.mockResolvedValueOnce({ format: 'png', width: 24, height: 12, pages: 2 });
    await expect(normalizeBrandingLogo(VALID_DATA_URL)).rejects.toMatchObject({
      status: 400,
      message: 'branding.errors.logoDimensions',
    });
  });

  it('returns only the deterministic re-encoded PNG and its output dimensions', async () => {
    sharpMocks.metadata.mockResolvedValueOnce({ format: 'png', width: 24, height: 12 });
    await expect(normalizeBrandingLogo(VALID_DATA_URL)).resolves.toEqual({
      logoPngBase64: VALID_ENVELOPE.toString('base64'),
      logoWidth: 24,
      logoHeight: 12,
    });
  });

  it('preserves a bounded output-size HttpError when even the palette re-encode is too large', async () => {
    const oversized = {
      data: Buffer.alloc(BRANDING_LOGO_MAX_OUTPUT_BYTES + 1),
      info: { width: 24, height: 12 },
    };
    sharpMocks.toBuffer.mockResolvedValueOnce(oversized).mockResolvedValueOnce(oversized);
    await expect(normalizeBrandingLogo(VALID_DATA_URL)).rejects.toMatchObject({
      status: 400,
      message: 'branding.errors.logoTooLarge',
    });
  });

  it('localizes a re-encoder failure as a malformed-logo error', async () => {
    sharpMocks.toBuffer.mockRejectedValueOnce(new Error('re-encoder failed'));
    await expect(normalizeBrandingLogo(VALID_DATA_URL)).rejects.toMatchObject({
      status: 400,
      message: 'branding.errors.logoMalformed',
    });
  });
});

describe('JPEG and SVG envelopes', () => {
  const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0xff, 0xd9]);

  it('accepts a JPEG that starts with SOI and ends with EOI', () => {
    expect(() => assertCompleteJpegEnvelope(JPEG)).not.toThrow();
  });

  it('rejects a truncated JPEG, a wrong start, and bytes appended after EOI', () => {
    for (const bytes of [
      Buffer.from([0xff, 0xd8, 0xff]),
      Buffer.concat([Buffer.from([0x00]), JPEG.subarray(1)]),
      Buffer.concat([JPEG, Buffer.from('PKpolyglot')]),
    ]) {
      expectMalformed(() => assertCompleteJpegEnvelope(bytes));
    }
  });

  it('accepts a plain SVG, with or without a declaration and leading comments', () => {
    for (const svg of [
      '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><use href="#a"/><rect id="a" fill="url(#g)"/></svg>',
      '\uFEFF<?xml version="1.0" encoding="UTF-8"?>\n<!-- logo -->\n<svg viewBox="0 0 10 10"></svg>',
      // A custom xlink prefix pointing inside the document stays allowed.
      '<svg xmlns="http://www.w3.org/2000/svg" xmlns:x="http://www.w3.org/1999/xlink"><use x:href="#a"/><rect id="a"/></svg>',
    ]) {
      expect(() => assertSafeSvgSource(Buffer.from(svg))).not.toThrow();
    }
  });

  it('rejects invalid UTF-8, NUL bytes, and documents that are not SVG', () => {
    expectMalformed(() => assertSafeSvgSource(Buffer.from([0x3c, 0x73, 0x76, 0x67, 0x20, 0xc3, 0x28, 0x3e])));
    expectMalformed(() => assertSafeSvgSource(Buffer.from('<svg>\u0000</svg>')));
    expectMalformed(() => assertSafeSvgSource(Buffer.from('<html><svg></svg></html>')));
  });

  it.each([
    ['a script', '<svg><script>alert(1)</script></svg>'],
    ['foreignObject', '<svg><foreignObject><p>x</p></foreignObject></svg>'],
    ['an event handler', '<svg onload="alert(1)"></svg>'],
    ['an external href', '<svg><image href="https://tracker.example/x.png"/></svg>'],
    ['an external xlink:href', '<svg><image xlink:href="file:///etc/passwd"/></svg>'],
    [
      'an external href under a custom xlink prefix on <image>',
      '<svg xmlns="http://www.w3.org/2000/svg" xmlns:x="http://www.w3.org/1999/xlink"><image x:href="https://tracker.example/x.png"/></svg>',
    ],
    [
      'an external href under a custom xlink prefix on <use>',
      '<svg xmlns="http://www.w3.org/2000/svg" xmlns:x="http://www.w3.org/1999/xlink"><use x:href="https://tracker.example/sprite.svg#a"/></svg>',
    ],
    ['an encoded href', '<svg><a href="&#x6A;avascript:alert(1)"><rect/></a></svg>'],
    ['an external url()', '<svg><rect style="fill:url(https://tracker.example/p)"/></svg>'],
    ['a CSS import', '<svg><style>@import "https://tracker.example/x.css";</style></svg>'],
    ['a DOCTYPE', '<!DOCTYPE svg><svg></svg>'],
    ['an entity', '<svg><!ENTITY a "aaaa"></svg>'],
    ['a stylesheet instruction', '<svg><?xml-stylesheet href="x.css"?></svg>'],
  ])('rejects an SVG with %s as unsafe', (_label, svg) => {
    expect(() => assertSafeSvgSource(Buffer.from(svg))).toThrowError(
      expect.objectContaining({ status: 400, message: 'branding.errors.logoUnsafeSvg' }),
    );
  });

  it('refuses a file whose decoded format differs from its declared type', async () => {
    sharpMocks.metadata.mockResolvedValueOnce({ format: 'jpeg', width: 24, height: 12 });
    await expect(normalizeBrandingLogo(VALID_DATA_URL)).rejects.toMatchObject({
      status: 400,
      message: 'branding.errors.logoMalformed',
    });
  });

  it('falls back to a palette PNG when the lossless re-encode is over budget', async () => {
    sharpMocks.toBuffer
      .mockResolvedValueOnce({ data: Buffer.alloc(BRANDING_LOGO_MAX_OUTPUT_BYTES + 1), info: { width: 24, height: 12 } })
      .mockResolvedValueOnce({ data: VALID_ENVELOPE, info: { width: 24, height: 12 } });
    await expect(normalizeBrandingLogo(VALID_DATA_URL)).resolves.toMatchObject({ logoWidth: 24 });
    expect(sharpMocks.pipeline.png).toHaveBeenNthCalledWith(1, expect.objectContaining({ palette: false }));
    expect(sharpMocks.pipeline.png).toHaveBeenNthCalledWith(2, expect.objectContaining({ palette: true }));
  });
});
