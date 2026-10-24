import type { Express, Router } from 'express';

interface ExpressLayer {
    route?: { path: string | string[]; methods: Record<string, boolean> };
    name: string;
    handle: { stack: ExpressLayer[] };
    regexp: RegExp & { fast_slash?: boolean };
    keys: Array<{ name: string | number }>;
}

export interface InventoryRoute {
    method: string;
    path: string;
    params: string[];
}

/** Decode Express 4 mount regexps, preserving the names of captured parameters. */
function mountPath(layer: ExpressLayer): string {
    if (layer.regexp.fast_slash) return '';
    const names = layer.keys.map((key) => key.name);
    return layer.regexp.source
        .replace(/^\^/u, '')
        .replace(/\\\/\?\(\?=\\\/\|\$\)$/u, '')
        .replace(/\\\/\?\$$/u, '')
        .replace(/(\\\/)?\(\?:(\\\/)?\(\[\^\\?\/\]\+\?\)\)/gu, () => `/:${String(names.shift())}`)
        .replace(/\\\//gu, '/');
}

function collectRoutes(stack: ExpressLayer[], prefix: string, found: InventoryRoute[]): void {
    for (const layer of stack) {
        if (layer.route) {
            const paths = Array.isArray(layer.route.path) ? layer.route.path : [layer.route.path];
            for (const path of paths) {
                const fullPath = `${prefix}${path === '/' ? '' : path}` || '/';
                const params = Array.from(fullPath.matchAll(/:([A-Za-z0-9_]+)/gu), (match) => match[1] as string);
                for (const method of Object.keys(layer.route.methods)) {
                    found.push({ method: method.toUpperCase(), path: fullPath, params });
                }
            }
        } else if (layer.name === 'router') {
            collectRoutes(layer.handle.stack, `${prefix}${mountPath(layer)}`, found);
        }
    }
}

export const routeKey = (route: Pick<InventoryRoute, 'method' | 'path'>): string => `${route.method} ${route.path}`;

/** Every explicitly mounted Express route, sorted and deduplicated. */
export function listRoutes(app: Express | Router): InventoryRoute[] {
    const root = app as unknown as { _router?: { stack: ExpressLayer[] }; stack?: ExpressLayer[] };
    const found: InventoryRoute[] = [];
    collectRoutes(root._router?.stack ?? root.stack ?? [], '', found);
    const unique = new Map(found.map((route) => [routeKey(route), route]));
    return [...unique.values()].sort((a, b) => `${a.path} ${a.method}`.localeCompare(`${b.path} ${b.method}`));
}

export function listIdParamRoutes(app: Express | Router): InventoryRoute[] {
    return listRoutes(app).filter((route) => route.params.some((name) => /^(?:id|.+Id|.+_id)$/u.test(name)));
}
