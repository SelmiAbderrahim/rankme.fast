/** Version is derived from package.json by Vite, never from a public env override. */
export const appVersion: string = import.meta.env.VITE_APP_VERSION ?? 'dev';
