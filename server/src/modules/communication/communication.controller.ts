import type { RequestHandler } from 'express';
import { asyncHandler } from '../../shared/utils/async-handler.js';
import { sendLocalizedMessage } from '../../shared/i18n/localized-response.js';
import { contactFormSchema } from './communication.schema.js';
import { deliverContactForm } from './communication.service.js';
export const sendContactForm: RequestHandler = asyncHandler(async (req, res) => {
    const input = contactFormSchema.parse(req.body);
    await deliverContactForm(input, req.language);
    sendLocalizedMessage(req, res, 200, 'email.contact.confirmation', {});
});
