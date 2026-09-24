/**
 * Minimal typings for `arabic-persian-reshaper` (MIT, zero-dependency CJS).
 * Only the Arabic shaper is consumed — see `modules/audits/pdf/rtl.ts`.
 */
declare module 'arabic-persian-reshaper' {
    export const ArabicShaper: {
        /** Map logical Arabic text onto Unicode Arabic Presentation Forms. */
        convertArabic(input: string): string;
        convertArabicBack(input: string): string;
    };
    export const PersianShaper: {
        convertArabic(input: string): string;
        convertArabicBack(input: string): string;
    };
}
