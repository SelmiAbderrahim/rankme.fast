const MAX_ROBOTS_BYTES = 512 * 1024;
const MAX_PATTERN_LENGTH = 1024;
const MAX_RULES_PER_GROUP = 5000;
interface RobotsRule { allow: boolean; pattern: string }
interface RobotsGroup { agents: string[]; rules: RobotsRule[] }

function parseGroups(body: string): RobotsGroup[] | null {
    if (body.length > MAX_ROBOTS_BYTES)
        return null;
    const groups: RobotsGroup[] = [];
    let current: RobotsGroup | null = null;
    let collectingAgents = false;
    for (const raw of body.split(/\r?\n/)) {
        const line = raw.replace(/#.*$/, '').trim();
        const colon = line.indexOf(':');
        if (colon <= 0)
            continue;
        const field = line.slice(0, colon).trim().toLowerCase();
        const value = line.slice(colon + 1).trim();
        if (field === 'user-agent') {
            if (!current || !collectingAgents) {
                current = { agents: [], rules: [] };
                groups.push(current);
            }
            current.agents.push(value.toLowerCase());
            collectingAgents = true;
            continue;
        }
        collectingAgents = false;
        if ((field === 'allow' || field === 'disallow') && current) {
            // Incomplete rule sets cannot prove a block: omitted Allow rules
            // or shortened Disallow patterns would change the verdict.
            if (current.rules.length >= MAX_RULES_PER_GROUP || value.length > MAX_PATTERN_LENGTH)
                return null;
            current.rules.push({ allow: field === 'allow', pattern: value });
        }
    }
    return groups;
}

/** Iterative glob matching avoids regex backtracking on untrusted robots files. */
function matchesPattern(pattern: string, path: string): boolean {
    const anchored = pattern.endsWith('$');
    const body = anchored ? pattern.slice(0, -1) : pattern;
    let p = 0;
    let t = 0;
    let starP = -1;
    let starT = 0;
    while (t < path.length) {
        if (p === body.length && !anchored)
            return true;
        if (p < body.length && body[p] === '*') {
            starP = p;
            starT = t;
            p += 1;
        }
        else if (p < body.length && body[p] === path[t]) {
            p += 1;
            t += 1;
        }
        else if (starP !== -1) {
            p = starP + 1;
            starT += 1;
            t = starT;
        }
        else {
            break;
        }
    }
    if (t < path.length)
        return false;
    while (p < body.length && body[p] === '*')
        p += 1;
    return p === body.length;
}

/** Longest matching rule wins; an Allow wins a tie. Default evaluates wildcard crawlers. */
export function robotsDisallows(body: string, pathWithQuery: string, userAgent = '*'): boolean {
    const groups = parseGroups(body);
    if (groups === null)
        return false;
    const agent = userAgent.toLowerCase();
    const named = agent === '*' ? [] : groups.filter(group => group.agents.some(value => value !== '*' && agent.includes(value)));
    const selected = named.length > 0 ? named : groups.filter(group => group.agents.includes('*'));
    let best: { allow: boolean; length: number } | null = null;
    for (const group of selected) {
        for (const rule of group.rules) {
            if (rule.pattern === '' || !matchesPattern(rule.pattern, pathWithQuery))
                continue;
            const length = rule.pattern.length;
            if (!best || length > best.length || (length === best.length && rule.allow && !best.allow))
                best = { allow: rule.allow, length };
        }
    }
    return best !== null && !best.allow;
}
