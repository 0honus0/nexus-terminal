import path from 'node:path';
import { createRequire } from 'node:module';
import type { APIRequestContext } from '@playwright/test';
import { E2E_URLS } from './test-env';
import { decodeWorkspaceBinaryFrame } from '../../../packages/shared/src/remote/workspace/workspace-binary';
import {
	readWorkspaceConnectResponse,
	readWorkspaceMessage,
} from '../../../packages/shared/src/remote/workspace/workspace-codec';
import type {
	WorkspaceResumeRequest,
	WorkspaceResumeResponse,
} from '../../../packages/shared/src/remote/workspace/workspace';
import type {
	WorkspaceSuspendResumeRequest,
	WorkspaceSuspendResumeResponse,
} from '../../../packages/shared/src/remote/suspend/workspace';
import { readWorkspaceSuspendResumeResponse } from '../../../packages/shared/src/remote/suspend/workspace-result-codec';

import type { WorkspaceErrorCode } from '../../../packages/shared/src/remote/workspace/values';

export class WorkspaceRequestFailure extends Error {
	constructor(
		operation: string,
		readonly code: WorkspaceErrorCode,
	) {
		super(operation + ' failed: ' + code);
		this.name = 'WorkspaceRequestFailure';
	}
}

function workspaceFailure(operation: string, value: unknown): Error {
	try {
		const message = readWorkspaceMessage(value);
		if (!('requestId' in message) || message.payload.ok) throw new Error('Invalid Workspace failure response');
		return new WorkspaceRequestFailure(operation, message.payload.error);
	} catch (cause) {
		return new Error('Invalid Workspace failure response', { cause });
	}
}

export { decodeWorkspaceBinaryFrame } from '../../../packages/shared/src/remote/workspace/workspace-binary';

const repoRoot = path.resolve(__dirname, '../../..');
const requireFromBackend = createRequire(path.join(repoRoot, 'packages', 'backend', 'package.json'));
const WebSocket = requireFromBackend('ws') as any;

// Raw Node WebSocket tests do not render terminal frames through xterm. Track
// actual received PTY bytes from socket creation so suspension tests can ACK
// the same flow-control evidence as the browser, without synthesizing bytes.
const receivedTerminalBytes = new WeakMap<object, { bytes: number }>();

export interface JsonWsMessage {
	type?: string;
	requestId?: string;
	payload?: any;
	[key: string]: any;
}

export type E2eWebSocket = any;

export async function openAuthenticatedWebSocket(
	request: APIRequestContext,
	url = `${E2E_URLS.frontendWsOrigin}/ws/workspace`,
): Promise<E2eWebSocket> {
	const state = await request.storageState();
	const cookies = state.cookies
		.filter((cookie) => cookie.domain === '127.0.0.1' || cookie.domain === 'localhost')
		.map((cookie) => `${cookie.name}=${cookie.value}`)
		.join('; ');

	const socket = new WebSocket(url, { headers: { Cookie: cookies, Origin: E2E_URLS.frontendOrigin } });
	const consumed = { bytes: 0 };
	receivedTerminalBytes.set(socket, consumed);
	socket.on('message', (data: Buffer, isBinary: boolean) => {
		if (!isBinary) return;
		try {
			const frame = decodeWorkspaceBinaryFrame(Buffer.from(data));
			if (frame.kind === 'terminal') consumed.bytes += frame.data.byteLength;
		} catch {
			// Protocol-failure tests deliberately inject malformed frames; their
			// own listeners remain responsible for validating those failures.
		}
	});
	await new Promise<void>((resolve, reject) => {
		const timeout = setTimeout(() => reject(new Error(`WebSocket open timeout: ${url}`)), 10_000);
		socket.once('open', () => {
			clearTimeout(timeout);
			resolve();
		});
		socket.once('error', (error: Error) => {
			clearTimeout(timeout);
			reject(error);
		});
	});
	return socket;
}

