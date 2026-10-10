import {
	InvalidAgentPayload,
	encodeAgentJson,
	readAgentErrorResponse,
	readAgentId,
} from '@nexus-terminal/shared/agent/http-codec';
import { AGENT_MAX_JSON_BODY_BYTES, AGENT_MAX_RESPONSE_BYTES } from '@nexus-terminal/shared/agent/values';
import {
	readAgentCreateAppRequest,
	readAgentCreateAppResponse,
	readAgentCreateThreadRequest,
	readAgentCreateThreadResponse,
} from '@nexus-terminal/shared/agent/scope/http-codec';
import type { AgentAppView, AgentThreadView } from '@nexus-terminal/shared/agent/scope/model';
import {
	readAgentCancelRunRequest,
	readAgentCancelRunResponse,
	readAgentCreateRunRequest,
	readAgentCreateRunResponse,
	readAgentRunCommandHeaders,
	readAgentRunEventsQuery,
	readAgentRunEventsResponse,
	readAgentRunResponse,
} from '@nexus-terminal/shared/agent/runs/http-codec';
import type {
	AgentCancelRunResponse,
	AgentCreateRunResponse,
	AgentRunEventsResponse,
} from '@nexus-terminal/shared/agent/runs/http';
import type { AgentRunView } from '@nexus-terminal/shared/agent/runs/model';
import { AGENT_RUN_IDEMPOTENCY_HEADER, AGENT_RUN_MAX_JSON_BODY_BYTES } from '@nexus-terminal/shared/agent/runs/values';

function requestFailure(): Error {
	return new Error('request_failed');
}

class AgentNextProtocolFailure extends Error {
	constructor() {
		super('protocol_failure');
	}
}

function protocolFailure(): Error {
	return new AgentNextProtocolFailure();
}

async function readBoundedJson(response: Response): Promise<unknown> {
	const declared = response.headers.get('content-length');
	if (declared !== null) {
		if (!/^(0|[1-9][0-9]*)$/u.test(declared)) {
			throw protocolFailure();
		}
		const bytes = Number(declared);
		if (!Number.isSafeInteger(bytes) || bytes > AGENT_MAX_RESPONSE_BYTES) {
			throw protocolFailure();
		}
	}
	const reader = response.body?.getReader();
	if (!reader) {
		throw protocolFailure();
	}
	const chunks: Uint8Array[] = [];
	let received = 0;
	try {
		while (true) {
			const result = await reader.read();
			if (result.done) break;
			received += result.value.byteLength;
			if (received > AGENT_MAX_RESPONSE_BYTES) {
				try {
					await reader.cancel();
				} catch {
					// The response is already invalid; cancellation failure does not change that.
				}
				throw protocolFailure();
			}
			chunks.push(result.value);
		}
	} catch (error) {
		if (error instanceof AgentNextProtocolFailure) {
			throw error;
		}
		throw requestFailure();
	} finally {
		reader.releaseLock();
	}
	const bytes = new Uint8Array(received);
	let offset = 0;
	for (const chunk of chunks) {
		bytes.set(chunk, offset);
		offset += chunk.byteLength;
	}
	try {
		return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) as unknown;
	} catch {
		throw protocolFailure();
	}
}

function decoded<T>(value: unknown, decode: (input: unknown) => T): T {
	try {
		return decode(value);
	} catch (error) {
		if (error instanceof InvalidAgentPayload) {
			throw protocolFailure();
		}
		throw error;
	}
}

function inputDecoded<T>(decode: () => T): T {
	try {
		return decode();
	} catch (error) {
		if (error instanceof InvalidAgentPayload) {
			throw new Error('invalid_input');
		}
		throw error;
	}
}

function encoded<T>(value: unknown, decode: (input: unknown) => T, maxBytes: number): string {
	try {
		return encodeAgentJson(decode(value), maxBytes);
	} catch (error) {
		if (error instanceof InvalidAgentPayload) {
			throw new Error('invalid_input');
		}
		throw error;
	}
}

