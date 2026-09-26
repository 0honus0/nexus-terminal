export interface AgentConfigurationChangedEvent {
  origin: 'local' | 'external';
}

export interface AgentHostEventMap {
  'thread-changed': Record<string, unknown>;
  'authorization-changed': Record<string, unknown>;
  'memory-changed': Record<string, unknown>;
  'host-changed': undefined;
  // Provider / settings writes: open Agent surfaces reload run configuration; Settings reloads only external changes.
  'configuration-changed': AgentConfigurationChangedEvent;
}

type AgentHostEventType = keyof AgentHostEventMap;
type Listener<K extends AgentHostEventType> = (payload: AgentHostEventMap[K]) => void;

const listeners = new Map<AgentHostEventType, Set<(payload: unknown) => void>>();

const on = <K extends AgentHostEventType>(type: K, listener: Listener<K>): (() => void) => {
  const bucket = listeners.get(type) ?? new Set<(payload: unknown) => void>();
  const wrapped = listener as (payload: unknown) => void;
  bucket.add(wrapped);
  listeners.set(type, bucket);
  return () => {
    bucket.delete(wrapped);
    if (bucket.size === 0) listeners.delete(type);
  };
};

const emit = <K extends AgentHostEventType>(type: K, payload: AgentHostEventMap[K]): void => {
  const bucket = listeners.get(type);
  if (!bucket) return;
  for (const listener of [...bucket]) listener(payload);
};

export const agentHostEvents = Object.freeze({ on, emit });
