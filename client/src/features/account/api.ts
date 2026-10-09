import { apiClient } from '@shared/api/client';
import type { DataExport } from './types';

/** GDPR data export — auth only, returns the account JSON blob. */
export const exportMyDataRequest = (): Promise<DataExport> =>
  apiClient<DataExport>('/legal/export', {
    method: 'POST',
    localeMode: 'artifact',
    allowLegacyNullContentLanguage: true,
  });