/** ACK only PTY data actually received on this socket; no global auto-ACK. */
export async function acknowledgeTerminalOutput(socket: E2eWebSocket): Promise<void> {
	const counter = receivedTerminalBytes.get(socket);
	if (!counter) throw new Error('Not a tracked E2E Workspace socket');
	await requestWorkspace(socket, 'terminal.flow', { consumedBytes: counter.bytes });
}

export function sendJson(socket: E2eWebSocket, message: JsonWsMessage): void {
	socket.send(JSON.stringify(message));
}

export function waitForJson(
	socket: E2eWebSocket,
	predicate: (message: JsonWsMessage) => boolean,
	timeoutMs = 15_000,
): Promise<JsonWsMessage> {
	return new Promise((resolve, reject) => {
		const cleanup = () => {
			clearTimeout(timeout);
			socket.off('message', onMessage);
			socket.off('close', onClose);
			socket.off('error', onError);
		};

		const timeout = setTimeout(() => {
			cleanup();
			reject(new Error('Timed out waiting for WebSocket JSON message'));
		}, timeoutMs);

		const onMessage = (data: Buffer, isBinary: boolean) => {
			if (isBinary) return;
			let parsed: JsonWsMessage;
			try {
				parsed = JSON.parse(data.toString('utf8'));
			} catch (cause) {
				cleanup();
				reject(cause);
				return;
			}
			try {
				if (!predicate(parsed)) return;
				cleanup();
				resolve(parsed);
			} catch (cause) {
				cleanup();
				reject(cause);
			}
		};

		const onClose = () => {
			cleanup();
			reject(new Error('WebSocket closed before the expected JSON message'));
		};

		const onError = (cause: Error) => {
			cleanup();
			reject(cause);
		};

		socket.on('message', onMessage);
		socket.once('close', onClose);
		socket.once('error', onError);
	});
}

export function waitForBinaryBytes(
	socket: E2eWebSocket,
	expectedBytes: Uint8Array,
	timeoutMs = 15_000,
): Promise<Buffer> {
	const expected = Buffer.from(expectedBytes);
	return new Promise((resolve, reject) => {
		const chunks: Buffer[] = [];

		const cleanup = () => {
			clearTimeout(timeout);
			socket.off('message', onMessage);
			socket.off('close', onClose);
			socket.off('error', onError);
		};

		const timeout = setTimeout(() => {
			cleanup();
			reject(new Error(`Timed out waiting for ${expected.byteLength} WebSocket binary bytes`));
		}, timeoutMs);

		const onMessage = (data: Buffer, isBinary: boolean) => {
			if (!isBinary) return;
			chunks.push(Buffer.from(data));
			const output = Buffer.concat(chunks);
			if (output.indexOf(expected) === -1) return;
			cleanup();
			resolve(output);
		};

		const onClose = () => {
			cleanup();
			reject(new Error('WebSocket closed before expected binary bytes were received'));
		};

		const onError = (error: Error) => {
			cleanup();
			reject(error);
		};

		socket.on('message', onMessage);
		socket.once('close', onClose);
		socket.once('error', onError);
	});
}

export function waitForBinaryText(socket: E2eWebSocket, expectedText: string, timeoutMs = 15_000): Promise<string> {
	return new Promise((resolve, reject) => {
		const chunks: Buffer[] = [];

		const cleanup = () => {
			clearTimeout(timeout);
			socket.off('message', onMessage);
			socket.off('close', onClose);
			socket.off('error', onError);
		};

		const timeout = setTimeout(() => {
			cleanup();
			reject(new Error(`Timed out waiting for WebSocket binary text: ${expectedText}`));
		}, timeoutMs);

		const onMessage = (data: Buffer, isBinary: boolean) => {
			if (!isBinary) return;
			const frame = decodeWorkspaceBinaryFrame(Buffer.from(data));
			if (frame.kind !== 'terminal') return;
			chunks.push(Buffer.from(frame.data));
			const output = Buffer.concat(chunks).toString('utf8');
			if (!output.includes(expectedText)) return;
			cleanup();
			resolve(output);
		};

		const onClose = () => {
			cleanup();
			reject(new Error(`WebSocket closed before binary text was received: ${expectedText}`));
		};

		const onError = (error: Error) => {
			cleanup();
			reject(error);
		};

		socket.on('message', onMessage);
		socket.once('close', onClose);
		socket.once('error', onError);
	});
}

