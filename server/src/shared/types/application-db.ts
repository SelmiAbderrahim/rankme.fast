import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core';
import type * as schema from '../../db/schema/index.js';
export type ApplicationDb = PgDatabase<PgQueryResultHKT, typeof schema>;
