/**
 * White-label PDF branding endpoints (workstream B).
 *
 * GET /api/users/branding  — any verified user (settings panel read).
 * PUT /api/users/branding  — any verified user.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import sharp from 'sharp';
import { createApp } from '../../app.js';
import {
  clearCollections,
  startMemoryMongo,
  stopMemoryMongo,
} from '../../shared/testing/mongo.js';
import {
  startTestPostgres,
  stopTestPostgres,
  truncateAllTables,
} from '../../shared/testing/postgres.js';
import {
  installTestAuth,
  signupVerifiedUser,
  uninstallTestAuth,
  type TestUser,
} from '../../shared/testing/auth.js';
import { DICTIONARIES } from '../../shared/i18n/index.js';
import { User, resolveUserBranding } from './users.model.js';
import { BRANDING_LOGO_MAX_INPUT_BYTES } from './branding-logo.service.js';

const app = createApp();

async function pngDataUrl(width = 24, height = 12): Promise<string> {
  const bytes = await sharp({
    create: {
      width,
      height,
      channels: 4,
      background: { r: 30, g: 90, b: 160, alpha: 0.8 },
    },
  })
    .png({ compressionLevel: 0 })
    .toBuffer();
  return `data:image/png;base64,${bytes.toString('base64')}`;
}

beforeAll(async () => {
  await startMemoryMongo();
  await startTestPostgres();
  installTestAuth();
});

afterAll(async () => {
  uninstallTestAuth();
  await stopTestPostgres();
  await stopMemoryMongo();
});

beforeEach(async () => {
  await clearCollections();
  await truncateAllTables();
});

describe('GET /api/users/branding', () => {
  it('rejects unauthenticated requests', async () => {
    const res = await request(app).get('/api/users/branding');
    expect(res.status).toBe(401);
  });

  it('returns the empty default for a fresh account (no gate)', async () => {
    const user = await signupVerifiedUser(app, { email: 'branding-free@x.co' });
    const res = await request(app).get('/api/users/branding').set('Cookie', user.cookie);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      branding: { companyName: '', accentColor: '', logoDataUrl: null },
    });
  });

  it('returns the empty default when the Mongo mirror doc is missing', async () => {
    const user = await signupVerifiedUser(app, { email: 'branding-gone@x.co' });
    await User.findByIdAndDelete(user.id);
    const res = await request(app).get('/api/users/branding').set('Cookie', user.cookie);
    expect(res.status).toBe(200);
    expect(res.body.branding).toEqual({
      companyName: '',
      accentColor: '',
      logoDataUrl: null,
    });
  });
});

describe('PUT /api/users/branding', () => {
  const put = (user: TestUser, body: unknown) =>
    request(app).put('/api/users/branding').set('Cookie', user.cookie).send(body as object);

  it('rejects unauthenticated requests', async () => {
    const res = await request(app)
      .put('/api/users/branding')
      .send({ companyName: 'Acme', accentColor: '' });
    expect(res.status).toBe(401);
  });

  it('saves and round-trips branding for any verified account (trims the name)', async () => {
    const user = await signupVerifiedUser(app, { email: 'branding-pro@x.co' });
    const res = await put(user, { companyName: '  Acme SEO  ', accentColor: '#3366FF' });
    expect(res.status).toBe(200);
    expect(res.body.branding).toEqual({
      companyName: 'Acme SEO',
      accentColor: '#3366FF',
      logoDataUrl: null,
    });

    const roundTrip = await request(app)
      .get('/api/users/branding')
      .set('Cookie', user.cookie);
    expect(roundTrip.body.branding).toEqual({
      companyName: 'Acme SEO',
      accentColor: '#3366FF',
      logoDataUrl: null,
    });
  });

  it('accepts the empty accent (clears custom branding colors)', async () => {
    const user = await signupVerifiedUser(app, { email: 'branding-clear@x.co' });
    const res = await put(user, { companyName: '', accentColor: '' });
    expect(res.status).toBe(200);
    expect(res.body.branding).toEqual({
      companyName: '',
      accentColor: '',
      logoDataUrl: null,
    });
  });

  it('decodes and re-encodes a PNG before persisting and returns the normalized preview', async () => {
    const user = await signupVerifiedUser(app, { email: 'branding-logo@x.co' });
    const received = await pngDataUrl();
    const res = await put(user, {
      companyName: 'Logo Co',
      accentColor: '#112233',
      logoDataUrl: received,
    });
    expect(res.status).toBe(200);
    expect(res.body.branding.logoDataUrl).toMatch(/^data:image\/png;base64,/);
    expect(res.body.branding.logoDataUrl).not.toBe(received);

    const stored = await User.findById(user.id).select('branding').lean();
    expect(stored?.branding?.logoPngBase64).toBe(
      (res.body.branding.logoDataUrl as string).replace('data:image/png;base64,', ''),
    );
    expect(stored?.branding?.logoWidth).toBe(24);
    expect(stored?.branding?.logoHeight).toBe(12);
  });

  it('preserves an existing logo when logoDataUrl is omitted and removes it on null', async () => {
    const user = await signupVerifiedUser(app, { email: 'branding-logo-state@x.co' });
    const first = await put(user, {
      companyName: 'Logo Co',
      accentColor: '',
      logoDataUrl: await pngDataUrl(),
    });
    const normalized = first.body.branding.logoDataUrl as string;

    const preserved = await put(user, { companyName: 'Renamed', accentColor: '' });
    expect(preserved.body.branding.logoDataUrl).toBe(normalized);
    const removed = await put(user, {
      companyName: 'Renamed',
      accentColor: '',
      logoDataUrl: null,
    });
    expect(removed.body.branding.logoDataUrl).toBeNull();
  });

  it('rejects malformed, oversized, dimension-heavy, and polyglot logos without persisting', async () => {
    const user = await signupVerifiedUser(app, { email: 'branding-logo-bad@x.co' });
    await put(user, { companyName: 'Original', accentColor: '#112233' });
    const valid = Buffer.from((await pngDataUrl()).split(',')[1]!, 'base64');
    const tooWide = await pngDataUrl(1_025, 1);
    const cases = [
      {
        label: 'malformed',
        value: 'data:image/png;base64,bm90LWEtcG5n',
        key: 'logoMalformed',
      },
      {
        label: 'oversized',
        value: `data:image/png;base64,${Buffer.alloc(BRANDING_LOGO_MAX_INPUT_BYTES + 1).toString('base64')}`,
        key: 'logoTooLarge',
      },
      { label: 'dimensions', value: tooWide, key: 'logoDimensions' },
      {
        label: 'polyglot',
        value: `data:image/png;base64,${Buffer.concat([valid, Buffer.from('PKpolyglot')]).toString('base64')}`,
        key: 'logoMalformed',
      },
    ];

    for (const entry of cases) {
      const res = await put(user, {
        companyName: `Changed ${entry.label}`,
        accentColor: '',
        logoDataUrl: entry.value,
      });
      expect(res.status, entry.label).toBe(400);
      expect(res.body.error.message, entry.label).toBe(
        DICTIONARIES.en.branding.errors[
          entry.key as keyof typeof DICTIONARIES.en.branding.errors
        ],
      );
      const stored = await User.findById(user.id).select('branding').lean();
      expect(stored?.branding?.companyName, entry.label).toBe('Original');
      expect(stored?.branding?.accentColor, entry.label).toBe('#112233');
    }
  });

  it('rejects a malformed accent color with 400', async () => {
    const user = await signupVerifiedUser(app, { email: 'branding-badhex@x.co' });
    const res = await put(user, { companyName: 'Acme', accentColor: 'tomato' });
    expect(res.status).toBe(400);
  });

  it('rejects a company name above 80 characters with 400', async () => {
    const user = await signupVerifiedUser(app, { email: 'branding-longname@x.co' });
    const res = await put(user, { companyName: 'x'.repeat(81), accentColor: '' });
    expect(res.status).toBe(400);
  });

  it('rejects unknown fields with 400 (strict schema)', async () => {
    const user = await signupVerifiedUser(app, { email: 'branding-extra@x.co' });
    const res = await put(user, { companyName: 'Acme', accentColor: '', logoUrl: 'x' });
    expect(res.status).toBe(400);
  });

  it('answers 404 when the Mongo mirror doc is missing', async () => {
    const user = await signupVerifiedUser(app, { email: 'branding-orphan@x.co' });
    await User.findByIdAndDelete(user.id);
    const res = await put(user, { companyName: 'Acme', accentColor: '' });
    expect(res.status).toBe(404);
  });
});

describe('resolveUserBranding', () => {
  it('normalizes missing / non-string values to the empty default', () => {
    expect(resolveUserBranding(null)).toEqual({
      companyName: '',
      accentColor: '',
      logoDataUrl: null,
    });
    expect(resolveUserBranding({})).toEqual({
      companyName: '',
      accentColor: '',
      logoDataUrl: null,
    });
    expect(resolveUserBranding({ branding: null })).toEqual({
      companyName: '',
      accentColor: '',
      logoDataUrl: null,
    });
    expect(
      resolveUserBranding({ branding: { companyName: 7, accentColor: undefined } }),
    ).toEqual({ companyName: '', accentColor: '', logoDataUrl: null });
  });

  it('passes through stored strings', () => {
    expect(
      resolveUserBranding({ branding: { companyName: 'Acme', accentColor: '#112233' } }),
    ).toEqual({ companyName: 'Acme', accentColor: '#112233', logoDataUrl: null });
  });
});