export function requestWorkspaceBinary<T = unknown>(
	socket: E2eWebSocket,
	type: string,
	payload: object = {},
	requestId: string = crypto.randomUUID(),
	timeoutMs = 20_000,
): Promise<{ data: T; bytes: Buffer }> {
	return new Promise((resolve, reject) => {
		const chunks: Buffer[] = [];
		let response: JsonWsMessage | undefined;
		let binaryDone = false;

		const cleanup = () => {
			clearTimeout(timeout);
			socket.off('message', onMessage);
			socket.off('close', onClose);
			socket.off('error', onError);
		};

		const settle = () => {
			if (!response || !binaryDone) return;
			cleanup();
			if (!response.payload?.ok) {
				reject(workspaceFailure(type, response));
				return;
			}
			resolve({ data: response.payload.data as T, bytes: Buffer.concat(chunks) });
		};

		const timeout = setTimeout(() => {
			cleanup();
			reject(new Error(`Timed out waiting for Workspace binary response: ${type}`));
		}, timeoutMs);

		const onMessage = (raw: Buffer, isBinary: boolean) => {
			if (isBinary) {
				const frame = decodeWorkspaceBinaryFrame(Buffer.from(raw));
				if (frame.kind !== 'response' || frame.requestId !== requestId) return;
				if (frame.data.byteLength) chunks.push(Buffer.from(frame.data));
				if (frame.final) binaryDone = true;
				settle();
				return;
			}
			let parsed: JsonWsMessage;
			try {
				parsed = JSON.parse(Buffer.from(raw).toString('utf8')) as JsonWsMessage;
			} catch {
				return;
			}
			if (parsed.type !== 'response' || parsed.requestId !== requestId) return;
			response = parsed;
			if (!parsed.payload?.ok) binaryDone = true;
			settle();
		};

		const onClose = () => {
			cleanup();
			reject(new Error(`WebSocket closed before Workspace binary response: ${type}`));
		};

		const onError = (error: Error) => {
			cleanup();
			reject(error);
		};

		socket.on('message', onMessage);
		socket.once('close', onClose);
		socket.once('error', onError);
		sendJson(socket, { type, payload, requestId });
	});
}

export async function requestWorkspace<T = unknown>(
	socket: E2eWebSocket,
	type: string,
	payload: object = {},
	requestId: string = crypto.randomUUID(),
	timeoutMs = 20_000,
): Promise<T> {
	const responsePromise = waitForJson(
		socket,
		(message) => message.type === 'response' && message.requestId === requestId,
		timeoutMs,
	);
	sendJson(socket, { type, payload, requestId });
	const response = await responsePromise;
	if (!response.payload?.ok) throw workspaceFailure(type, response);
	return response.payload.data as T;
}

export async function openWorkspaceSession(
	request: APIRequestContext,
	connectionId: number,
	workspaceId = `e2e-${crypto.randomUUID()}`,
): Promise<{
	socket: E2eWebSocket;
	workspaceId: string;
	lastConnectedAt: number;
	resumeToken: string;
	attachmentGeneration: number;
	terminalOffset: number;
}> {
	const socket = await openAuthenticatedWebSocket(request);
	try {
		const connected = readWorkspaceConnectResponse(
			await requestWorkspace(socket, 'workspace.connect', {
				connectionId,
				workspaceId,
				viewport: { columns: 100, rows: 30 },
			}),
		);
		if (
			connected.workspaceId !== workspaceId ||
			connected.connectionId !== connectionId ||
			connected.lastConnectedAt === undefined
		) {
			throw new Error('Workspace connection response belongs to another resource');
		}
		return {
			socket,
			workspaceId: connected.workspaceId,
			lastConnectedAt: connected.lastConnectedAt,
			resumeToken: connected.resumeToken,
			attachmentGeneration: connected.attachmentGeneration,
			terminalOffset: connected.terminalOffset,
		};
	} catch (cause) {
		try {
			await closeWebSocket(socket);
		} catch (cleanup) {
			throw new AggregateError([cause, cleanup], 'Workspace initialization and close failed');
		}
		throw cause;
	}
}

