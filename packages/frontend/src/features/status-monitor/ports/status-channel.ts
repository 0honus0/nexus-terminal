import type { ServerStatusSample } from '../model/status';
export interface StatusChannel {
  subscribe(handler: (sample: ServerStatusSample) => void, error?: (message: string) => void): () => void;
  start(): void | Promise<void>;
  stop(): void | Promise<void>;
}
