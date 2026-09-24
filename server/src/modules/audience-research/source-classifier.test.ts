import { describe, expect, it } from 'vitest';
import { classifySourceType, registrableDomain } from './source-classifier.js';

describe('registrableDomain', () => {
  it('collapses subdomains to eTLD+1 for single-part TLDs', () => {
    expect(registrableDomain('www.reddit.com')).toBe('reddit.com');
    expect(registrableDomain('blog.example.com')).toBe('example.com');
    expect(registrableDomain('a.b.c.example.com')).toBe('example.com');
    expect(registrableDomain('example.com')).toBe('example.com');
  });

  it('handles known multi-part TLDs', () => {
    expect(registrableDomain('sub.example.co.uk')).toBe('example.co.uk');
    expect(registrableDomain('example.co.uk')).toBe('example.co.uk');
    expect(registrableDomain('www.blog.example.com.au')).toBe('example.com.au');
  });

  it('preserves IPv4 and IPv6 literals', () => {
    expect(registrableDomain('127.0.0.1')).toBe('127.0.0.1');
    expect(registrableDomain('[::1]:8080')).toBe('[::1]:8080');
  });

  it('handles trailing dots, empty, single-segment hosts', () => {
    expect(registrableDomain('reddit.com.')).toBe('reddit.com');
    expect(registrableDomain('   ')).toBe('');
    expect(registrableDomain('localhost')).toBe('localhost');
  });
});

describe('classifySourceType', () => {
  it('classifies forum hosts', () => {
    expect(classifySourceType('www.reddit.com', '/r/seo/comments/xxx')).toBe('forum');
    expect(classifySourceType('stackoverflow.com', '/questions/1')).toBe('forum');
    expect(classifySourceType('discourse.example.com', '/t/topic')).toBe('forum');
    expect(classifySourceType('forum.example.com', '/thread')).toBe('forum');
    expect(classifySourceType('example.com', '/community/topic')).toBe('forum');
  });

  it('classifies question hosts', () => {
    expect(classifySourceType('www.quora.com', '/What-is')).toBe('question');
    expect(classifySourceType('math.stackexchange.com', '/questions/1')).toBe('question');
    expect(classifySourceType('answers.example.com', '/id')).toBe('question');
    expect(classifySourceType('example.com', '/questions/how')).toBe('question');
  });

  it('classifies review hosts + paths', () => {
    expect(classifySourceType('www.g2.com', '/products/x/reviews')).toBe('review');
    expect(classifySourceType('capterra.com', '/p/1/review')).toBe('review');
    expect(classifySourceType('trustpilot.com', '/review/x')).toBe('review');
    expect(classifySourceType('example.com', '/product/reviews')).toBe('review');
    expect(classifySourceType('example.com', '/reviews-2026')).toBe('review');
  });

  it('classifies comparison paths', () => {
    expect(classifySourceType('example.com', '/foo/vs/bar')).toBe('comparison');
    expect(classifySourceType('example.com', '/foo-vs-bar')).toBe('comparison');
    expect(classifySourceType('example.com', '/compare/xy')).toBe('comparison');
    expect(classifySourceType('example.com', '/alternatives-list')).toBe('comparison');
  });

  it('falls through to `other` when no rule fires', () => {
    expect(classifySourceType('news.example.com', '/2026/headline')).toBe('other');
    expect(classifySourceType('example.com', '/')).toBe('other');
    expect(classifySourceType('', '')).toBe('other');
  });

  it('is 100% deterministic — same input, same output', () => {
    const first = classifySourceType('www.reddit.com', '/r/seo/comments/abc');
    for (let i = 0; i < 1000; i += 1) {
      expect(classifySourceType('www.reddit.com', '/r/seo/comments/abc')).toBe(first);
    }
  });
});
