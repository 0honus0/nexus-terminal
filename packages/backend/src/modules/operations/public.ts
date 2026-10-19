import type { OperationEvent } from '@nexus-terminal/shared/operations/values';

export interface OperationNotice {
	key: string;
	event: OperationEvent;
	userId: number | null;
	subjectId: string | null;
	sourceIp: string | null;
	route: string | null;
	statusCode: number | null;
}

export interface OperationsEvents {
	publish(notice: OperationNotice): Promise<void>;
}
