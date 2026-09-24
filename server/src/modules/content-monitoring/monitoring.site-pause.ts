/**
 * Site-pause cascade for content monitors (pause-site feature).
 *
 * A paused site must stop ALL vendor spend — Firecrawl keeps crawling (and
 * billing the operator) unless each active monitor is paused vendor-side too.
 * These helpers are best-effort per monitor: a provider failure logs and
 * moves on (the site-level sweep filters skip paused sites), and the
 * drift sweep reconciles vendor state later.
 *
 * Deliberately a leaf file: monitoring.service.ts imports the sites BARREL
 * (`../sites/index.js`), so sites.service.ts must not import it back. This
 * file only touches the monitor model, the state guard, the holders, and
 * shared crypto/config — no sites import in either direction.
 */
import { decryptSecret } from '../../shared/crypto/index.js';
import { env } from '../../config/env.js';
import { logger } from '../../config/logger.js';
import { HttpError } from '../../shared/utils/http-error.js';
import { ContentMonitor } from './monitor.model.js';
import { assertContentMonitorTransition } from './monitoring.state.js';
import { getContentMonitorProvider } from './monitoring.holders.js';
import { cancelAndScrubMonitorReceipts } from './monitoring.receipts.js';
/**
 * Pauses every ACTIVE monitor of the site, stamping `pausedBy: 'site'` so a
 * later site resume knows which monitors it may auto-resume. Returns the
 * number of monitors transitioned. Provider absent (fake/off) → the local
 * state still flips; there is no vendor side to pause.
 */
export async function pauseMonitorsForSite(siteId: string): Promise<number> {
    const provider = getContentMonitorProvider();
    const monitors = await ContentMonitor.find({ siteId, status: 'active' });
    let paused = 0;
    for (const doc of monitors) {
        try {
            assertContentMonitorTransition(doc.status, 'paused');
            if (provider) {
                await provider.pauseMonitor({
                    providerMonitorId: decryptSecret(doc.providerMonitorIdEncrypted as never),
                    ...(doc.providerCredentialRef
                        ? { providerCredentialRef: doc.providerCredentialRef }
                        : {}),
                    timeoutMs: env.FIRECRAWL_TIMEOUT_MS,
                });
            }
            doc.status = 'paused';
            doc.pausedBy = 'site';
            await doc.save();
            paused += 1;
        }
        catch (err) {
            logger.warn({ err, monitorId: String(doc._id), siteId }, 'site pause: monitor pause failed — continuing (best-effort)');
        }
    }
    return paused;
}
/**
 * Resumes only the monitors THIS cascade paused (`pausedBy: 'site'`). A
 * user-paused monitor stays paused — the site resume must not override an
 * explicit user decision.
 */
export async function resumeMonitorsForSite(siteId: string): Promise<number> {
    const provider = getContentMonitorProvider();
    const monitors = await ContentMonitor.find({
        siteId,
        status: 'paused',
        pausedBy: 'site',
    });
    let resumed = 0;
    for (const doc of monitors) {
        try {
            assertContentMonitorTransition(doc.status, 'active');
            if (provider) {
                await provider.resumeMonitor({
                    providerMonitorId: decryptSecret(doc.providerMonitorIdEncrypted as never),
                    ...(doc.providerCredentialRef
                        ? { providerCredentialRef: doc.providerCredentialRef }
                        : {}),
                    timeoutMs: env.FIRECRAWL_TIMEOUT_MS,
                });
            }
            doc.status = 'active';
            doc.pausedBy = null;
            doc.error = null;
            await doc.save();
            resumed += 1;
        }
        catch (err) {
            logger.warn({ err, monitorId: String(doc._id), siteId }, 'site resume: monitor resume failed — continuing (best-effort)');
        }
    }
    return resumed;
}
/**
 * Deletes every vendor-side monitor before its encrypted local capability is
 * removed by the site cascade. Unlike pause, deletion is fail-closed: a
 * provider/configuration failure aborts the site deletion and keeps the local
 * document available for an idempotent retry. Successful remote teardown does
 * NOT delete the parent here: the generic Mongo graph purge still needs that
 * parent edge to discover MonitorEvidence descendants.
 */
export async function deleteMonitorsForSite(siteId: string): Promise<number> {
    const monitors = await ContentMonitor.find({ siteId });
    if (monitors.length === 0)
        return 0;
    const provider = getContentMonitorProvider();
    if (!provider) {
        throw new HttpError(503, { code: 'CONTENT_INTELLIGENCE_MONITORING_ERRORS_UNAVAILABLE_RUNTIME', messageKey: 'contentIntelligence.monitoring.errors.unavailableRuntime' });
    }
    let deleted = 0;
    for (const doc of monitors) {
        const deletionStartedAt = doc.deletionStartedAt ?? new Date();
        await ContentMonitor.updateOne({ _id: doc._id, deletionStartedAt: null }, { $set: { deletionStartedAt } }, { runValidators: true });
        try {
            await provider.deleteMonitor({
                providerMonitorId: decryptSecret(doc.providerMonitorIdEncrypted as never),
                ...(doc.providerCredentialRef
                    ? { providerCredentialRef: doc.providerCredentialRef }
                    : {}),
                timeoutMs: env.FIRECRAWL_TIMEOUT_MS,
            });
        }
        catch {
            throw new HttpError(502, { code: 'CONTENT_INTELLIGENCE_MONITORING_ERRORS_PROVIDER_FAILED', messageKey: 'contentIntelligence.monitoring.errors.providerFailed' });
        }
        await cancelAndScrubMonitorReceipts(String(doc._id), deletionStartedAt);
        deleted += 1;
    }
    return deleted;
}
