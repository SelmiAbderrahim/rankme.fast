export { createAuth, createBetterAuthLogger, getAuth, setAuth, splitName, mirrorUserCreate, mirrorUserUpdate, rejectUnboundDirectOAuthTokens, type Auth, type AuthDatabase, } from './auth.js';
export { deleteProvisionedIdentity, decryptInvitationPassword, encryptInvitationPassword, generateTemporaryPassword, isPendingProvisionedIdentity, provisionInvitationIdentity, verifyAndClaimInvitationIdentity, type ProvisionedIdentity, } from './provisional-account.js';
export { requireVerified } from './verified.js';
export { requireClaimedAccount } from './provisional.js';
export { BETTER_AUTH_ERROR_KEYS, RANKME_AUTH_ERROR_CODES, REACHABLE_BETTER_AUTH_ERROR_CODES, localizeBetterAuthResponse, type ReachableAuthErrorCode, } from './better-auth-errors.js';
export { backfillStoredOAuthTokens, ensureStoredOAuthTokenEncrypted, hardenOAuthAccountMutation, looksLikeBetterAuthOAuthCiphertext, OAuthTokenDecryptionError, resolveStoredOAuthToken, type OAuthTokenBackfillResult, } from './oauth-token.js';
export { seedSuperadmin, type SeedResult, type SeedReason, } from './superadmin-seed.js';
