/**
 * Receipt terminalization/scrubbing helpers shared by processing, explicit
 * monitor deletion, and site/account teardown. They intentionally retain the
 * content-free dedupe/audit tombstone until the receipt TTL expires.
 */
import { MonitorWebhookReceipt } from './monitor.model.js';
const scrubbedNotificationPayload = {
    'notification.recipientEmail': null,
    'notification.senderIdentity': null,
    'notification.targetUrl': null,
    'notification.subject': null,
    'notification.text': null,
    'notification.leaseId': null,
    'notification.leaseUntil': null,
    'notification.providerMessageId': null,
} as const;
/** Terminal-skip one accepted receipt and remove every retained diff fragment. */
export async function terminalSkipMonitorReceipt(receiptId: string, at: Date): Promise<boolean> {
    const withOutbox = await MonitorWebhookReceipt.updateOne({
        _id: receiptId,
        status: { $in: ['received', 'processing', 'notification_pending'] },
        notification: { $ne: null },
    }, {
        $set: {
            status: 'skipped',
            processedAt: at,
            'events.$[].diffText': null,
            'notification.state': 'suppressed',
            'notification.completedAt': at,
            'notification.outcome': 'monitor-deleted',
            'notification.lastFailure': null,
            ...scrubbedNotificationPayload,
        },
    }, { runValidators: true });
    if (withOutbox.matchedCount === 1)
        return true;
    const withoutOutbox = await MonitorWebhookReceipt.updateOne({
        _id: receiptId,
        status: { $in: ['received', 'processing', 'notification_pending'] },
    }, {
        $set: {
            status: 'skipped',
            processedAt: at,
            'events.$[].diffText': null,
        },
    }, { runValidators: true });
    return withoutOutbox.matchedCount === 1;
}
/**
 * Cancel every receipt belonging to a monitor before its local capability is
 * removed. An in-flight `sending` claim is conservatively recorded as unknown;
 * no later replay has a usable recipient/body with which to start a request.
 */
export async function cancelAndScrubMonitorReceipts(monitorId: string, at: Date): Promise<void> {
    await MonitorWebhookReceipt.updateMany({
        monitorId,
        status: 'notification_pending',
        'notification.state': 'sending',
    }, {
        $set: {
            status: 'processed',
            processedAt: at,
            'events.$[].diffText': null,
            'notification.state': 'failed',
            'notification.completedAt': at,
            'notification.outcome': 'provider-outcome-unknown',
            'notification.lastFailure': 'provider-outcome-unknown',
            ...scrubbedNotificationPayload,
        },
    }, { runValidators: true });
    await MonitorWebhookReceipt.updateMany({
        monitorId,
        status: { $in: ['received', 'processing', 'notification_pending'] },
        notification: { $ne: null },
    }, {
        $set: {
            status: 'skipped',
            processedAt: at,
            'events.$[].diffText': null,
            'notification.state': 'suppressed',
            'notification.completedAt': at,
            'notification.outcome': 'monitor-deleted',
            'notification.lastFailure': null,
            ...scrubbedNotificationPayload,
        },
    }, { runValidators: true });
    await MonitorWebhookReceipt.updateMany({
        monitorId,
        status: { $in: ['received', 'processing', 'notification_pending'] },
    }, {
        $set: {
            status: 'skipped',
            processedAt: at,
            'events.$[].diffText': null,
        },
    }, { runValidators: true });
    // Terminal receipts still retain the content-free delivery outcome/dedupe
    // key, but monitor deletion erases their frozen recipient and rendered body.
    await MonitorWebhookReceipt.updateMany({ monitorId, notification: { $ne: null } }, {
        $set: {
            'events.$[].diffText': null,
            ...scrubbedNotificationPayload,
        },
    }, { runValidators: true });
}
