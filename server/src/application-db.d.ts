import type { ApplicationDb as SharedApplicationDb } from './shared/types/application-db.js';

declare global {
    /** Database handle shared by server feature modules. */
    type ApplicationDb = SharedApplicationDb;
}
