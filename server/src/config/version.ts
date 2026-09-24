import packageJson from '../../package.json' with { type: 'json' };
const { version } = packageJson;
// tsup replaces this build input; runtime env cannot change a shipped version.
const sha = process.env.APP_BUILD_SHA ?? 'dev';
export const appVersion = `${version}+${/^[a-f0-9]{7,12}$/iu.test(sha) ? sha.toLowerCase() : 'dev'}`;
