import { registerSource } from '../actions.registry.js';
import { auditActionAdapter } from './audit.adapter.js';
import { rankActionAdapter } from './rank.adapter.js';
import { gscActionAdapter } from './gsc.adapter.js';
import { ga4ActionAdapter } from './ga4.adapter.js';
import { contentActionAdapter } from './content.adapter.js';
import { audienceResearchActionAdapter } from './audience-research.adapter.js';
import { competitorOpportunityActionAdapter } from './competitor-opportunity.adapter.js';
let registered = false;
export function registerBuiltInActionAdapters(): void {
    if (registered)
        return;
    registered = true;
    registerSource('audit_finding', auditActionAdapter);
    registerSource('confirmed_rank_drop', rankActionAdapter);
    registerSource('gsc_decline', gscActionAdapter);
    registerSource('ga4_decline', ga4ActionAdapter);
    registerSource('content_recommendation', contentActionAdapter);
    registerSource('audience_research', audienceResearchActionAdapter);
    registerSource('competitor_opportunity', competitorOpportunityActionAdapter);
}
export { auditActionAdapter } from './audit.adapter.js';
export { rankActionAdapter } from './rank.adapter.js';
export { gscActionAdapter } from './gsc.adapter.js';
export { ga4ActionAdapter } from './ga4.adapter.js';
export { contentActionAdapter } from './content.adapter.js';
export { audienceResearchActionAdapter } from './audience-research.adapter.js';
export { competitorOpportunityActionAdapter } from './competitor-opportunity.adapter.js';
