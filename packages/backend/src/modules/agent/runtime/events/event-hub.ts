import type { TransientRunEvent } from './event.types';

type Listener<T> = (event: T) => void;

export class AgentEventHub {
  private readonly runWakeListeners = new Map<string, Set<Listener<number>>>();
  private readonly hostWakeListeners = new Map<number, Set<Listener<number>>>();
  private readonly transientListeners = new Map<string, Set<Listener<TransientRunEvent>>>();

  publishRunWake(runId: string, cursor: number): void {
    for (const listener of this.runWakeListeners.get(runId) ?? []) listener(cursor);
  }

  publishHostWake(userId: number, cursor: number): void {
    for (const listener of this.hostWakeListeners.get(userId) ?? []) listener(cursor);
  }

  publishTransient(event: TransientRunEvent): void {
    for (const listener of this.transientListeners.get(event.runId) ?? []) listener(event);
  }

  onRunWake(runId: string, listener: Listener<number>): () => void {
    return this.add(this.runWakeListeners, runId, listener);
  }

  onHostWake(userId: number, listener: Listener<number>): () => void {
    return this.add(this.hostWakeListeners, userId, listener);
  }

  onTransient(runId: string, listener: Listener<TransientRunEvent>): () => void {
    return this.add(this.transientListeners, runId, listener);
  }

  clear(): void {
    this.runWakeListeners.clear();
    this.hostWakeListeners.clear();
    this.transientListeners.clear();
  }

  private add<TKey, TEvent>(map: Map<TKey, Set<Listener<TEvent>>>, key: TKey, listener: Listener<TEvent>): () => void {
    let listeners = map.get(key);
    if (!listeners) {
      listeners = new Set();
      map.set(key, listeners);
    }
    listeners.add(listener);
    return () => {
      listeners?.delete(listener);
      if (listeners?.size === 0) map.delete(key);
    };
  }
}
