import { createHash } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { accountDeletionTombstones } from '../../db/schema/index.js';
import type { ApplicationDb } from '../types/application-db.js';

const ACCOUNT_PSEUDONYM_DOMAIN = 'rankme.fast:deleted-account:v1\0';

export function deletedAccountPseudonym(accountId: string): string {
  return `deleted_${createHash('sha256')
    .update(ACCOUNT_PSEUDONYM_DOMAIN)
    .update(accountId)
    .digest('hex')}`;
}

export async function installAccountDeletionBarrier(
  db: ApplicationDb,
  accountId: string,
  deletionStartedAt: Date,
): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${accountId}))`);
    await tx
      .insert(accountDeletionTombstones)
      .values({ accountId, deletionStartedAt })
      .onConflictDoNothing({ target: accountDeletionTombstones.accountId });
  });
}
