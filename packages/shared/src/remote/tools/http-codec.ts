import type {
	RemoteToolCheckRequest,
	RemoteToolInstallRequest,
	RemoteToolInstallResponse,
	RemoteToolErrorResponse,
} from './http.js';
import type { RemoteToolCheck } from './model.js';
import { SERVER_TRANSFER_METHODS } from '../transfers/server-values.js';
import {
	REMOTE_TOOLS,
	TOOL_PACKAGE_MANAGERS,
	TOOL_PRIVILEGES,
	TOOL_ERROR_CODES,
	isToolPassword,
	type RemoteTool,
} from './values.js';

export class InvalidRemoteToolPayload extends Error {
	constructor() {
		super('Invalid remote tool payload');
	}
}

function reject(): never {
	throw new InvalidRemoteToolPayload();
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function object(value: unknown, keys: string[]): Record<string, unknown> {
	if (!isRecord(value) || Object.keys(value).some((key) => !keys.includes(key))) {
		return reject();
	}
	return value;
}

function choice<T extends string>(value: unknown, choices: readonly T[]): T {
	for (const item of choices) {
		if (item === value) {
			return item;
		}
	}
	return reject();
}

function id(value: unknown): number {
	if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1) {
		return reject();
	}
	return value;
}

function uuid(value: unknown): string {
	if (
		typeof value !== 'string' ||
		!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u.test(value)
	) {
		return reject();
	}
	return value;
}

function tools(value: unknown, empty: boolean): RemoteTool[] {
	if (!Array.isArray(value) || value.length > REMOTE_TOOLS.length || (!empty && !value.length)) {
		return reject();
	}
	const result = value.map((tool: unknown) => choice(tool, REMOTE_TOOLS));
	if (new Set(result).size !== result.length) {
		return reject();
	}
	return result;
}

export function readRemoteToolCheckRequest(value: unknown): RemoteToolCheckRequest {
	const input = object(value, ['kind', 'targetId', 'tools', 'peerId', 'side', 'method']);
	if (input.kind === 'tools') {
		object(value, ['kind', 'targetId', 'tools']);
		return { kind: 'tools', targetId: id(input.targetId), tools: tools(input.tools, false) };
	}
	if (input.kind !== 'transfer') {
		return reject();
	}
	object(value, ['kind', 'targetId', 'peerId', 'side', 'method']);
	const targetId = id(input.targetId);
	const peerId = id(input.peerId);
	if (targetId === peerId) {
		return reject();
	}
	return {
		kind: 'transfer',
		targetId,
		peerId,
		side: choice(input.side, ['source', 'target']),
		method: choice(input.method, SERVER_TRANSFER_METHODS),
	};
}

export function readRemoteToolInstallRequest(value: unknown): RemoteToolInstallRequest {
	const input = object(value, ['planId', 'password']);
	const result: RemoteToolInstallRequest = { planId: uuid(input.planId) };
	if ('password' in input) {
		if (!isToolPassword(input.password)) {
			return reject();
		}
		result.password = input.password;
	}
	return result;
}

export function readRemoteToolCheck(value: unknown): RemoteToolCheck {
	const input = object(value, ['targetId', 'tools', 'missing', 'manager', 'privilege', 'planId', 'expiresAt']);
	const requested = tools(input.tools, false);
	const missing = tools(input.missing, true);
	if (missing.some((tool) => !requested.includes(tool))) {
		return reject();
	}
	const manager = input.manager === null ? null : choice(input.manager, TOOL_PACKAGE_MANAGERS);
	const privilege = choice(input.privilege, TOOL_PRIVILEGES);
	const possible = missing.length > 0 && manager !== null && privilege !== 'unavailable';
	if (possible !== (input.planId !== null) || possible !== (input.expiresAt !== null)) {
		return reject();
	}
	return {
		targetId: id(input.targetId),
		tools: requested,
		missing,
		manager,
		privilege,
		planId: input.planId === null ? null : uuid(input.planId),
		expiresAt: input.expiresAt === null ? null : id(input.expiresAt),
	};
}

export function readRemoteToolInstallResponse(value: unknown): RemoteToolInstallResponse {
	const input = object(value, ['targetId', 'ready']);
	if (input.ready !== true) {
		return reject();
	}
	return { targetId: id(input.targetId), ready: true };
}

export function readRemoteToolError(value: unknown): RemoteToolErrorResponse {
	return { code: choice(object(value, ['code']).code, TOOL_ERROR_CODES) };
}
