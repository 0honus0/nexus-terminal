import type { ObservationErrorCode } from './values.js';
import type { SshResourceStatus } from './model.js';

export interface ObservationErrorResponse {
	code: ObservationErrorCode;
}

export type SshResourceStatusListResponse = SshResourceStatus[];

export type SshResourceStatusResponse = SshResourceStatus;

export interface SshResourceStatusPath {
	connectionId: number;
}
