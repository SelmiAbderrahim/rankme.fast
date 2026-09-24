import { eq } from 'drizzle-orm';

import { featureFlags, type FeatureFlagKey } from '../../db/schema/feature-flags.js';
import type { ApplicationDb } from '../types/application-db.js';

/** Operator kill switches remain enforced independently of customer access. */
export async function isKillSwitchEnabled(
    db: ApplicationDb,
    key: FeatureFlagKey,
): Promise<boolean> {
    const [row] = await db
        .select({ enabled: featureFlags.enabled })
        .from(featureFlags)
        .where(eq(featureFlags.key, key))
        .limit(1);

    return row?.enabled ?? true;
}
