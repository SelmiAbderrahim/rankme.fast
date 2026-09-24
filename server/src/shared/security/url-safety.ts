import { lookup } from 'node:dns/promises';
import { request as httpRequest, type IncomingHttpHeaders } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { BlockList, isIP, type LookupFunction } from 'node:net';
import { ProviderError } from '../providers/errors.js';
export interface ResolvedAddress {
    address: string;
    family: 4 | 6;
}
export type PublicUrlResolver = (hostname: string) => Promise<readonly ResolvedAddress[]>;
export interface UrlSafetyClock {
    now(): number;
    setTimeout(callback: () => void, delayMs: number): ReturnType<typeof setTimeout>;
    clearTimeout(timer: ReturnType<typeof setTimeout>): void;
}
export interface AssertPublicUrlSafeOptions {
    allowHttp?: boolean;
    resolver?: PublicUrlResolver;
    /** Injectable clock shared with the fetch authority's deadline handling. */
    clock?: UrlSafetyClock;
}
export interface FetchPublicUrlSafeOptions extends AssertPublicUrlSafeOptions {
    /** Redirects are disabled in the transport and revalidated here. Default: 3. */
    maxRedirects?: number;
    deadlineMs?: number;
    maxResponseBytes?: number;
    transport?: PublicUrlTransport;
}
export interface PublicUrlFetchResult {
    /** The terminal response after every redirect was resolve-then-pin validated. */
    response: Response;
    /** The normalized terminal URL. Never derived from an untrusted response header. */
    finalUrl: URL;
}
export type PublicUrlTransport = (url: URL, pinned: ResolvedAddress, init: RequestInit, signal: AbortSignal, maxResponseBytes: number) => Promise<Response>;
export class UnsafeUrlError extends ProviderError {
    constructor(message: string, cause?: unknown) {
        super(message, false, {
            provider: 'security',
            operation: 'url-safety',
            ...(cause === undefined ? {} : { cause }),
        });
    }
}
const DEFAULT_MAX_REDIRECTS = 3;
const DEFAULT_DEADLINE_MS = 10000;
const DEFAULT_MAX_RESPONSE_BYTES = 10 * 1024 * 1024;
const NON_PUBLIC_HOSTNAMES: ReadonlySet<string> = new Set([
    'localhost',
    'metadata.google.internal',
]);
const IPV4_BLOCKS = [
    ['0.0.0.0', 8],
    ['10.0.0.0', 8],
    ['100.64.0.0', 10],
    ['127.0.0.0', 8],
    ['169.254.0.0', 16],
    ['172.16.0.0', 12],
    ['192.0.0.0', 24],
    ['192.0.2.0', 24],
    ['192.88.99.0', 24],
    ['192.168.0.0', 16],
    ['198.18.0.0', 15],
    ['198.51.100.0', 24],
    ['203.0.113.0', 24],
    ['224.0.0.0', 4],
    ['240.0.0.0', 4],
] as const;
const IPV6_BLOCKS = [
    // Only 2000::/3 is currently globally routable. Keep the surrounding
    // reserved space explicit; mapped/compatible ::/96 addresses are handled
    // separately below so their embedded IPv4 address is re-checked.
    ['::', 8],
    ['100::', 8],
    ['200::', 7],
    ['400::', 6],
    ['800::', 5],
    ['1000::', 4],
    ['64:ff9b::', 96],
    ['64:ff9b:1::', 48],
    ['2001::', 32],
    ['2001:2::', 48],
    ['2001:10::', 28],
    ['2001:20::', 28],
    ['2001:db8::', 32],
    ['2002::', 16],
    ['3fff::', 20],
    ['4000::', 2],
    ['8000::', 1],
    ['fc00::', 7],
    ['fe80::', 10],
    ['ff00::', 8],
] as const;
const blockedIpv4 = new BlockList();
const blockedIpv6 = new BlockList();
for (const [network, prefix] of IPV4_BLOCKS) {
    blockedIpv4.addSubnet(network, prefix, 'ipv4');
}
for (const [network, prefix] of IPV6_BLOCKS) {
    blockedIpv6.addSubnet(network, prefix, 'ipv6');
}
const defaultResolver: PublicUrlResolver = async (hostname) => {
    const records = await lookup(hostname, { all: true, verbatim: true });
    return records.map(({ address, family }) => ({ address, family: family === 6 ? 6 : 4 }));
};
const defaultClock: UrlSafetyClock = {
    now: Date.now,
    setTimeout: (callback, delayMs) => setTimeout(callback, delayMs),
    clearTimeout: (timer) => clearTimeout(timer),
};
function rawHostname(rawUrl: string): string | null {
    const authority = /^[a-z][a-z\d+.-]*:\/\/([^/?#]*)/i.exec(rawUrl)?.[1];
    if (authority === undefined)
        return null;
    const hostPort = authority.slice(authority.lastIndexOf('@') + 1);
    if (hostPort.startsWith('['))
        return hostPort.slice(1, hostPort.indexOf(']'));
    return hostPort.split(':', 1)[0]!;
}
function normalizedHostname(url: URL): string {
    return url.hostname.startsWith('[') ? url.hostname.slice(1, -1) : url.hostname;
}
function assertCanonicalHost(rawUrl: string, url: URL): void {
    const raw = rawHostname(rawUrl);
    if (!raw)
        throw new UnsafeUrlError('URL must include an authority and hostname');
    if (raw.endsWith('.'))
        throw new UnsafeUrlError('trailing-dot hostnames are not allowed');
    if (raw.includes('%'))
        throw new UnsafeUrlError('encoded hostnames are not allowed');
    if ([...raw].some((character) => character.charCodeAt(0) > 0x7f) || raw.toLowerCase().split('.').some((part) => part.startsWith('xn--'))) {
        throw new UnsafeUrlError('unicode and punycode hostnames are not allowed');
    }
    const normalized = normalizedHostname(url);
    if (/^(?:0x[\da-f]+|0[0-7]+|\d+)(?:\.(?:0x[\da-f]+|0[0-7]+|\d+))*$/i.test(raw) && raw !== normalized) {
        throw new UnsafeUrlError('encoded IPv4 hostnames are not allowed');
    }
}
function assertAddressSafe(address: string): ResolvedAddress {
    const family = isIP(address);
    if (family === 0)
        throw new UnsafeUrlError(`resolver returned an invalid address: ${address}`);
    if (family === 6) {
        const embedded = embeddedIpv4(address);
        if (embedded !== null) {
            assertAddressSafe(embedded);
            return { address, family: 6 };
        }
    }
    if ((family === 4 ? blockedIpv4 : blockedIpv6).check(address, family === 4 ? 'ipv4' : 'ipv6')) {
        throw new UnsafeUrlError(`address is not publicly routable: ${address}`);
    }
    return { address, family: family === 6 ? 6 : 4 };
}
function assertHostnamePreflightSafe(hostname: string): void {
    const lower = hostname.toLowerCase();
    if (NON_PUBLIC_HOSTNAMES.has(lower) || lower.endsWith('.localhost')) {
        throw new UnsafeUrlError(`hostname is not publicly routable: ${hostname}`);
    }
    if (isIP(hostname) !== 0)
        assertAddressSafe(hostname);
}
function embeddedIpv4(address: string): string | null {
    const canonical = new URL(`http://[${address}]/`).hostname.slice(1, -1);
    const [head = '', tail = ''] = canonical.split('::');
    const left = head === '' ? [] : head.split(':');
    const right = tail === '' ? [] : tail.split(':');
    const hextets = [
        ...left,
        ...Array.from({ length: 8 - left.length - right.length }, () => '0'),
        ...right,
    ].map((part) => Number.parseInt(part, 16));
    const compatible = hextets.slice(0, 6).every((part) => part === 0);
    const mapped = hextets.slice(0, 5).every((part) => part === 0) && hextets[5] === 0xffff;
    if (!compatible && !mapped)
        return null;
    const high = hextets[6]!;
    const low = hextets[7]!;
    return `${high >> 8}.${high & 0xff}.${low >> 8}.${low & 0xff}`;
}
function withAbort<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
    if (!signal)
        return promise;
    if (signal.aborted)
        return Promise.reject(new UnsafeUrlError('request deadline exceeded'));
    return new Promise<T>((resolve, reject) => {
        const abort = (): void => reject(new UnsafeUrlError('request deadline exceeded'));
        signal.addEventListener('abort', abort, { once: true });
        promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
    });
}
function parsePublicUrlSyntax(rawUrl: string | URL, opts: Pick<AssertPublicUrlSafeOptions, 'allowHttp'> = {}): URL {
    const raw = String(rawUrl).trim();
    let url: URL;
    try {
        url = new URL(raw);
    }
    catch (cause) {
        throw new UnsafeUrlError('invalid URL', cause);
    }
    if (url.protocol !== 'https:' && !(opts.allowHttp === true && url.protocol === 'http:')) {
        throw new UnsafeUrlError('URL scheme is not allowed');
    }
    if (url.username || url.password)
        throw new UnsafeUrlError('URL credentials are not allowed');
    assertCanonicalHost(raw, url);
    return url;
}
/**
 * Synchronous URL-input preflight for schema boundaries.
 *
 * This shares the fetch authority's parser, canonical-host rules, scheme and
 * credential policy, literal-address denylist, and explicit special-use host
 * checks. It intentionally does not resolve DNS, so callers that perform
 * outbound I/O must still use `assertPublicUrlSafe` / `fetchPublicUrlSafe`.
 */
export function assertPublicUrlSyntaxSafe(rawUrl: string | URL, opts: Pick<AssertPublicUrlSafeOptions, 'allowHttp'> = {}): URL {
    const url = parsePublicUrlSyntax(rawUrl, opts);
    const hostname = normalizedHostname(url);
    assertHostnamePreflightSafe(hostname);
    return url;
}
async function resolvePublicUrl(rawUrl: string | URL, opts: AssertPublicUrlSafeOptions, signal?: AbortSignal): Promise<{
    url: URL;
    addresses: ResolvedAddress[];
}> {
    // DNS remains authoritative for named hosts. The synchronous schema
    // preflight additionally rejects explicit special-use names, but fetches
    // resolve every name and validate every returned address here.
    const url = parsePublicUrlSyntax(rawUrl, opts);
    const hostname = normalizedHostname(url);
    const literalFamily = isIP(hostname);
    if (literalFamily !== 0) {
        return { url, addresses: [assertAddressSafe(hostname)] };
    }
    let records: readonly ResolvedAddress[];
    try {
        records = await withAbort((opts.resolver ?? defaultResolver)(hostname), signal);
    }
    catch (cause) {
        if (cause instanceof UnsafeUrlError)
            throw cause;
        throw new UnsafeUrlError('DNS resolution failed', cause);
    }
    if (records.length === 0)
        throw new UnsafeUrlError('DNS returned no addresses');
    return { url, addresses: records.map(({ address }) => assertAddressSafe(address)) };
}
export async function assertPublicUrlSafe(rawUrl: string | URL, opts: AssertPublicUrlSafeOptions = {}): Promise<URL> {
    return (await resolvePublicUrl(rawUrl, opts)).url;
}
function responseHeaders(headers: IncomingHttpHeaders): Headers {
    const result = new Headers();
    for (const [name, value] of Object.entries(headers)) {
        if (Array.isArray(value))
            value.forEach((item) => result.append(name, item));
        else
            result.set(name, value!);
    }
    return result;
}
/** Native HTTP(S) transport whose custom lookup always returns the validated IP. */
export const pinnedHttpTransport: PublicUrlTransport = async (url, pinned, init, signal, maxResponseBytes) => {
    if (init.body !== undefined && init.body !== null && typeof init.body !== 'string') {
        throw new UnsafeUrlError('pinned transport accepts string request bodies only');
    }
    const headers = new Headers(init.headers);
    headers.delete('authorization');
    headers.delete('cookie');
    headers.delete('proxy-authorization');
    const pinnedLookup: LookupFunction = (_hostname, _options, callback) => {
        callback(null, [pinned]);
    };
    return new Promise<Response>((resolve, reject) => {
        const request = (url.protocol === 'https:' ? httpsRequest : httpRequest)(url, {
            method: init.method ?? 'GET',
            headers: Object.fromEntries(headers.entries()),
            lookup: pinnedLookup,
            signal,
        }, (incoming) => {
            const chunks: Buffer[] = [];
            let size = 0;
            incoming.on('data', (chunk: Buffer) => {
                size += chunk.length;
                if (size > maxResponseBytes) {
                    incoming.destroy(new UnsafeUrlError('response exceeded the byte ceiling'));
                    return;
                }
                chunks.push(chunk);
            });
            incoming.on('end', () => {
                resolve(new Response(Buffer.concat(chunks), {
                    status: incoming.statusCode!,
                    headers: responseHeaders(incoming.headers),
                }));
            });
            incoming.on('error', reject);
        });
        request.on('error', (cause) => {
            reject(cause instanceof UnsafeUrlError
                ? cause
                : new UnsafeUrlError(signal.aborted ? 'request deadline exceeded' : 'request failed', cause));
        });
        if (typeof init.body === 'string')
            request.write(init.body);
        request.end();
    });
};
function redirectMethod(status: number, init: RequestInit): RequestInit {
    if (status === 303 || ((status === 301 || status === 302) && init.method?.toUpperCase() === 'POST')) {
        return { ...init, method: 'GET', body: undefined };
    }
    return init;
}
export async function fetchPublicUrlSafeWithFinalUrl(rawUrl: string | URL, requestInit: RequestInit = {}, opts: FetchPublicUrlSafeOptions = {}): Promise<PublicUrlFetchResult> {
    const maxRedirects = opts.maxRedirects ?? DEFAULT_MAX_REDIRECTS;
    const deadlineMs = opts.deadlineMs ?? DEFAULT_DEADLINE_MS;
    const maxResponseBytes = opts.maxResponseBytes ?? DEFAULT_MAX_RESPONSE_BYTES;
    if (!Number.isInteger(maxRedirects) || maxRedirects < 0)
        throw new UnsafeUrlError('invalid redirect ceiling');
    if (!Number.isFinite(deadlineMs) || deadlineMs <= 0)
        throw new UnsafeUrlError('invalid deadline');
    if (!Number.isInteger(maxResponseBytes) || maxResponseBytes <= 0)
        throw new UnsafeUrlError('invalid response ceiling');
    const clock = opts.clock ?? defaultClock;
    const controller = new AbortController();
    const startedAt = clock.now();
    const timer = clock.setTimeout(() => controller.abort(), deadlineMs);
    const externalSignal = requestInit.signal;
    const abortFromCaller = () => controller.abort(externalSignal?.reason);
    if (externalSignal?.aborted)
        abortFromCaller();
    else
        externalSignal?.addEventListener('abort', abortFromCaller, { once: true });
    let current: string | URL = rawUrl;
    let init: RequestInit = {
        ...requestInit,
        headers: (() => {
            const headers = new Headers(requestInit.headers);
            headers.delete('authorization');
            headers.delete('cookie');
            headers.delete('proxy-authorization');
            return headers;
        })(),
        redirect: 'manual',
        credentials: 'omit',
        signal: undefined,
    };
    const transport = opts.transport ?? pinnedHttpTransport;
    try {
        for (let hop = 0;; hop += 1) {
            if (controller.signal.aborted || clock.now() - startedAt >= deadlineMs) {
                throw new UnsafeUrlError('request deadline exceeded');
            }
            const resolved = await resolvePublicUrl(current, opts, controller.signal);
            let response: Response;
            try {
                response = await transport(resolved.url, resolved.addresses[0]!, init, controller.signal, maxResponseBytes);
            }
            catch (cause) {
                if (controller.signal.aborted)
                    throw new UnsafeUrlError('request deadline exceeded', cause);
                throw cause;
            }
            if (response.status < 300 || response.status >= 400) {
                return { response, finalUrl: resolved.url };
            }
            const location = response.headers.get('location');
            if (!location)
                return { response, finalUrl: resolved.url };
            if (hop >= maxRedirects)
                throw new UnsafeUrlError('redirect ceiling exceeded');
            current = new URL(location, resolved.url);
            init = redirectMethod(response.status, init);
        }
    }
    finally {
        clock.clearTimeout(timer);
        externalSignal?.removeEventListener('abort', abortFromCaller);
    }
}
export async function fetchPublicUrlSafe(rawUrl: string | URL, requestInit: RequestInit = {}, opts: FetchPublicUrlSafeOptions = {}): Promise<Response> {
    return (await fetchPublicUrlSafeWithFinalUrl(rawUrl, requestInit, opts)).response;
}
