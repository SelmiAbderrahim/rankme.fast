import { sql, type SQL } from 'drizzle-orm';
import type { PgColumn } from 'drizzle-orm/pg-core';

export function escapeLikePattern(input: string): string {
    return input.replace(/[\\%_]/g, '\\$&');
}

/** A parameterized literal substring search, including user-typed wildcard characters. */
export function ilikeContains(column: PgColumn, search: string): SQL {
    return sql`${column} ilike ${`%${escapeLikePattern(search)}%`} escape '\\'`;
}
