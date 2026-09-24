/** Build an authenticated-app URL from the deployment-provided app origin. */
export function appHref(path: string): string {
  const normalizedPath = `/${path.replace(/^\/+/, '')}`;
  const configured = import.meta.env.VITE_APP_URL as string | undefined;
  if (!configured) return normalizedPath;

  try {
    return `${new URL(configured).origin}${normalizedPath}`;
  } catch {
    return normalizedPath;
  }
}
