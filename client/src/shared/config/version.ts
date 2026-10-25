/** Version is derived from package.json by Vite, never from a public env override. */
export const appVersion: string = import.meta.env.VITE_APP_VERSION ?? 'dev';

const BUILD_SHA = /^[a-f0-9]{7,12}$/iu;

export function displayVersion(full: string): string {
  return full.split('+')[0]!;
}

export function buildIdentifier(full: string): string | undefined {
  const [, sha] = full.split('+');
  return sha !== undefined && BUILD_SHA.test(sha) ? full : undefined;
}

export const appDisplayVersion = displayVersion(appVersion);
export const appBuildIdentifier = buildIdentifier(appVersion);
