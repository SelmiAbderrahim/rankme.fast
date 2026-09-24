/**
 * Controller-level guards the router can never reach: the
 * defence-in-depth 401 when `requireAuth` did not populate `req.user`, and the
 * production-db fallback of the injectable holder.
 */
import type { NextFunction, Request, Response } from 'express';
import { afterEach, describe, expect, it } from 'vitest';
import { db as productionDb } from '../../db/client.js';
import { HttpError } from '../../shared/utils/http-error.js';
import { setCannibalizationDb } from './cannibalization.holder.js';
import {
  generateReportController,
  getReportController,
  listReportsController,
  previewReportController,
  resolveCannibalizationDb,
} from './cannibalization.controller.js';

afterEach(() => {
  setCannibalizationDb(null);
});

describe('resolveCannibalizationDb', () => {
  it('falls back to the production client when nothing is injected', () => {
    setCannibalizationDb(null);
    expect(resolveCannibalizationDb()).toBe(productionDb);
  });

  it('prefers the injected client', () => {
    const injected = { marker: true } as never;
    setCannibalizationDb(injected);
    expect(resolveCannibalizationDb()).toBe(injected);
  });
});

describe('requireUser', () => {
  it.each([
    ['preview', previewReportController],
    ['generate', generateReportController],
    ['list', listReportsController],
    ['detail', getReportController],
  ])('%s raises 401 when the session is missing', async (_name, controller) => {
    const req = { params: {}, query: {}, body: {} } as unknown as Request;
    const res = {} as Response;
    let captured: unknown;
    const next: NextFunction = (err) => {
      captured = err;
    };
    await controller(req, res, next);
    expect(captured).toBeInstanceOf(HttpError);
    expect((captured as HttpError).status).toBe(401);
  });
});
