import { randomBytes } from 'node:crypto';
import { decryptSecret, encryptSecret, type EncryptedSecret, } from '../../shared/crypto/index.js';
import { User } from '../users/users.model.js';
import { getAuth } from './auth.js';
export interface ProvisionedIdentity {
    userId: string;
    email: string;
    temporaryPassword: string;
}
function invitationPasswordAad(userId: string, email: string): string {
    return `team_provisioned_accounts:${userId}:${email.trim().toLowerCase()}:temporary_password`;
}
export function encryptInvitationPassword(userId: string, email: string, temporaryPassword: string): EncryptedSecret {
    return encryptSecret(temporaryPassword, { aad: invitationPasswordAad(userId, email) });
}
export function decryptInvitationPassword(userId: string, email: string, encrypted: EncryptedSecret): string {
    return decryptSecret(encrypted, { aad: invitationPasswordAad(userId, email) });
}
/** 24 random bytes = 192 bits, comfortably above the 128-bit requirement. */
export function generateTemporaryPassword(): string {
    return randomBytes(24).toString('base64url');
}
/**
 * Narrow, server-only account provisioning boundary. It uses the same Better
 * Auth context as normal signup, so Better Auth owns hashing and persistence,
 * but creates neither a session nor a second verification email.
 */
export async function provisionInvitationIdentity(email: string, temporaryPassword = generateTemporaryPassword(), auth = getAuth(), onIdentityCreated?: (userId: string) => void): Promise<ProvisionedIdentity> {
    const context = await auth.$context;
    const normalizedEmail = email.trim().toLowerCase();
    const passwordHash = await context.password.hash(temporaryPassword);
    const created = await context.internalAdapter.createUser({
        email: normalizedEmail,
        name: normalizedEmail.slice(0, normalizedEmail.indexOf('@')),
        emailVerified: false,
        role: 'Member',
        mustChangePassword: true,
        provisionalAccount: true,
    });
    if (!created)
        throw new Error('Better Auth did not create the invited identity');
    // The caller may be running Better Auth on a transaction-bound adapter.
    // Report creation before linking the credential so it can remove any
    // out-of-transaction mirror if the transaction subsequently rolls back.
    onIdentityCreated?.(created.id);
    try {
        await context.internalAdapter.linkAccount({
            userId: created.id,
            providerId: 'credential',
            accountId: created.id,
            password: passwordHash,
        });
    }
    catch (error) {
        // A failed SQL statement can leave a transaction-bound adapter unusable.
        // Best-effort cleanup here handles the Mongo mirror immediately; the
        // caller's rollback cleanup is the authoritative second pass.
        await Promise.allSettled([
            context.internalAdapter.deleteUser(created.id),
            User.deleteOne({ _id: created.id }),
        ]);
        throw error;
    }
    return { userId: created.id, email: normalizedEmail, temporaryPassword };
}
export async function verifyAndClaimInvitationIdentity(userId: string): Promise<void> {
    const context = await getAuth().$context;
    await context.internalAdapter.updateUser(userId, {
        emailVerified: true,
        mustChangePassword: false,
        provisionalAccount: false,
    });
}
/** Deletes only after the team service has durably proven provisional ownership. */
export async function deleteProvisionedIdentity(userId: string): Promise<void> {
    const context = await getAuth().$context;
    const identity = await context.internalAdapter.findUserById(userId);
    const normalizedEmail = identity?.email.trim().toLowerCase();
    // Mongo first: if it fails, the FK-backed provisioning marker remains in
    // `deleting` so reconciliation can retry. Better Auth deletion then
    // cascades credential/session/provenance rows atomically in Postgres.
    await User.deleteOne({ _id: userId });
    await context.adapter.deleteMany({
        model: 'verification',
        where: [{ field: 'value', value: userId }],
    });
    if (normalizedEmail) {
        // Better Auth uses both user ids and normalized email identifiers across
        // verification/password-reset flows. Purge both shapes before removing
        // the identity, matching the permanent account-erasure boundary.
        await context.adapter.deleteMany({
            model: 'verification',
            where: [{ field: 'identifier', value: normalizedEmail }],
        });
    }
    await context.internalAdapter.deleteUserSessions(userId);
    await context.internalAdapter.deleteUser(userId);
}
export async function isPendingProvisionedIdentity(userId: string, auth = getAuth()): Promise<boolean> {
    const context = await auth.$context;
    const found = await context.internalAdapter.findUserById(userId);
    return Boolean((found as {
        mustChangePassword?: unknown;
    } | null)?.mustChangePassword);
}
