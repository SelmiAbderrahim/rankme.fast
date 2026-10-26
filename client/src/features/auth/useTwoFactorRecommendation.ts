import { useCallback, useEffect, useSyncExternalStore } from 'react';
import { selectActiveWorkspaceRole } from '@features/workspace';
import { useAppSelector } from '@shared/hooks/redux';
import { dismissTwoFactorRecommendation, fetchTwoFactorRecommendation } from './api';
import { authClient } from './authClient';
import { useAuthSession } from './useAuthSession';

type Answer = 'active' | 'dismissed' | 'unreadable';
const answers = new Map<string, Answer>();
const pending = new Map<string, Promise<void>>();
const listeners = new Set<() => void>();
const publish = () => { for (const listener of listeners) listener(); };
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
};

const read = async (userId: string): Promise<void> => {
  if (answers.has(userId) || pending.has(userId)) return;
  const request = fetchTwoFactorRecommendation()
    .then(({ dismissedAt }) => { answers.set(userId, dismissedAt === null ? 'active' : 'dismissed'); })
    .catch(() => { answers.set(userId, 'unreadable'); })
    .finally(() => { pending.delete(userId); publish(); });
  pending.set(userId, request);
  await request;
};

/** Test seam for the saved preference; no identity state is stored here. */
export const resetTwoFactorRecommendation = () => {
  answers.clear();
  pending.clear();
  publish();
};

export const useTwoFactorRecommendation = () => {
  const { authenticated, emailVerified, mustChangePassword, user } = useAuthSession();
  const role = useAppSelector(selectActiveWorkspaceRole);
  const userId = user?.id ?? null;
  const twoFactorEnabled = Boolean((user as { twoFactorEnabled?: boolean } | null)?.twoFactorEnabled);
  const capable = typeof authClient.twoFactor?.enable === 'function';
  const eligible = authenticated && emailVerified && mustChangePassword !== true &&
    userId !== null && !twoFactorEnabled && role === 'owner' && capable;
  const answer = useSyncExternalStore(subscribe,
    () => userId === null ? undefined : answers.get(userId),
    () => userId === null ? undefined : answers.get(userId));

  useEffect(() => { if (eligible) void read(userId); }, [eligible, userId]);

  const dismiss = useCallback(async () => {
    if (userId === null) return;
    answers.set(userId, 'dismissed');
    publish();
    try { await dismissTwoFactorRecommendation(); } catch {
      // Keep the reminder hidden during this session if saving fails.
    }
  }, [userId]);

  return { visible: eligible && answer === 'active', dismiss };
};
