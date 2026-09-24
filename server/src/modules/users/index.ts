// Model + service exports come FIRST so consumers that only need `User` /
// `findUserById` (auth.ts, legal.service.ts) do NOT
// eagerly load `users.routes.ts` — which sits in a cycle with require-auth
// through auth.ts's own `User` import. The router is re-exported LAST so
// app.ts still gets it, but the cycle's Route.get() call runs after every
// middleware in it has been initialized.
export { User, ROLE_MEMBER, ROLE_CLIENT, ROLE_OWNER, ROLE_ADMIN, ROLE_SUPERADMIN, ROLES, ADMIN_ASSIGNABLE_ROLES, getRoleRank, resolveUserBranding, resolveStoredUserBranding, type Role, type AdminAssignableRole, type UserBranding, type StoredUserBranding, type UserDocument, type UserHydrated, } from './users.model.js';
export { toPublicUser, findUserById, getUserBranding, getLanguagePreference, getUserProfile, resolveLanguagePreference, resolveNotificationPreferences, updateNotificationPreferences, updateLanguagePreference, updateUserBranding, DEFAULT_NOTIFICATION_PREFERENCES, NOTIFICATION_CHANNELS, type PublicUser, type NotificationChannel, type NotificationPreferences, type UpdateUserBrandingInput, } from './users.service.js';
export { BRANDING_LOGO_MAX_DIMENSION_PX, BRANDING_LOGO_MAX_INPUT_BYTES, BRANDING_LOGO_MAX_OUTPUT_BYTES, BRANDING_LOGO_MAX_PIXELS, BRANDING_LOGO_OUTPUT_MAX_DIMENSION_PX, assertCompletePngEnvelope, normalizeBrandingLogo, type NormalizedBrandingLogo, } from './branding-logo.service.js';
export { usersRouter } from './users.routes.js';
