import { authClient } from './authClient';

/** Wait for Better Auth's own session refresh after a successful mutation. */
export async function sessionMutation<T extends { error?: unknown }>(mutation: () => Promise<T>): Promise<T> {
  const result = await mutation();
  if (result.error) return result;
  const session = authClient.$store.atoms.session;
  if (!session) throw new Error('Session store unavailable');

  await new Promise<void>((resolve, reject) => {
    let refreshing = session.get().isRefetching;
    const timer = setTimeout(() => {
      unsubscribe();
      reject(new Error('Session refresh unavailable'));
    }, 30_000);
    const unsubscribe = session.listen((state) => {
      refreshing ||= state.isRefetching;
      if (!refreshing || state.isRefetching) return;
      clearTimeout(timer);
      unsubscribe();
      if (state.error) reject(new Error('Session refresh unavailable'));
      else resolve();
    });
  });
  return result;
}
