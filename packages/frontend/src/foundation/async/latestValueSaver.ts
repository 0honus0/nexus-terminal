export interface LatestValueSaverOptions<T> {
  delayMs: number;
  save: (value: T) => Promise<void>;
  onPendingChange?: (pending: boolean) => void;
  onError?: (error: unknown) => void;
}

export interface LatestValueSaver<T> {
  /** Keep only the newest value and persist it after the debounce window. */
  schedule(value: T): void;
  /** Persist all currently scheduled work, including a newer value queued during an in-flight save. */
  flush(): Promise<void>;
  /** Stop accepting new values. Optionally drain the newest pending value before resolving. */
  dispose(options?: { flush?: boolean }): Promise<void>;
}

/**
 * Serial debounced persistence for UI settings.
 *
 * Saves never overlap. If a newer value arrives while an older request is running,
 * the running request finishes and the newest pending value is saved immediately.
 * This prevents a late stale response from becoming the final persistence write.
 */
export function createLatestValueSaver<T>(options: LatestValueSaverOptions<T>): LatestValueSaver<T> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let pendingValue: T | undefined;
  let hasPendingValue = false;
  let disposed = false;
  let running = false;
  let drainPromise: Promise<void> | null = null;
  let pendingState = false;

  const setPendingState = (pending: boolean): void => {
    if (pendingState === pending) return;
    pendingState = pending;
    options.onPendingChange?.(pending);
  };

  const clearTimer = (): void => {
    if (!timer) return;
    clearTimeout(timer);
    timer = null;
  };

  const drain = (): Promise<void> => {
    clearTimer();
    if (running) return drainPromise ?? Promise.resolve();
    if (!hasPendingValue) {
      setPendingState(false);
      return Promise.resolve();
    }

    running = true;
    drainPromise = (async () => {
      while (hasPendingValue) {
        const value = pendingValue as T;
        pendingValue = undefined;
        hasPendingValue = false;

        try {
          await options.save(value);
        } catch (error) {
          options.onError?.(error);
        }
      }
    })().finally(() => {
      running = false;
      drainPromise = null;
      if (hasPendingValue) {
        void drain();
      } else {
        setPendingState(false);
      }
    });

    return drainPromise;
  };

  const schedule = (value: T): void => {
    if (disposed) return;

    pendingValue = value;
    hasPendingValue = true;
    setPendingState(true);

    if (running) return;

    clearTimer();
    timer = setTimeout(
      () => {
        timer = null;
        void drain();
      },
      Math.max(0, options.delayMs),
    );
  };

  const flush = (): Promise<void> => drain();

  const dispose = async ({ flush: shouldFlush = false }: { flush?: boolean } = {}): Promise<void> => {
    if (disposed) {
      if (shouldFlush) await drain();
      else if (running) await drainPromise;
      return;
    }

    disposed = true;
    clearTimer();

    if (shouldFlush) {
      await drain();
      return;
    }

    pendingValue = undefined;
    hasPendingValue = false;
    if (running) await drainPromise;
    setPendingState(false);
  };

  return { schedule, flush, dispose };
}
