import {
	readSuspendedSessionId,
	readSuspendedSessionCatalog,
	readSuspendedSessionRename,
	readSuspendedSessionRenameResponse,
	readSuspendedSessionRemoval,
	readSuspendedSessionError,
} from '@nexus-terminal/shared/remote/suspend/http-codec';
import {
	SUSPENDED_CATALOG_MAX_JSON_BYTES,
	SUSPENDED_MANAGEMENT_MAX_JSON_BYTES,
	SUSPENDED_LOG_MAX_BYTES,
	suspendedHttpErrorStatus,
	type SuspendedRemovalDisposition,
} from '@nexus-terminal/shared/remote/suspend/values';
import { requestJson } from '@/client/http/json-client';
import { HttpRequestFailure } from '@/client/http/request-failure';
import { SuspendedRequestFailure } from '../model/suspended-session-types';
import type { SuspendedSession } from '../model/suspended-session-types';
import { toSuspendedSession } from '../model/suspended-session-mapper';

const ROOT = '/api/v1/ssh-suspend';

function id(value: string): string {
	try {
		return readSuspendedSessionId(value);
	} catch (cause) {
		throw new SuspendedRequestFailure('invalid_input', 'not_dispatched', undefined, { cause });
	}
}

function refusal(status: number, value: unknown): never {
	try {
		const { code } = readSuspendedSessionError(value);
		if (suspendedHttpErrorStatus(code) !== status) {
			throw new Error('Inconsistent suspended failure');
		}
		throw new SuspendedRequestFailure(
			code,
			code === 'operation_unknown' || code === 'remote_unavailable' || code === 'internal_failure'
				? 'unknown'
				: 'confirmed',
			status,
		);
	} catch (cause) {
		if (cause instanceof SuspendedRequestFailure) {
			throw cause;
		}
		throw new SuspendedRequestFailure('protocol_failure', 'unknown', status, { cause });
	}
}

async function request<T>(
	method: 'GET' | 'PUT' | 'DELETE',
	path: string,
	decode: (value: unknown) => T,
	signal?: AbortSignal,
	body?: unknown,
): Promise<T> {
	try {
		const response = await requestJson({
			method,
			url: ROOT + path,
			body,
			signal,
			maxRequestBytes: SUSPENDED_MANAGEMENT_MAX_JSON_BYTES,
			maxResponseBytes: method === 'GET' ? SUSPENDED_CATALOG_MAX_JSON_BYTES : SUSPENDED_MANAGEMENT_MAX_JSON_BYTES,
		});
		if (response.status >= 400) {
			refusal(response.status, response.body);
		}
		if (response.status !== 200) {
			throw new SuspendedRequestFailure('protocol_failure', 'unknown', response.status);
		}
		try {
			return decode(response.body);
		} catch (cause) {
			throw new SuspendedRequestFailure('protocol_failure', 'unknown', response.status, { cause });
		}
	} catch (cause) {
		if (cause instanceof SuspendedRequestFailure) {
			throw cause;
		}
		throw new SuspendedRequestFailure(
			cause instanceof HttpRequestFailure ? cause.code : 'request_failed',
			cause instanceof HttpRequestFailure ? cause.outcome : 'unknown',
			undefined,
			{ cause },
		);
	}
}

