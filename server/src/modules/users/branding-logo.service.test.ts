import { beforeEach, describe, expect, it, vi } from 'vitest';

const sharpMocks = vi.hoisted(() => {
  const metadata = vi.fn();
  const toBuffer = vi.fn();
  const pipeline = {
    metadata,
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
  assertCompletePngEnvelope,
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
  sharpMocks.metadata.mockResolvedValue({ width: 24, height: 12, pages: 1 });
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
    sharpMocks.metadata.mockResolvedValueOnce({ height: 12, pages: 1 });
    await expect(normalizeBrandingLogo(VALID_DATA_URL)).rejects.toMatchObject({
      status: 400,
      message: 'branding.errors.logoDimensions',
    });
    sharpMocks.metadata.mockResolvedValueOnce({ width: 24, height: 12, pages: 2 });
    await expect(normalizeBrandingLogo(VALID_DATA_URL)).rejects.toMatchObject({
      status: 400,
      message: 'branding.errors.logoDimensions',
    });
  });

  it('returns only the deterministic re-encoded PNG and its output dimensions', async () => {
    sharpMocks.metadata.mockResolvedValueOnce({ width: 24, height: 12 });
    await expect(normalizeBrandingLogo(VALID_DATA_URL)).resolves.toEqual({
      logoPngBase64: VALID_ENVELOPE.toString('base64'),
      logoWidth: 24,
      logoHeight: 12,
    });
  });

  it('preserves a bounded output-size HttpError from the re-encoder', async () => {
    sharpMocks.toBuffer.mockResolvedValueOnce({
      data: Buffer.alloc(BRANDING_LOGO_MAX_OUTPUT_BYTES + 1),
      info: { width: 24, height: 12 },
    });
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
