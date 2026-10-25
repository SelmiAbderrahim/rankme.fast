import { useEffect, useState } from 'react';
import { authClient } from './authClient';
import type { AuthClientError } from './errorMessage';

type CredentialState =
  | { status: 'loading' }
  | { status: 'error'; error: AuthClientError }
  | { status: 'ready'; hasPassword: boolean };

/** Reads the native linked-account list for one session owner. */
export const useCredentialAccount = () => {
  const { data } = authClient.useSession();
  const owner = data?.user.id;
  const [attempt, setAttempt] = useState(0);
  const [result, setResult] = useState<{ owner: string; state: CredentialState }>();

  useEffect(() => {
    if (!owner) return;
    const controller = new AbortController();
    setResult({ owner, state: { status: 'loading' } });
    void (async () => {
      try {
        const { data: accounts, error } = await authClient.listAccounts({
          fetchOptions: { signal: controller.signal },
        });
        if (controller.signal.aborted) return;
        if (error || !Array.isArray(accounts) ||
          accounts.some((account) => typeof account.providerId !== 'string')) {
          setResult({ owner, state: { status: 'error', error: error ?? {} } });
        } else {
          setResult({ owner, state: {
            status: 'ready',
            hasPassword: accounts.some((account) => account.providerId === 'credential'),
          } });
        }
      } catch {
        if (!controller.signal.aborted) setResult({ owner, state: { status: 'error', error: {} } });
      }
    })();
    return () => controller.abort();
  }, [owner, attempt]);

  const state: CredentialState = result?.owner === owner && result
    ? result.state : { status: 'loading' };
  return { state, retry: () => setAttempt((value) => value + 1), email: data?.user.email };
};
