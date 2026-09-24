import { z } from 'zod';

export const PLAY_PACKAGE_ID_REGEX = /^[a-zA-Z][a-zA-Z0-9_]*(\.[a-zA-Z][a-zA-Z0-9_]*)+$/;
export const APP_STORE_ID_REGEX = /^\d{6,12}$/;
export const PLAY_PACKAGE_ID_MAX_LENGTH = 255;
export const APP_STORE_ID_MAX_LENGTH = 12;

export interface AppProfileFormValues {
  playPackageId: string;
  appStoreId: string;
  paired: boolean;
}

type Translate = (key: string) => string;

/** Mirrors the server's format-only registration contract exactly. */
export const buildAppProfileSchema = (t: Translate) =>
  z
    .object({
      playPackageId: z.string().trim().max(PLAY_PACKAGE_ID_MAX_LENGTH, t('validation.playTooLong')),
      appStoreId: z.string().trim().max(APP_STORE_ID_MAX_LENGTH, t('validation.appleFormat')),
      paired: z.boolean(),
    })
    .superRefine((value, context) => {
      if (!value.playPackageId && !value.appStoreId) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: t('validation.storeRequired'),
          path: ['playPackageId'],
        });
      }
      if (value.playPackageId && !PLAY_PACKAGE_ID_REGEX.test(value.playPackageId)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: t('validation.playFormat'),
          path: ['playPackageId'],
        });
      }
      if (value.appStoreId && !APP_STORE_ID_REGEX.test(value.appStoreId)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: t('validation.appleFormat'),
          path: ['appStoreId'],
        });
      }
      if (value.paired && (!value.playPackageId || !value.appStoreId)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: t('validation.pairedRequired'),
          path: ['paired'],
        });
      }
    });
