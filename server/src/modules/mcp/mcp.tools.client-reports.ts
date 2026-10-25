/**
 * `list_client_reports` — stored overview of a site's white-label reporting
 * setup: scheduled reports, read-only portal
 * links and the most recent delivery log rows.
 *
 * Mirrors `GET /api/client-reports/sites/:siteId` (+ `/deliveries`). Reads only;
 * nothing composes a PDF, sends an email, or touches a queue.
 *
 * Secrets: the portal DTO is the management shape (id, label, sections,
 * expiry) — never the token, its hash, or any URL. Recipient emails are
 * masked (`j***@example.com`) and delivery rows carry no provider ids or
 * error text, only the stable status/suppression/error codes.
 */
import { env } from '../../config/env.js';
import {
  listClientPortals,
  listDeliveries,
  listSchedules,
} from '../client-reports/index.js';
import { clampRows, runSiteStoredRead } from './mcp.read-kit.js';
import { getMcpDb } from './mcp.holder.js';
import { listClientReportsInputSchema } from './mcp.read-schemas.js';
import type { McpToolContext, McpToolResult } from './mcp.tools.js';

const RECENT_DELIVERY_LIMIT = 20;

/** `jane.doe@example.com` -> `j***@example.com`; anything else -> `***`. */
export function maskRecipient(value: string): string {
  const at = value.lastIndexOf('@');
  if (at < 1) return '***';
  return `${value.slice(0, 1)}***${value.slice(at)}`;
}

export function toolListClientReports(
  rawInput: unknown,
  context: McpToolContext,
): Promise<McpToolResult> {
  return runSiteStoredRead(
    {
      name: 'list_client_reports',
      schema: listClientReportsInputSchema,
      read: async (input, env_) => {
        const db = getMcpDb();
        const [schedules, portals, deliveries] = await Promise.all([
          listSchedules(env_.accountId, input.siteId, db),
          listClientPortals(env_.accountId, input.siteId),
          listDeliveries(
            {
              accountId: env_.accountId,
              siteId: input.siteId,
              query: { limit: RECENT_DELIVERY_LIMIT },
            },
            db,
          ),
        ]);
        if (
          schedules.schedules.length === 0 &&
          portals.portals.length === 0 &&
          deliveries.deliveries.length === 0
        ) {
          return {
            status: 'empty',
            reason: 'notConfigured',
            data: { featureEnabled: env.CLIENT_REPORTS_ENABLED },
          };
        }
        const now = Date.now();
        const scheduleRows = clampRows(
          schedules.schedules.map((row) => ({
            id: row.id,
            name: row.name,
            frequency: row.frequency,
            weekdayUtc: row.weekdayUtc,
            monthdayUtc: row.monthdayUtc,
            hourUtc: row.hourUtc,
            minuteUtc: row.minuteUtc,
            locale: row.locale,
            recipientCount: row.recipients.length,
            recipients: row.recipients.map(maskRecipient),
            sections: row.sections,
            enabled: row.enabled,
            nextRunAt: row.nextRunAt,
            lastRunAt: row.lastRunAt,
            createdAt: row.createdAt,
          })),
        );
        const portalRows = clampRows(
          portals.portals.map((row) => ({
            id: row.id,
            clientLabel: row.clientLabel,
            locale: row.locale,
            sections: row.sections,
            status:
              row.revokedAt !== null
                ? 'revoked'
                : Date.parse(row.expiresAt) <= now
                  ? 'expired'
                  : 'active',
            expiresAt: row.expiresAt,
            revokedAt: row.revokedAt,
            createdAt: row.createdAt,
          })),
        );
        const deliveryRows = clampRows(
          deliveries.deliveries.map((row) => ({
            id: row.id,
            scheduleId: row.scheduleId,
            recipient: maskRecipient(row.recipient),
            status: row.status,
            suppressionReason: row.suppressionReason,
            errorCode: row.errorCode,
            snapshotDate: row.snapshotDate,
            createdAt: row.createdAt,
            finishedAt: row.finishedAt,
          })),
        );
        return {
          status: 'ok',
          count:
            scheduleRows.rows.length + portalRows.rows.length + deliveryRows.rows.length,
          truncated:
            scheduleRows.truncated ||
            portalRows.truncated ||
            deliveryRows.truncated ||
            deliveries.nextCursor !== null,
          data: {
            featureEnabled: env.CLIENT_REPORTS_ENABLED,
            source: 'stored_client_report_settings',
            schedules: scheduleRows.rows,
            portals: portalRows.rows,
            recentDeliveries: deliveryRows.rows,
          },
        };
      },
    },
    rawInput,
    context,
  );
}
