import { z } from 'zod';
// Bounded lengths on every field so an attacker cannot feed a multi-MB blob
// through the free /api/communication/contact endpoint. The name
// fields are also stripped of `\r`, `\n`, `<`, and `>` in the service before
// they land in the `From:` header — the zod parse rejects nothing so a name
// that survives sanitization empty still yields a 400 upstream.
export const contactFormSchema = z.object({
    firstName: z.string().min(1).max(100),
    lastName: z.string().min(1).max(100),
    email: z.string().email().max(320),
    subject: z.string().min(1).max(200),
    message: z.string().min(1).max(5000),
});
export type ContactFormInput = z.infer<typeof contactFormSchema>;
