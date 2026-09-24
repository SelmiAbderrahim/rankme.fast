import type express from 'express';
import { describe, expect, it, vi } from 'vitest';
import { createConversationHandler } from './chat.controller.js';
import { resolveChatConversationSiteId } from './chat.routes.js';

describe('chat workspace boundaries', () => {
  it('maps the route actor and conversation id into the site resolver', async () => {
    const req = {
      params: { id: 'not-an-object-id' },
      user: { id: 'account-one' },
    } as unknown as express.Request;

    await expect(resolveChatConversationSiteId(req)).resolves.toBeNull();
  });

  it('hides account-wide conversation creation from selected-site members', async () => {
    const req = {
      body: {},
      language: 'en',
      teamSiteAccessMode: 'selected',
      user: { id: 'account-one' },
    } as unknown as express.Request;
    const next = vi.fn();

    createConversationHandler(req, {} as express.Response, next);

    await vi.waitFor(() => expect(next).toHaveBeenCalledOnce());
    expect(next).toHaveBeenCalledWith(
      expect.objectContaining({
        message: 'chat.errors.notFound',
        status: 404,
      }),
    );
  });
});
