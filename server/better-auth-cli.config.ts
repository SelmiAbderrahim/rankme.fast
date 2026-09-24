// Config consumed ONLY by `npx @better-auth/cli generate` to (re)emit the
// Drizzle auth schema at src/db/schema/auth.ts. Mirrors the options in
// src/modules/auth/auth.ts that affect the generated tables
// (additionalFields, email+password, google). Not application source — kept
// so the generate + `drizzle-kit generate` path is reproducible. Note:
// `@better-auth/cli migrate` does NOT support the Drizzle adapter; schema
// generation + drizzle-kit SQL migrations is the only supported path.
//
// Regenerate: npx @better-auth/cli@latest generate \
//   --config better-auth-cli.config.ts --output src/db/schema/auth.ts --yes
import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { twoFactor } from 'better-auth/plugins';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';

const client = postgres(process.env.DATABASE_URL ?? 'postgres://localhost:5432/rankme');
const db = drizzle({ client });

export const auth = betterAuth({
  database: drizzleAdapter(db, { provider: 'pg' }),
  baseURL: process.env.SERVER_URL ?? 'http://localhost:8080',
  secret: process.env.BETTER_AUTH_SECRET ?? '0123456789abcdef0123456789abcdef',
  emailAndPassword: { enabled: true },
  user: {
    additionalFields: {
      role: { type: 'string', defaultValue: 'Member', input: false },
    },
  },
  socialProviders: {
    google: {
      clientId: process.env.GOOGLE_CLIENT_ID ?? 'cli-generate-placeholder',
      clientSecret: process.env.GOOGLE_CLIENT_SECRET ?? 'cli-generate-placeholder',
    },
  },
  plugins: [twoFactor({ issuer: 'RankMeFast' })],
});
