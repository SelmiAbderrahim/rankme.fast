import type { SpendPreview } from '../../shared/safety/operation-preview.js';
import { env } from '../../config/env.js';
import { HttpError } from '../../shared/utils/http-error.js';
import { TRAFFIC_SNAPSHOT_UNAVAILABLE_KEY, } from './traffic-snapshots.service.js';
/**
 * Read-only preview for one to five domains. The community edition enforces
 * no plan capacity, so the preview only honours the kill switch and reports
 * the community deployment discriminant. It never probes the cache, starts a
 * single-flight, or calls a provider.
 */
export function previewTrafficSnapshotSpend(): SpendPreview {
    if (!env.TRAFFIC_INSIGHTS_ENABLED) {
        throw new HttpError(503, { code: 'TRAFFIC_SNAPSHOT_UNAVAILABLE', messageKey: TRAFFIC_SNAPSHOT_UNAVAILABLE_KEY });
    }
    return { deploymentMode: 'community', capacityEnforced: false };
}