export function createAgentNextApi(baseUrl: string) {
	const origin = new URL(baseUrl, window.location.href);
	if (origin.origin !== window.location.origin || origin.pathname !== '/__next/' || origin.search || origin.hash) {
		throw requestFailure();
	}
	const base = origin.origin + '/__next/api/v1/agent';

	async function request(
		method: 'GET' | 'POST',
		path: string,
		body?: string,
		operationKey?: string,
		signal?: AbortSignal,
	): Promise<unknown> {
		let response: Response;
		try {
			response = await fetch(base + path, {
				method,
				credentials: 'same-origin',
				cache: 'no-store',
				signal,
				headers: {
					...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
					...(operationKey === undefined ? {} : { [AGENT_RUN_IDEMPOTENCY_HEADER]: operationKey }),
				},
				...(body === undefined ? {} : { body }),
			});
		} catch (error) {
			if (signal?.aborted) throw error;
			throw requestFailure();
		}
		const value = await readBoundedJson(response);
		if (!response.ok) {
			try {
				throw new Error(readAgentErrorResponse(value).code);
			} catch (error) {
				if (error instanceof InvalidAgentPayload) {
					throw protocolFailure();
				}
				throw error;
			}
		}
		return value;
	}

	return {
		createApp: async (name: string, signal?: AbortSignal): Promise<AgentAppView> => {
			const body = encoded({ name }, readAgentCreateAppRequest, AGENT_MAX_JSON_BODY_BYTES);
			return decoded(await request('POST', '/apps', body, undefined, signal), readAgentCreateAppResponse);
		},

		createThread: async (appId: string, title: string, signal?: AbortSignal): Promise<AgentThreadView> => {
			const app = inputDecoded(() => readAgentId(appId));
			const body = encoded({ title }, readAgentCreateThreadRequest, AGENT_MAX_JSON_BODY_BYTES);
			return decoded(
				await request('POST', `/apps/${app}/threads`, body, undefined, signal),
				readAgentCreateThreadResponse,
			);
		},

		createRun: async (
			appId: string,
			threadId: string,
			prompt: string,
			operationKey: string,
			signal?: AbortSignal,
		): Promise<AgentCreateRunResponse> => {
			const app = inputDecoded(() => readAgentId(appId));
			const thread = inputDecoded(() => readAgentId(threadId));
			const key = inputDecoded(() => readAgentRunCommandHeaders(operationKey).operationKey);
			const body = encoded({ prompt }, readAgentCreateRunRequest, AGENT_RUN_MAX_JSON_BODY_BYTES);
			return decoded(
				await request('POST', `/apps/${app}/threads/${thread}/runs`, body, key, signal),
				readAgentCreateRunResponse,
			);
		},

		cancelRun: async (
			appId: string,
			runId: string,
			expectedVersion: number,
			operationKey: string,
			signal?: AbortSignal,
		): Promise<AgentCancelRunResponse> => {
			const app = inputDecoded(() => readAgentId(appId));
			const run = inputDecoded(() => readAgentId(runId));
			const key = inputDecoded(() => readAgentRunCommandHeaders(operationKey).operationKey);
			const body = encoded({ expectedVersion }, readAgentCancelRunRequest, AGENT_MAX_JSON_BODY_BYTES);
			return decoded(
				await request('POST', `/apps/${app}/runs/${run}/cancel`, body, key, signal),
				readAgentCancelRunResponse,
			);
		},

		getRun: async (appId: string, runId: string, signal?: AbortSignal): Promise<AgentRunView> => {
			const app = inputDecoded(() => readAgentId(appId));
			const run = inputDecoded(() => readAgentId(runId));
			return decoded(
				await request('GET', `/apps/${app}/runs/${run}`, undefined, undefined, signal),
				readAgentRunResponse,
			);
		},

		listEvents: async (
			appId: string,
			runId: string,
			after: number,
			limit: number,
			signal?: AbortSignal,
		): Promise<AgentRunEventsResponse> => {
			const app = inputDecoded(() => readAgentId(appId));
			const run = inputDecoded(() => readAgentId(runId));
			const params = new URLSearchParams({ after: String(after), limit: String(limit) });
			const query = inputDecoded(() => readAgentRunEventsQuery(params));
			const response = decoded(
				await request(
					'GET',
					`/apps/${app}/runs/${run}/events?after=${query.after}&limit=${query.limit}`,
					undefined,
					undefined,
					signal,
				),
				readAgentRunEventsResponse,
			);
			if (response.items.some((item) => item.runId !== run)) {
				throw protocolFailure();
			}
			return response;
		},
	};
}

export type AgentNextApi = ReturnType<typeof createAgentNextApi>;
