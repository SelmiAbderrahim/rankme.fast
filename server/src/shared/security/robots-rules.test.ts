import { describe, expect, it } from 'vitest';
import { robotsDisallows } from './robots-rules.js';

describe('robots path rules', () => {
  it.each([
    ['', '/private', false],
    ['User-agent: *\nDisallow: /private', '/private/page', true],
    ['User-agent: *\nDisallow: /private\nAllow: /private/open', '/private/open', false],
    ['User-agent: *\nDisallow: /x\nAllow: /x', '/x', false],
    ['User-agent: *\nAllow: /x\nAllow: /x\nDisallow: /x', '/x', false],
    ['User-agent: *\nDisallow:', '/anything', false],
    ['User-agent: *\nDisallow: /*.pdf$', '/file.pdf', true],
    ['User-agent: *\nDisallow: /*.pdf$', '/file.pdf?download=1', false],
    ['User-agent: *\nDisallow: /*/private/*$', '/a/private/item', true],
    ['User-agent: *\nDisallow: /private # explanation', '/public', false],
    ['Sitemap: https://example.test/sitemap.xml\nunknown\nDisallow: /', '/', false],
    ['User-agent: *\nDisallow: /a*b$', '/ab', true],
    ['User-agent: *\nDisallow: /a*b$', '/axxxb', true],
    ['User-agent: *\nDisallow: /a*b$', '/axxxc', false],
    ['User-agent: *\nDisallow: /path/*', '/path/', true],
    ['User-agent: *\nDisallow: /longer$', '/long', false],
  ])('evaluates %j against %s', (body, path, blocked) => {
    expect(robotsDisallows(body, path)).toBe(blocked);
  });
  it('prefers matching named groups and combines adjacent user agents', () => {
    const body = 'User-agent: *\nDisallow: /\nUser-agent: ExampleBot\nUser-agent: OtherBot\nAllow: /';
    expect(robotsDisallows(body, '/private', 'ExampleBot/1.0')).toBe(false);
    expect(robotsDisallows(body, '/private', 'otherbot')).toBe(false);
    expect(robotsDisallows(body, '/private', 'unlisted')).toBe(true);
    expect(robotsDisallows(body, '/private')).toBe(true);
  });
  it('does not claim a block from a robots file whose rules exceed the supported bounds', () => {
    const body = 'User-agent: *\n' + 'Disallow: /private\n'.repeat(5000) + 'Allow: /private';
    expect(robotsDisallows(body, '/private')).toBe(false);
    expect(robotsDisallows('User-agent: *\nDisallow: /' + 'a'.repeat(1100), '/' + 'a'.repeat(1023))).toBe(false);
    expect(robotsDisallows(' '.repeat(512 * 1024) + 'User-agent: *\nDisallow: /', '/')).toBe(false);
  });
  it('never fabricates a shorter disallow prefix by cutting an oversized rule', () => {
    const prefix = '/' + 'a'.repeat(1023);
    expect(robotsDisallows(`User-agent: *\nDisallow: ${prefix}private$`, `${prefix}public`)).toBe(false);
    const header = 'User-agent: *\n';
    const tailAtBoundary = '\nDisallow: /private';
    const padding = '#'.padEnd(512 * 1024 - header.length - tailAtBoundary.length, 'x');
    expect(robotsDisallows(header + padding + tailAtBoundary + '/only-this$', '/private')).toBe(false);
  });
});
