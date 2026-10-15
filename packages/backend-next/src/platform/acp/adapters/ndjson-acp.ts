import type { MachineCommand } from '../../ssh/ssh-port.js';
import type { AcpPort, AcpRequest, AcpCallbacks, AcpResult } from '../acp-port.js';
import { AcpFailure } from '../acp-port.js';
import { record, text, messageId, permission, stopReason } from './acp-codec.js';

interface PendingRequest {
	method: string;
	resolve(value: Record<string, unknown>): void;
	reject(error: unknown): void;
}

/** ACP v1 over one owned command channel. No direct filesystem or terminal capability is advertised. */
export class NdjsonAcpAdapter implements AcpPort {
	async execute(channel: MachineCommand, input: AcpRequest, callbacks: AcpCallbacks): Promise<AcpResult> {
		const lifetime = new AbortController();
		const pending = new Map<string, PendingRequest>();
		const handlers = new Set<Promise<void>>();
		const seen = new Set<string>();
		let serial = 0;
		let sessionId: string | null = null;
		let output = '';
		let failure: unknown = null;
		let closing = false;
		let promptActive = false;
		let promptFinished = false;
		let writes: Promise<void> = Promise.resolve();

		const fail = (error: unknown) => {
			failure ??= error;
			lifetime.abort();
			for (const request of pending.values()) {
				request.reject(failure);
			}
			pending.clear();
			channel.cancel();
		};

		const write = (value: Record<string, unknown>): Promise<void> => {
			const encoded = JSON.stringify(value) + '\n';
			if (Buffer.byteLength(encoded, 'utf8') > 256 * 1024) {
				throw new AcpFailure('limit_exceeded');
			}
			const next = writes.then(() => {
				if (failure !== null || closing || callbacks.signal.aborted) {
					throw failure ?? new AcpFailure('transport_closed');
				}
				return new Promise<void>((resolve, reject) => {
					channel.writable.write(encoded, (error: Error | null | undefined) =>
						error ? reject(new AcpFailure('transport_closed', { cause: error })) : resolve(),
					);
				});
			});
			writes = next;
			void next.catch(fail);
			return next;
		};

		const request = async (method: string, params: Record<string, unknown>): Promise<Record<string, unknown>> => {
			callbacks.signal.throwIfAborted();
			if (failure !== null) {
				throw failure;
			}
			const id = 'nexus:' + ++serial;
			const response = new Promise<Record<string, unknown>>((resolve, reject) =>
				pending.set(id, { method, resolve, reject }),
			);
			void response.catch(() => undefined);
			await write({ jsonrpc: '2.0', id, method, params });
			return response;
		};

		const handle = async (message: Record<string, unknown>): Promise<void> => {
			if (typeof message.method !== 'string') {
				if (message.method !== undefined) {
					throw new AcpFailure('protocol_invalid');
				}
				const id = messageId(message.id);
				const waiting = typeof id === 'string' ? pending.get(id) : undefined;
				const hasResult = 'result' in message;
				const hasError = 'error' in message;
				if (!waiting || hasResult === hasError) {
					throw new AcpFailure('protocol_invalid');
				}
				const result = 'result' in message ? record(message.result) : null;
				if (waiting.method === 'session/prompt') {
					promptActive = false;
					promptFinished = result !== null;
					lifetime.abort();
				}
				pending.delete(String(id));
				if ('error' in message) {
					waiting.reject(new AcpFailure('protocol_invalid'));
				} else {
					if (result === null) {
						throw new AcpFailure('protocol_invalid');
					}
					waiting.resolve(result);
				}
				return;
			}
			const params = record(message.params);
			if (message.id !== undefined) {
				const id = messageId(message.id);
				const key = JSON.stringify(id);
				if (seen.has(key) || seen.size >= 64) {
					throw new AcpFailure('limit_exceeded');
				}
				seen.add(key);
				if (message.method !== 'session/request_permission') {
					await write({
						jsonrpc: '2.0',
						id,
						error: { code: -32601, message: 'Direct capability unavailable' },
					});
					return;
				}
				if (sessionId === null || !promptActive) {
					throw new AcpFailure('protocol_invalid');
				}
				const decoded = permission(params, key, sessionId);
				const available = decoded.options.some((item) => item.kind === 'allow_once');
				if (!available) {
					await write({ jsonrpc: '2.0', id, result: { outcome: { outcome: 'cancelled' } } });
					return;
				}
				try {
					const grant = await callbacks.permission(decoded.input, lifetime.signal);
					callbacks.signal.throwIfAborted();
					if (!promptActive) {
						throw new AcpFailure('protocol_invalid');
					}
					const option = decoded.options.find((item) => item.kind === grant.decision);
					await write({
						jsonrpc: '2.0',
						id,
						result: {
							outcome: option ? { outcome: 'selected', optionId: option.id } : { outcome: 'cancelled' },
						},
					});
					await grant.delivered();
				} catch (cause) {
					throw cause instanceof AcpFailure ? cause : new AcpFailure('permission_failed', { cause });
				}
				return;
			}
			if (message.method === 'session/update') {
				if (sessionId === null || params.sessionId !== sessionId) {
					throw new AcpFailure('protocol_invalid');
				}
				const update = record(params.update);
				if (typeof update.sessionUpdate !== 'string') {
					throw new AcpFailure('protocol_invalid');
				}
				if (update.sessionUpdate === 'agent_message_chunk') {
					if (!promptActive) {
						throw new AcpFailure('protocol_invalid');
					}
					const content = record(update.content);
					if (content.type === 'text') {
						if (typeof content.text !== 'string') {
							throw new AcpFailure('protocol_invalid');
						}
						if (
							Buffer.byteLength(output, 'utf8') + Buffer.byteLength(content.text, 'utf8') >
							input.maxOutputBytes
						) {
							throw new AcpFailure('limit_exceeded');
						}
						output += content.text;
					}
				}
			}
		};

		const unsubscribe = channel.onStderr(() => undefined);

		const aborted = () => fail(new AcpFailure('transport_closed'));

		callbacks.signal.addEventListener('abort', aborted, { once: true });
		if (callbacks.signal.aborted) {
			aborted();
		}
		const reader = Promise.resolve().then(async () => {
			let buffered = Buffer.alloc(0);
			let total = 0;
			try {
				for await (const bytes of channel.readable) {
					callbacks.signal.throwIfAborted();
					if (!Buffer.isBuffer(bytes)) {
						throw new AcpFailure('protocol_invalid');
					}
					total += bytes.byteLength;
					if (total > 8 * 1024 * 1024) {
						throw new AcpFailure('limit_exceeded');
					}
					buffered = Buffer.concat([buffered, bytes]);
					let end: number;
					while ((end = buffered.indexOf(10)) !== -1) {
						if (end > 256 * 1024 || handlers.size >= 16) {
							throw new AcpFailure('limit_exceeded');
						}
						const value: unknown = JSON.parse(
							new TextDecoder('utf-8', { fatal: true }).decode(buffered.subarray(0, end)),
						);
						buffered = buffered.subarray(end + 1);
						if (failure !== null) {
							throw failure;
						}
						const message = record(value);
						if (message.jsonrpc !== '2.0') {
							throw new AcpFailure('protocol_invalid');
						}
						if (message.method === 'session/request_permission' && message.id !== undefined) {
							const task = handle(message);
							handlers.add(task);
							void task.catch(fail).finally(() => handlers.delete(task));
						} else {
							await handle(message);
						}
					}
					if (buffered.byteLength > 256 * 1024) {
						throw new AcpFailure('limit_exceeded');
					}
				}
				if (!closing && (!promptFinished || buffered.byteLength !== 0)) {
					throw new AcpFailure('transport_closed');
				}
			} catch (cause) {
				if (!closing) {
					fail(cause instanceof AcpFailure ? cause : new AcpFailure('protocol_invalid', { cause }));
				}
			}
		});
		try {
			const initialized = await request('initialize', {
				protocolVersion: 1,
				clientCapabilities: {},
				clientInfo: { name: input.clientName, version: input.clientVersion },
			});
			if (initialized.protocolVersion !== 1) {
				throw new AcpFailure('protocol_invalid');
			}
			const created = await request('session/new', { cwd: input.cwd, mcpServers: [] });
			sessionId = text(created.sessionId, 512);
			promptActive = true;
			const result = await request('session/prompt', {
				sessionId,
				prompt: [{ type: 'text', text: input.prompt }],
			});
			await Promise.all(handlers);
			if (failure !== null || callbacks.signal.aborted) {
				throw failure ?? new AcpFailure('transport_closed');
			}
			return { text: output, stopReason: stopReason(result.stopReason) };
		} finally {
			closing = true;
			callbacks.signal.removeEventListener('abort', aborted);
			unsubscribe();
			fail(failure ?? new AcpFailure('transport_closed'));
			await Promise.allSettled([reader, writes, ...handlers]);
		}
	}
}
