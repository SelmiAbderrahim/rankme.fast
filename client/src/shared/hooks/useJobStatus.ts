import { useEffect, useRef, useState } from 'react';

export type JobStatusPhase = 'idle' | 'polling' | 'terminal' | 'capped';
export interface UseJobStatusOptions<T> {
  jobId: string | null;
  fetchJob: (jobId: string, signal: AbortSignal) => Promise<T>;
  isTerminal: (job: T) => boolean;
  initialJob?: T | null;
  initialDelayMs?: number;
  maxDelayMs?: number;
  backoff?: number;
  capMs?: number;
}
export interface JobStatus<T> {
  job: T | null;
  phase: JobStatusPhase;
}
export const JOB_STATUS_DEFAULTS = {
  initialDelayMs: 2_000,
  maxDelayMs: 15_000,
  backoff: 1.5,
  capMs: 10 * 60_000,
} as const;

/** Follow any asynchronous job, retaining its last snapshot across transient failures. */
export function useJobStatus<T>(options: UseJobStatusOptions<T>): JobStatus<T> {
  const {
    jobId,
    initialJob = null,
    initialDelayMs = JOB_STATUS_DEFAULTS.initialDelayMs,
    maxDelayMs = JOB_STATUS_DEFAULTS.maxDelayMs,
    backoff = JOB_STATUS_DEFAULTS.backoff,
    capMs = JOB_STATUS_DEFAULTS.capMs,
  } = options;
  const latest = useRef(options);
  latest.current = options;
  const [state, setState] = useState<JobStatus<T>>({ job: initialJob, phase: 'idle' });
  useEffect(() => {
    if (jobId === null) {
      setState({ job: null, phase: 'idle' });
      return;
    }
    if (initialJob !== null && latest.current.isTerminal(initialJob)) {
      setState({ job: initialJob, phase: 'terminal' });
      return;
    }
    setState({ job: initialJob, phase: 'polling' });
    const controller = new AbortController();
    let pollTimer: ReturnType<typeof setTimeout> | undefined;
    let delay = initialDelayMs;
    const cap = () => {
      controller.abort();
      clearTimeout(pollTimer);
      setState((current) => ({ ...current, phase: 'capped' }));
    };
    if (capMs <= 0) {
      cap();
      return;
    }
    // A separate deadline also bounds a request that never settles.
    const deadline = setTimeout(cap, capMs);
    const schedule = () => {
      pollTimer = setTimeout(() => void tick(), delay);
      delay = Math.min(maxDelayMs, Math.round(delay * backoff));
    };
    const tick = async () => {
      try {
        const job = await latest.current.fetchJob(jobId, controller.signal);
        if (controller.signal.aborted) return;
        if (latest.current.isTerminal(job)) {
          clearTimeout(deadline);
          setState({ job, phase: 'terminal' });
          return;
        }
        setState({ job, phase: 'polling' });
      } catch {
        if (controller.signal.aborted) return;
      }
      schedule();
    };
    schedule();
    return () => {
      controller.abort();
      clearTimeout(pollTimer);
      clearTimeout(deadline);
    };
    // Seeds apply only to a new job; callbacks are read fresh without resetting timers.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobId, initialDelayMs, maxDelayMs, backoff, capMs]);
  return state;
}
