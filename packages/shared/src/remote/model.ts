/** New backend-only SSH PTY session. Not a legacy Workspace session/ticket. */
export interface RemoteShellView {
	id: string;
	targetId: number;
	configurationFingerprint: string;
	startedAt: number;
	status: 'open';
}

export interface RemoteOpenShell {
	targetId: number;
	columns: number;
	rows: number;
	term?: string;
}

export class InvalidRemotePayload extends Error {
	constructor() {
		super('invalid_remote_payload');
	}
}

function remoteObject(value: unknown, allowed: readonly string[], required = allowed): Record<string, unknown> {
	if (value === null || typeof value !== 'object' || Array.isArray(value)) {
		throw new InvalidRemotePayload();
	}
	const row = value as Record<string, unknown>;
	if (
		Object.keys(row).some((field) => !allowed.includes(field)) ||
		required.some((field) => !Object.hasOwn(row, field))
	) {
		throw new InvalidRemotePayload();
	}
	return row;
}

function positiveRemoteNumber(value: unknown, maximum: number): number {
	if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1 || value > maximum) {
		throw new InvalidRemotePayload();
	}
	return value;
}

export function readRemoteOpenShell(value: unknown): RemoteOpenShell {
	const row = remoteObject(value, ['targetId', 'columns', 'rows', 'term'], ['targetId', 'columns', 'rows']);
	if (
		row.term !== undefined &&
		(typeof row.term !== 'string' || row.term.length > 48 || !/^[-\\w.]+$/u.test(row.term))
	) {
		throw new InvalidRemotePayload();
	}
	return {
		targetId: positiveRemoteNumber(row.targetId, Number.MAX_SAFE_INTEGER),
		columns: positiveRemoteNumber(row.columns, 500),
		rows: positiveRemoteNumber(row.rows, 300),
		...(row.term === undefined ? {} : { term: row.term }),
	};
}

export function readRemoteShellView(value: unknown): RemoteShellView {
	const row = remoteObject(value, ['id', 'targetId', 'configurationFingerprint', 'startedAt', 'status']);
	if (
		typeof row.id !== 'string' ||
		!/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/iu.test(row.id) ||
		typeof row.configurationFingerprint !== 'string' ||
		row.configurationFingerprint.length < 1 ||
		row.configurationFingerprint.length > 256 ||
		typeof row.startedAt !== 'number' ||
		!Number.isSafeInteger(row.startedAt) ||
		row.startedAt < 0 ||
		row.status !== 'open'
	) {
		throw new InvalidRemotePayload();
	}
	return {
		id: row.id,
		targetId: positiveRemoteNumber(row.targetId, Number.MAX_SAFE_INTEGER),
		configurationFingerprint: row.configurationFingerprint,
		startedAt: row.startedAt,
		status: 'open',
	};
}
