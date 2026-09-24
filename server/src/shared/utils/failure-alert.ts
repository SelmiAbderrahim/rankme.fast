/**
 * Failure-alert helper.
 *
 * Posts a JSON alert payload to `ALERT_WEBHOOK_URL` when it is configured.
 * Missing config degrades gracefully (log at debug, return silently) —
 * consistent with how the repo treats other optional operator wiring
 * (Resend, alert email, etc.). Callers do not need to guard on the env flag.
 */
import { env } from '../../config/env.js';
import { logger } from '../../config/logger.js';
export interface FailureAlertPayload {
    subject: string;
    body: Record<string, unknown>;
}
export interface SendFailureAlertOptions {
    /** Test seam. Defaults to the global `fetch`. */
    fetch?: typeof fetch;
    /** Test seam. Defaults to the env-resolved ALERT_WEBHOOK_URL. */
    url?: string | undefined;
}
export async function sendFailureAlert(payload: FailureAlertPayload, opts: SendFailureAlertOptions = {}): Promise<{
    delivered: boolean;
    reason?: string;
}> {
    const url = opts.url ?? env.ALERT_WEBHOOK_URL;
    if (!url) {
        logger.debug({ subject: payload.subject }, 'ALERT_WEBHOOK_URL unset — alert skipped');
        return { delivered: false, reason: 'unconfigured' };
    }
    const fetchImpl = opts.fetch ?? fetch;
    try {
        const res = await fetchImpl(url, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
                subject: payload.subject,
                body: payload.body,
                emittedAt: new Date().toISOString(),
            }),
            signal: AbortSignal.timeout(5000),
        });
        if (!res.ok) {
            logger.warn({ status: res.status, subject: payload.subject }, 'alert webhook returned non-2xx');
            return { delivered: false, reason: `status ${res.status}` };
        }
        return { delivered: true };
    }
    catch (err) {
        logger.warn({ err, subject: payload.subject }, 'alert webhook POST failed');
        const reason = (err as {
            name?: string;
        })?.name === 'TimeoutError' ? 'timeout' : 'fetch failed';
        return { delivered: false, reason };
    }
}