/** Read once, with independent reader cancellation/release on every failure. Never retries HTTP. */
async function logBytes(response: Response, filename: string, signal: AbortSignal): Promise<Uint8Array<ArrayBuffer>[]> {
	const limit = response.status === 200 ? SUSPENDED_LOG_MAX_BYTES : SUSPENDED_MANAGEMENT_MAX_JSON_BYTES;
	let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
	let ended = false;
	const failures: unknown[] = [];
	const chunks: Uint8Array<ArrayBuffer>[] = [];
	try {
		signal.throwIfAborted();
		const contentType = response.headers.get('content-type');
		const validHeaders =
			response.status === 200
				? contentType === 'text/plain; charset=utf-8' &&
					response.headers.get('content-disposition') === 'attachment; filename="' + filename + '"'
				: contentType !== null && /^application\/json(?:\s*;\s*charset=utf-8)?$/iu.test(contentType.trim());
		if (!validHeaders) {
			throw new SuspendedRequestFailure('protocol_failure', 'unknown', response.status);
		}
		const declared = response.headers.get('content-length');
		if (
			declared !== null &&
			(!/^(0|[1-9][0-9]*)$/u.test(declared) ||
				!Number.isSafeInteger(Number(declared)) ||
				Number(declared) > limit)
		) {
			throw new SuspendedRequestFailure('protocol_failure', 'unknown', response.status);
		}
		reader = response.body?.getReader();
		if (!reader) {
			throw new SuspendedRequestFailure('protocol_failure', 'unknown', response.status);
		}
		let size = 0;
		while (true) {
			const next = await reader.read();
			signal.throwIfAborted();
			if (next.done) {
				ended = true;
				break;
			}
			size += next.value.byteLength;
			if (size > limit) {
				throw new SuspendedRequestFailure('protocol_failure', 'unknown', response.status);
			}
			chunks.push(Uint8Array.from(next.value));
		}
		if (declared !== null && Number(declared) !== size && !response.headers.has('content-encoding')) {
			throw new SuspendedRequestFailure('protocol_failure', 'unknown', response.status);
		}
	} catch (cause) {
		failures.push(cause);
	} finally {
		if (!ended) {
			try {
				if (reader) {
					await reader.cancel();
				} else {
					await response.body?.cancel();
				}
			} catch (cause) {
				failures.push(cause);
			}
		}
		try {
			reader?.releaseLock();
		} catch (cause) {
			failures.push(cause);
		}
	}
	if (failures.length) {
		const failure = failures[0];
		throw new SuspendedRequestFailure(
			failure instanceof SuspendedRequestFailure ? failure.code : 'request_failed',
			'unknown',
			response.status,
			{ cause: failures.length === 1 ? failure : new AggregateError(failures, 'Log read and cleanup failed') },
		);
	}
	return chunks;
}

export const suspendedSessionsApi = {
	async list(signal?: AbortSignal): Promise<SuspendedSession[]> {
		return (await request('GET', '/suspended-sessions', readSuspendedSessionCatalog, signal)).map(
			toSuspendedSession,
		);
	},

	async remove(sessionId: string, signal?: AbortSignal): Promise<SuspendedRemovalDisposition> {
		const expectedId = id(sessionId);
		const result = await request(
			'DELETE',
			'/remove/' + expectedId,
			(value) => {
				const response = readSuspendedSessionRemoval(value);
				if (response.suspendedSessionId !== expectedId) {
					throw new Error('Inconsistent suspended removal');
				}
				return response;
			},
			signal,
		);
		return result.disposition;
	},

	async rename(sessionId: string, customName: string, signal?: AbortSignal): Promise<string> {
		let input;
		try {
			input = readSuspendedSessionRename({ customName });
		} catch (cause) {
			throw new SuspendedRequestFailure('invalid_input', 'not_dispatched', undefined, { cause });
		}
		const result = await request(
			'PUT',
			'/name/' + id(sessionId),
			readSuspendedSessionRenameResponse,
			signal,
			input,
		);
		if (result.customName !== input.customName) {
			throw new SuspendedRequestFailure('protocol_failure', 'unknown');
		}
		return result.customName;
	},

	async exportLog(sessionId: string, signal?: AbortSignal): Promise<string> {
		const filename = id(sessionId) + '.txt';
		if (signal?.aborted) {
			throw new SuspendedRequestFailure('cancelled', 'not_dispatched');
		}
		const deadline = AbortSignal.timeout(60_000);
		const active = signal ? AbortSignal.any([signal, deadline]) : deadline;
		let response;
		try {
			response = await fetch(ROOT + '/log/' + sessionId, {
				credentials: 'same-origin',
				cache: 'no-store',
				redirect: 'error',
				signal: active,
			});
		} catch (cause) {
			throw new SuspendedRequestFailure('request_failed', 'unknown', undefined, { cause });
		}
		const chunks = await logBytes(response, filename, active);
		if (response.status !== 200) {
			let value: unknown;
			try {
				value = JSON.parse(
					new TextDecoder('utf-8', { fatal: true }).decode(await new Blob(chunks).arrayBuffer()),
				);
			} catch (cause) {
				throw new SuspendedRequestFailure('protocol_failure', 'unknown', response.status, { cause });
			}
			refusal(response.status, value);
		}
		active.throwIfAborted();
		const url = URL.createObjectURL(new Blob(chunks, { type: 'text/plain;charset=utf-8' }));
		const anchor = document.createElement('a');
		try {
			anchor.href = url;
			anchor.download = filename;
			document.body.appendChild(anchor);
			anchor.click();
		} finally {
			anchor.remove();
			URL.revokeObjectURL(url);
		}
		return filename;
	},
};
