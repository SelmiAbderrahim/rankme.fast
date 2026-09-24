import { Router } from 'express';
import { sendContactForm } from './communication.controller.js';
// The per-IP contact-form limiter is mounted in app.ts
// (`createContactRateLimiter()`) so tests can rebuild the MemoryStore via
// `createApp()` after mutating env — mirrors the auth-limiter pattern.
export const communicationRouter: Router = Router();
communicationRouter.post('/contact', sendContactForm);
