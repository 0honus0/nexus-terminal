import type { RemoteStatusSample } from './model.js';
import type { ObservationErrorCode } from './values.js';

export type WorkspaceStatusSample = RemoteStatusSample;

export interface WorkspaceStatusError {
	message: ObservationErrorCode;
}
