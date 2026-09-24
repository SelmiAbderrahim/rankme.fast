import type { AiVisibilityEvaluationInput, AiVisibilityRule, RuleFinding, } from './rule.types.js';
const RULE_ID = 'ai-visibility-low' as const;
function insufficient(reason: string): RuleFinding {
    return {
        ruleId: RULE_ID,
        bucket: 'watch',
        severity: 'warning',
        affectedUrls: [],
        meta: { insufficientData: true, reason },
    };
}
export const aiVisibilityLowRule: AiVisibilityRule = {
    id: RULE_ID,
    evaluate(input: AiVisibilityEvaluationInput | null): RuleFinding {
        if (input === null || input.status !== 'ok') {
            return insufficient(input?.status ?? 'unavailable');
        }
        const noPresence = input.aiOverviewTotalChecked > 0 &&
            input.llmTotalChecked > 0 &&
            input.aiOverviewCitedCount + input.llmMentionedCount === 0;
        const zeroShareOfVoice = input.competitorsPresent && input.shareOfVoicePct === 0;
        const negativePlurality = input.negativeSentimentCount > 0 &&
            input.negativeSentimentCount > input.llmTotalChecked / 2;
        if (noPresence || zeroShareOfVoice || negativePlurality) {
            return {
                ruleId: RULE_ID,
                bucket: 'watch',
                severity: 'warning',
                affectedUrls: [],
                meta: {
                    noPresence,
                    zeroShareOfVoice,
                    negativePlurality,
                    shareOfVoicePct: input.shareOfVoicePct,
                    negativeSentimentCount: input.negativeSentimentCount,
                },
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
