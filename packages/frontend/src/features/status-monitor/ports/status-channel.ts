import type { StatusSample, StatusFailure } from '../model/status-types';

export interface StatusChannel {
	subscribe(handler: (sample: StatusSample) => void, error?: (failure: StatusFailure) => void): () => void;
	start(): void | Promise<void>;
	stop(): void | Promise<void>;
}
