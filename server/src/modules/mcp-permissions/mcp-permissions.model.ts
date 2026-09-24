/**
 * Account-level MCP permission defaults.
 *
 * One doc per account. A MISSING doc — and any missing field — is the
 * permissive default: every tool allowed, every owned site reachable,
 * spending allowed. Stored in Mongo (shape-loose per-account settings doc,
 * not relational time-series).
 */
import mongoose, { type InferSchemaType } from 'mongoose';
const mcpPermissionSettingsSchema = new mongoose.Schema({
    // Better Auth user id (ObjectId-compatible hex), same convention as the
    // other account-scoped Mongo docs.
    accountId: { type: String, required: true, unique: true, index: true },
    // Per-tool allow map keyed by registry tool name. Missing key = allowed.
    tools: { type: Map, of: Boolean, default: undefined },
    // Site allow-list (owned site ids). Empty/missing = every owned site.
    allowedSiteIds: { type: [String], default: undefined },
    // Whether spending tools (start_audit) may run through MCP/chat.
    allowSpend: { type: Boolean, default: true },
}, { timestamps: true });
export type McpPermissionSettingsDocument = InferSchemaType<typeof mcpPermissionSettingsSchema>;
export const McpPermissionSettings = mongoose.model('McpPermissionSettings', mcpPermissionSettingsSchema);
