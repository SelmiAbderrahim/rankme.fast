export type SpendCachedStatus = 'hit' | 'miss' | 'partial';
export interface SpendPreviewOperation {
    operationKey: string;
    metric: string;
    productUnits: number;
    cachedStatus: SpendCachedStatus;
}
export interface SpendPreviewCoverage {
    observationType: string;
    state: 'supported' | 'unsupported' | 'unknown';
    coverageNoteKey?: string;
}
export interface SpendPreview {
    deploymentMode: 'community';
    capacityEnforced: false;
    feature?: string;
    operation?: string;
    metric?: string;
    productUnits?: number;
    cachedStatus?: SpendCachedStatus;
    breakdown?: SpendPreviewOperation[];
    remainingBaseUnits?: number;
    remainingPackUnits?: number;
    canFit?: boolean;
    coverage?: SpendPreviewCoverage[];
    estimatedAt?: string;
}
export type SaasSpendPreview = SpendPreview;
export type SelfHostSpendPreview = SpendPreview;
export interface MetricUsage {
    used: number;
    limit: number | null;
    remaining: number | null;
}