/** Normal lifecycle only; rejection and lost-ACK cases must use the raw request helper. */
export async function resumeWorkspaceSession(
	socket: E2eWebSocket,
	input: WorkspaceResumeRequest,
): Promise<WorkspaceResumeResponse> {
	const payload: WorkspaceResumeRequest = {
		workspaceId: input.workspaceId,
		connectionId: input.connectionId,
		resumeToken: input.resumeToken,
		attachmentGeneration: input.attachmentGeneration,
		terminalOffset: input.terminalOffset,
	};
	if (input.viewport !== undefined) {
		payload.viewport = { columns: input.viewport.columns, rows: input.viewport.rows };
	}
	const result = readWorkspaceConnectResponse(await requestWorkspace(socket, 'workspace.resume', payload));
	if (
		result.workspaceId !== input.workspaceId ||
		result.connectionId !== input.connectionId ||
		result.resumeToken === input.resumeToken ||
		result.attachmentGeneration <= input.attachmentGeneration
	) {
		throw new Error('Workspace resume response does not match the requested handover');
	}
	await requestWorkspace(socket, 'workspace.resumeAck', {
		resumeToken: result.resumeToken,
		attachmentGeneration: result.attachmentGeneration,
	});
	return result;
}

export async function resumeSuspendedWorkspace(
	socket: E2eWebSocket,
	input: WorkspaceSuspendResumeRequest,
): Promise<WorkspaceSuspendResumeResponse> {
	const payload: WorkspaceSuspendResumeRequest = {
		suspendedSessionId: input.suspendedSessionId,
		workspaceId: input.workspaceId,
	};
	if (input.viewport !== undefined) {
		payload.viewport = { columns: input.viewport.columns, rows: input.viewport.rows };
	}
	if (input.takeover !== undefined) {
		payload.takeover = input.takeover;
	}
	const result = readWorkspaceSuspendResumeResponse(await requestWorkspace(socket, 'suspend.resume', payload));
	if (result.workspaceId !== input.workspaceId || result.resumedFrom !== input.suspendedSessionId) {
		throw new Error('Suspended workspace response belongs to another handover');
	}
	await requestWorkspace(socket, 'suspend.resumeAck', {
		suspendedSessionId: input.suspendedSessionId,
		resumeToken: result.resumeToken,
		attachmentGeneration: result.attachmentGeneration,
		ownershipGeneration: result.ownershipGeneration,
	});
	return result;
}

export async function waitForFilesystemReady(socket: E2eWebSocket): Promise<void> {
	for (let attempt = 0; attempt < 30; attempt += 1) {
		try {
			await requestWorkspace(
				socket,
				'filesystem.list',
				{ path: '/' },
				`filesystem-ready-${attempt}-${crypto.randomUUID()}`,
				2_000,
			);
			return;
		} catch {
			await new Promise((resolve) => setTimeout(resolve, 100));
		}
	}
	throw new Error('Filesystem did not become ready');
}

export async function closeWebSocket(socket: E2eWebSocket): Promise<void> {
	if (!socket || socket.readyState === WebSocket.CLOSED) return;
	await new Promise<void>((resolve, reject) => {
		const cleanup = () => {
			clearTimeout(timeout);
			socket.off('close', closed);
		};

		const closed = () => {
			cleanup();
			resolve();
		};

		const timeout = setTimeout(() => {
			cleanup();
			try {
				socket.terminate();
			} catch (cause) {
				reject(new Error('WebSocket close and forced cleanup failed', { cause }));
				return;
			}
			reject(new Error('WebSocket close was not confirmed before its deadline'));
		}, 5000);
		socket.once('close', closed);
		if (socket.readyState !== WebSocket.CLOSING) {
			try {
				socket.close();
			} catch (cause) {
				cleanup();
				reject(cause);
			}
		}
	});
}
