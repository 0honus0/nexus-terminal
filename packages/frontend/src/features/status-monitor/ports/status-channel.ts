import type { WorkspaceStatusSampleDto } from '../model/status';
export interface StatusChannel {
  subscribe(handler: (sample: WorkspaceStatusSampleDto) => void, error?: (message: string) => void): () => void;
  start(): void | Promise<void>;
  stop(): void | Promise<void>;
}
