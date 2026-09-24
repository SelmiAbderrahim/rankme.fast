/**
 * Rule `local-pack-not-ranking` — mirrors the `not-indexed`
 * degradation shape: a visibility gap, not a defect to panic over. Always
 * `watch`, never `fix-now`. `localPack === null` means no local-pack
 * keyword is tracked yet — the copy explains how to enable it (opt-in
 * `trackLocalPack` flag on a tracked keyword).
 */
import type { LocalSeoEvaluationInput, LocalSeoRule, RuleFinding } from '../rule.types.js';
const RULE_ID = 'local-pack-not-ranking' as const;
function insufficient(reason: string): RuleFinding {
    return {
        ruleId: RULE_ID,
        bucket: 'watch',
        severity: 'warning',
        affectedUrls: [],
        meta: { insufficientData: true, reason },
    };
}
export const localPackNotRankingRule: LocalSeoRule = {
    id: RULE_ID,
    evaluate(input: LocalSeoEvaluationInput | null): RuleFinding {
        if (input === null || input.status !== 'ok') {
            return insufficient(input?.status ?? 'not-configured');
        }
        if (input.localPack === null) {
            return insufficient('no-local-pack-keyword-tracked');
        }
        if (input.localPack.position === null) {
            return {
                ruleId: RULE_ID,
                bucket: 'watch',
                severity: 'warning',
                affectedUrls: [],
                meta: { keyword: input.localPack.keyword, totalPackSize: input.localPack.totalPackSize },
            };
        }
        return {
            ruleId: RULE_ID,
            bucket: 'passed',
            severity: 'warning',
            affectedUrls: [],
        };
    },
};
