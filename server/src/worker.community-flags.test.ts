import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync(new URL('./worker.ts', import.meta.url), 'utf8');
const singletonStart = source.indexOf('const singletonSchedulers:');
const singletonEnd = source.indexOf('const schedulerReconciler =', singletonStart);
const singletonBlock = source.slice(singletonStart, singletonEnd);

const durableConsumers = [
  ['internalLinksWorker', 'INTERNAL_LINKING_ENABLED', 'INTERNAL_LINKS_QUEUE'],
  ['keywordClustersWorker', 'KEYWORD_CLUSTERING_ENABLED', 'KEYWORD_CLUSTERING_QUEUE'],
  ['contentBriefWorker', 'CONTENT_BRIEFS_ENABLED', 'CONTENT_BRIEF_QUEUE'],
  ['geogridWorker', 'GEOGRID_ENABLED', 'GEOGRID_QUEUE'],
  ['contentMonitorWorker', 'CONTENT_MONITORING_ENABLED', 'CONTENT_MONITOR_QUEUE'],
  ['brandRadarWorker', 'BRAND_RADAR_ENABLED', 'BRAND_RADAR_QUEUE'],
  ['alertDispatchWorker', 'ALERTS_ENABLED', 'ALERT_DISPATCH_QUEUE'],
  ['clientReportsWorker', 'CLIENT_REPORTS_ENABLED', 'CLIENT_REPORTS_QUEUE'],
] as const;

describe('community worker kill switches', () => {
  it.each(durableConsumers)(
    'keeps %s subscribed while %s gates producers, including shutdown/readiness',
    (workerName, flag, queueName) => {
      expect(source).toContain(`const ${workerName} = new Worker(`);
      expect(source).not.toMatch(
        new RegExp(`const ${workerName} = env\\.${flag}\\s*\\? new Worker\\(`),
      );
      expect(source.match(new RegExp(`wireDeadLetter\\(${workerName},`, 'g'))).toHaveLength(1);
      expect(source).not.toMatch(
        new RegExp(`if \\(${workerName}\\) \\{\\s*wireDeadLetter\\(${workerName},`),
      );
      expect(source).toContain(`      ${workerName},`);
      expect(source).toContain(`        ${queueName},`);
    },
  );

  it('keeps accepted-work reconciliation live while producer flags are disabled', () => {
    for (const workerName of [
      'alertSweepWorker',
      'contentMonitorReconWorker',
      'brandRadarReconWorker',
    ]) {
      expect(source).toContain(`const ${workerName} = new Worker(`);
      expect(source).toContain(`      ${workerName},`);
    }
    expect(singletonBlock).toMatch(
      /key: ALERT_SWEEP_SCHEDULER_KEY,[\s\S]*?desired: env\.ALERTS_ENABLED/,
    );
    expect(source).toContain("name: 'client report schedules'");
    expect(source).toMatch(
      /reconcileClientReportSchedulers\(\s*queues\.clientReports,\s*schedules,\s*env\.CLIENT_REPORTS_ENABLED,?\s*\)/,
    );
    expect(source).toContain("name: 'content monitor receipt reconciliation schedule'");
    expect(source).toContain("name: 'brand radar accepted-run reconciliation schedule'");
    expect(source).not.toContain(
      'contentMonitorReconQueue.removeJobScheduler',
    );
    expect(source).not.toContain('brandRadarReconQueue.removeJobScheduler');
  });

  it('enrolls every worker-owned singleton scheduler in live reconciliation', () => {
    expect(singletonStart).toBeGreaterThan(0);
    expect(singletonEnd).toBeGreaterThan(singletonStart);

    const upsertKeys = new Set(
      [...source.matchAll(/\.upsertJobScheduler\(\s*([A-Z][A-Z0-9_]*_SCHEDULER_KEY)/g)]
        .map((match) => match[1]!),
    );
    const enrolledKeys = new Set(
      [...singletonBlock.matchAll(/key:\s*([A-Z][A-Z0-9_]*_SCHEDULER_KEY)/g)]
        .map((match) => match[1]!),
    );
    expect([...upsertKeys].sort()).toEqual([...enrolledKeys].sort());
    expect(upsertKeys.size).toBe(10);
    const promotionRefreshKeys = new Set(
      [
        ...source.matchAll(
          /withRegisteredSingletonRefresh\(\s*([A-Z][A-Z0-9_]*_SCHEDULER_KEY)/g,
        ),
      ].map((match) => match[1]!),
    );
    expect([...promotionRefreshKeys].sort()).toEqual([...enrolledKeys].sort());
    const readyWait = source.indexOf('await singletonPromotionRefreshersReady;');
    const catalogPopulation = source.indexOf(
      'for (const scheduler of singletonSchedulers)',
    );
    const readySignal = source.indexOf(
      'markSingletonPromotionRefreshersReady();',
    );
    expect(readyWait).toBeGreaterThan(0);
    expect(catalogPopulation).toBeGreaterThan(readyWait);
    expect(readySignal).toBeGreaterThan(catalogPopulation);

    // Boot-only upserts reintroduce the live-Redis-restart failure mode. All
    // singleton installs must remain inside the reconciler-owned catalog.
    const outsideCatalog = source.slice(0, singletonStart) + source.slice(singletonEnd);
    expect(outsideCatalog).not.toContain('.upsertJobScheduler(');

    // Per-row schedules are recovered by their durable DB reconcilers rather
    // than the singleton catalog.
    for (const call of [
      'reconcileRankSchedules(',
      'reconcilePulseSchedulers(',
      'reconcileClientReportSchedulers(',
    ]) {
      expect(source).toContain(call);
    }
  });
});
