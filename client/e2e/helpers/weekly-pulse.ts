/**
 * Weekly-pulse composed-stack helpers.
 *
 * `enqueueWeeklyPulseJob` pushes a REAL job onto the production
 * `weekly-pulse` BullMQ queue through the API image (same deterministic
 * `weekly-pulse-<siteId>-<isoWeek>` job id the scheduler drainer produces,
 * `server/src/shared/queue/queues.ts` → `weeklyPulseJobId`), so the composed
 * worker consumes it through the exact production processor. No alternative
 * code path, no shim.
 */
import { runComposeApiScript } from './compose';

/**
 * `YYYY-Www` UTC ISO-week key — mirrors
 * `server/src/modules/weekly-pulse/schedule.ts` → `isoWeekUtc` (week 1 is the
 * week containing the first Thursday of the year; days shift to that week's
 * Thursday first).
 */
export function isoWeekUtcKey(date: Date = new Date()): string {
  const utc = new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()),
  );
  const isoDow = utc.getUTCDay() === 0 ? 7 : utc.getUTCDay();
  utc.setUTCDate(utc.getUTCDate() + 4 - isoDow);
  const isoYear = utc.getUTCFullYear();
  const jan4 = new Date(Date.UTC(isoYear, 0, 4));
  const jan4Dow = jan4.getUTCDay() === 0 ? 7 : jan4.getUTCDay();
  const week1Monday = new Date(jan4.getTime());
  week1Monday.setUTCDate(jan4.getUTCDate() - jan4Dow + 1);
  const oneDayMs = 24 * 60 * 60 * 1000;
  const week = 1 + Math.round((utc.getTime() - week1Monday.getTime()) / (7 * oneDayMs));
  return `${isoYear}-W${String(week).padStart(2, '0')}`;
}

/**
 * Enqueue one real weekly-pulse collection job for `(accountId, siteId)` in
 * the current ISO week. Values travel as env vars into a fixed script — never
 * interpolated into source (`runComposeApiScript` contract).
 */
export function enqueueWeeklyPulseJob(
  accountId: string,
  siteId: string,
  isoWeek: string = isoWeekUtcKey(),
): void {
  runComposeApiScript(
    `
    const { Queue } = await import('bullmq');
    const queue = new Queue('weekly-pulse', {
      connection: { url: process.env.REDIS_URL },
    });
    const siteId = process.env.SEED_SITE_ID;
    const isoWeek = process.env.SEED_ISO_WEEK;
    await queue.add(
      'weekly-pulse',
      { accountId: process.env.SEED_ACCOUNT_ID, siteId, isoWeek },
      { jobId: 'weekly-pulse-' + siteId + '-' + isoWeek },
    );
    await queue.close();
    `,
    {
      SEED_ACCOUNT_ID: accountId,
      SEED_SITE_ID: siteId,
      SEED_ISO_WEEK: isoWeek,
    },
  );
}
