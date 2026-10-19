import type { ServerTransferSnapshot } from './server-model.js';
import type { ServerTransferErrorCode } from './server-values.js';

export interface ServerTransferPage {
	items: ServerTransferSnapshot[];
	nextCursor: string | null;
}

export interface ServerTransferCancellation {
	taskId: string;
	accepted: true;
}

export interface ServerTransferHttpError {
	code: ServerTransferErrorCode;
}
