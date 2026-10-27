import {
	readServerTransferInput,
	readServerTransferSnapshot,
	readServerTransferPage,
	readServerTransferId,
	readServerTransferCancellation,
	readServerTransferError,
} from '@nexus-terminal/shared/remote/transfers/server-codec';
import {
	SERVER_TRANSFER_REQUEST_MAX_BYTES,
	SERVER_TRANSFER_TASK_MAX_BYTES,
	SERVER_TRANSFER_PAGE_MAX_BYTES,
	serverTransferErrorStatus,
} from '@nexus-terminal/shared/remote/transfers/server-values';
import { requestJson } from '@/client/http/json-client';
import { HttpRequestFailure } from '@/client/http/request-failure';
import { ServerTransferRequestFailure } from '../model/server-transfer-types';
import type { SendFilesCommand, ServerTransferTask } from '../model/server-transfer-types';
import { toServerTransferTask } from '../model/server-transfer-mapper';
import type { ServerTransferPage } from '@nexus-terminal/shared/remote/transfers/server-http';

async function request<T>(
	method: 'GET' | 'POST' | 'DELETE',
	path: string,
	expected: number,
	decode: (value: unknown) => T,
	signal?: AbortSignal,
	body?: unknown,
	maxResponseBytes = SERVER_TRANSFER_TASK_MAX_BYTES,
): Promise<T> {
	let response;
	try {
		response = await requestJson({
			method,
			url: '/api/v1/transfers' + path,
			body,
			signal,
			maxRequestBytes: SERVER_TRANSFER_REQUEST_MAX_BYTES,
			maxResponseBytes,
		});
	} catch (cause) {
		throw new ServerTransferRequestFailure(
			cause instanceof HttpRequestFailure ? cause.code : 'request_failed',
			cause instanceof HttpRequestFailure ? cause.outcome : 'unknown',
			{ cause },
		);
	}
	if (response.status >= 400) {
		let code;
		try {
			code = readServerTransferError(response.body).code;
			if (serverTransferErrorStatus(code) !== response.status) {
				throw new Error('Inconsistent transfer failure');
			}
		} catch (cause) {
			throw new ServerTransferRequestFailure('protocol_failure', 'unknown', { cause });
		}
		throw new ServerTransferRequestFailure(
			code,
			['operation_unknown', 'cleanup_failed', 'storage_unavailable', 'internal_failure'].includes(code)
				? 'unknown'
				: 'confirmed',
		);
	}
	try {
		if (response.status !== expected) {
			throw new Error('Unexpected transfer response');
		}
		return decode(response.body);
	} catch (cause) {
		throw new ServerTransferRequestFailure('protocol_failure', 'unknown', { cause });
	}
}

function id(value: string): string {
	try {
		return readServerTransferId(value);
	} catch (cause) {
		throw new ServerTransferRequestFailure('invalid_input', 'not_dispatched', { cause });
	}
}

export const serverTransfersApi = {
	async list(signal?: AbortSignal): Promise<ServerTransferTask[]> {
		const result: ServerTransferTask[] = [];
		let after: string | null = null;
		const seen = new Set<string>();
		do {
			const cursor: string | null = after;
			const page: ServerTransferPage = await request(
				'GET',
				'/status' + (cursor === null ? '' : '?after=' + encodeURIComponent(cursor)),
				200,
				readServerTransferPage,
				signal,
				undefined,
				SERVER_TRANSFER_PAGE_MAX_BYTES,
			);
			for (const task of page.items) {
				if (seen.has(task.taskId) || (cursor !== null && task.taskId <= cursor)) {
					throw new ServerTransferRequestFailure('protocol_failure', 'unknown');
				}
				seen.add(task.taskId);
				result.push(toServerTransferTask(task));
			}
			after = page.nextCursor;
		} while (after !== null);
		return result;
	},

	async details(taskId: string, signal?: AbortSignal): Promise<ServerTransferTask> {
		const task = await request(
			'GET',
			'/status/' + id(taskId),
			200,
			(value) => {
				const task = readServerTransferSnapshot(value);
				if (task.taskId !== taskId) {
					throw new Error('Unrelated transfer');
				}
				return task;
			},
			signal,
		);
		return toServerTransferTask(task);
	},

	async send(input: SendFilesCommand, signal?: AbortSignal): Promise<ServerTransferTask> {
		let command;
		try {
			command = readServerTransferInput({
				sourceConnectionId: input.sourceConnectionId,
				connectionIds: input.connectionIds.map((id) => id),
				sourceItems: input.sourceItems.map((item) => ({ name: item.name, path: item.path, type: item.type })),
				remoteTargetPath: input.remoteTargetPath,
				transferMethod: input.transferMethod,
			});
		} catch (cause) {
			throw new ServerTransferRequestFailure('invalid_input', 'not_dispatched', { cause });
		}
		const expected = JSON.stringify(command);
		const task = await request(
			'POST',
			'/send',
			202,
			(value) => {
				const task = readServerTransferSnapshot(value);
				if (task.status !== 'queued' || JSON.stringify(task.payload) !== expected) {
					throw new Error('Unrelated transfer acceptance');
				}
				return task;
			},
			signal,
			command,
		);
		return toServerTransferTask(task);
	},

	async cancel(taskId: string, signal?: AbortSignal): Promise<void> {
		await request(
			'POST',
			'/cancel/' + id(taskId),
			200,
			(value) => {
				const result = readServerTransferCancellation(value);
				if (result.taskId !== taskId) {
					throw new Error('Unrelated cancellation');
				}
			},
			signal,
		);
	},

	async remove(taskId: string, signal?: AbortSignal): Promise<void> {
		await request(
			'DELETE',
			'/' + id(taskId),
			204,
			(value) => {
				if (value !== undefined) {
					throw new Error('Unexpected removal response');
				}
			},
			signal,
		);
	},
};
