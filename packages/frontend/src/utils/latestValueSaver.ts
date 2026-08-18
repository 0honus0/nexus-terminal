export interface LatestValueSaverOptions<T> {
  delayMs: number;
  save: (value: T) => Promise<void>;
  onPendingChange?: (pending: boolean) => void;
  onError?: (error: unknown) => void;
}

export interface LatestValueSaver<T> {
  schedule: (value: T) => void;
  flush: () => Promise<void>;
  dispose: (options?: { flush?: boolean }) => void;
}

/**
 * Debounce UI churn while guaranteeing that persistence requests never overlap.
 *
 * A newer value may arrive while an older request is in flight. The older request is
 * allowed to finish first, while consumers keep external-to-local synchronization locked;
 * the latest pending value is then saved immediately. This makes the final completed
 * request authoritative and prevents late responses from restoring stale UI state.
 */
export function createLatestValueSaver<T>(options: LatestValueSaverOptions<T>): LatestValueSaver<T> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let pendingValue: T | undefined;
  let hasPendingValue = false;
  let saveInFlight = false;
  let disposed = false;

  const setPending = (pending: boolean) => options.onPendingChange?.(pending);

  const flush = async (): Promise<void> => {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    if (saveInFlight || !hasPendingValue) return;

    const value = pendingValue as T;
    pendingValue = undefined;
    hasPendingValue = false;
    saveInFlight = true;
    try {
      await options.save(value);
    } catch (error) {
      options.onError?.(error);
    } finally {
      saveInFlight = false;
      if (hasPendingValue) {
        await flush();
      } else {
        setPending(false);
      }
    }
  };

  const schedule = (value: T): void => {
    if (disposed) return;
    pendingValue = value;
    hasPendingValue = true;
    setPending(true);

    if (saveInFlight) return;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      void flush();
    }, Math.max(0, options.delayMs));
  };

  const dispose = ({ flush: shouldFlush = false }: { flush?: boolean } = {}): void => {
    if (disposed) return;
    disposed = true;
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    if (shouldFlush && hasPendingValue) {
      // flush() intentionally remains able to drain values after dispose; only schedule()
      // rejects new work. This preserves the user's last interaction during unmount.
      void flush();
    } else if (!saveInFlight) {
      pendingValue = undefined;
      hasPendingValue = false;
      setPending(false);
    }
  };

  return { schedule, flush, dispose };
}
