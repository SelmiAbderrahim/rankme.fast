import { afterEach, describe, expect, it, vi } from 'vitest';
import { BRAND_SUPPORT_EMAIL } from '@shared/brand';
import { bugReportHref, githubIssuesUrl, githubUrl } from './github';

describe('githubUrl', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('returns null when the env var is unset', () => {
    vi.stubEnv('VITE_GITHUB_URL', undefined as unknown as string);
    expect(githubUrl()).toBeNull();
  });

  it('returns null when the env var is blank', () => {
    vi.stubEnv('VITE_GITHUB_URL', '');
    expect(githubUrl()).toBeNull();
  });

  it('returns null when the env var is not a valid URL', () => {
    vi.stubEnv('VITE_GITHUB_URL', 'not-a-url');
    expect(githubUrl()).toBeNull();
  });

  it('returns the normalized URL when valid', () => {
    vi.stubEnv('VITE_GITHUB_URL', 'https://github.com/rankmefast/rankmefast');
    expect(githubUrl()).toBe('https://github.com/rankmefast/rankmefast');
  });

  it.each([
    ['unset', undefined as unknown as string],
    ['invalid', 'not-a-url'],
  ])('keeps issue and bug-report links safe when the repository is %s', (_label, value) => {
    vi.stubEnv('VITE_GITHUB_URL', value);
    expect(githubIssuesUrl()).toBeNull();
    expect(bugReportHref()).toBe(`mailto:${BRAND_SUPPORT_EMAIL}`);
  });

  it('builds the issue chooser once for normal and trailing-slash repository URLs', () => {
    vi.stubEnv('VITE_GITHUB_URL', 'https://github.com/rankmefast/rankmefast/');
    expect(githubIssuesUrl()).toBe('https://github.com/rankmefast/rankmefast/issues/new/choose');
    expect(bugReportHref()).toBe('https://github.com/rankmefast/rankmefast/issues/new/choose');
  });
});
