import { EventEmitter } from 'node:events';

/**
 * Infrastructure callbacks run on Node EventEmitter/stream call stacks. A consumer listener must
 * not be able to turn a connection-local fault into an uncaught process-level exception.
 */
export const emitEventSafely = (events: EventEmitter, event: string, ...args: unknown[]): void => {
  for (const listener of events.rawListeners(event)) {
    try {
      Reflect.apply(listener, events, args);
    } catch {
      // Listener failures are isolated at the infrastructure boundary.
    }
  }
};

export const invokeListenerSafely = <TArgs extends unknown[]>(
  listener: (...args: TArgs) => void,
  ...args: TArgs
): void => {
  try {
    listener(...args);
  } catch {
    // Listener failures are isolated at the infrastructure boundary.
  }
};
