import {
	AGENT_RUN_STREAM_MAX_IN_FLIGHT_PAGES,
	AGENT_RUN_STREAM_MAX_COMMAND_BYTES,
	AGENT_RUN_STREAM_MAX_JSON_BYTES,
} from '@nexus-terminal/shared/agent/runs/values';
import { ACCESS_SESSION_COOKIE_NAME } from '@nexus-terminal/shared/access/values';
import { readAgentRunStreamCommand } from '@nexus-terminal/shared/agent/runs/events';
import type { AgentStreamSource } from '@nexus-terminal/shared/agent/runs/events';
import { encodeAgentJson } from '@nexus-terminal/shared/agent/http-codec';
import type { HttpWebSocketRoute } from '../../../../platform/http/http-types.js';
import { readRequestCookie } from '../../../../platform/http/http-request.js';
import type { AccessPublicApi } from '../../../access/public.js';
import type { Logger } from '../../../../platform/logging/logger.js';
import { randomUUID } from 'node:crypto';
import { AgentFailure } from '../../agent-failure.js';
import { AgentOperationError } from '../../public-errors.js';
import type { AgentStreamSources, AgentStreamSourceReader } from './agent-stream-sources.js';

interface Subscription {
	generation: number;
	stop(): void;
	ack(revision: number): void;
	inspect(): void;
}

/** One authenticated page connection. Installed source owners retain admission, snapshots and durable cursors. */
export function createAgentStreamWebSocketRoute(
	access: AccessPublicApi,
	sources: AgentStreamSources,
	logger?: Logger,
): HttpWebSocketRoute {
	return {
		path: '/ws/agent-runs',
		maxBufferedTextBytes: AGENT_RUN_STREAM_MAX_JSON_BYTES + 1024,
		maxTextMessageBytes: AGENT_RUN_STREAM_MAX_COMMAND_BYTES,

		async authorize(request, url) {
			if (url.search.length !== 0) {
				return false;
			}
			const token = readRequestCookie(request, ACCESS_SESSION_COOKIE_NAME);
			try {
				return Boolean(token) && (await access.authenticate(token))?.userId === 1;
			} catch {
				return false;
			}
		},

		connected(channel, request) {
			const token = readRequestCookie(request, ACCESS_SESSION_COOKIE_NAME);
			if (!token) {
				channel.close(1008);
				return;
			}
			const connectionId = randomUUID();
			logger?.write('debug', 'AGENT_STREAM_OPENED', [{ name: 'connectionId', value: connectionId }]);
			let closed = false;
			const subscriptions = new Map<string, Subscription>();
			const tasks = new Set<Promise<void>>();
			const cleanupFailures: unknown[] = [];

			const track = (task: Promise<void>) => {
				tasks.add(task);
				void task.then(
					() => tasks.delete(task),
					() => tasks.delete(task),
				);
			};

			const send = (value: unknown): boolean => {
				if (closed) {
					return false;
				}
				try {
					if (channel.send(encodeAgentJson(value, AGENT_RUN_STREAM_MAX_JSON_BYTES))) {
						return true;
					}
				} catch {
					/* Encoding and transport failure both require durable-source recovery. */
				}
				channel.close(1011, 'Agent stream unavailable');
				return false;
			};

			const remove = (id: string, owner: Subscription) => {
				if (subscriptions.get(id) !== owner) {
					return;
				}
				subscriptions.delete(id);
				owner.stop();
			};

			const open = (id: string, generation: number, source: AgentStreamSource): Subscription => {
				logger?.write('debug', 'AGENT_STREAM_SUBSCRIPTION_OPENED', [
					{ name: 'connectionId', value: connectionId },
					{ name: 'subscriptionId', value: id },
					{ name: 'generation', value: generation },
					{ name: 'source', value: source.kind },
					{ name: 'appId', value: source.appId },
				]);
				let stopped = false;
				let dirty = true;
				let reading = false;
				let revision = 0;
				let pendingBytes = 0;
				let reader: AgentStreamSourceReader | null = null;
				let timer: ReturnType<typeof setTimeout> | undefined;
				let expiry: ReturnType<typeof setTimeout> | undefined;
				const pending: Array<{ revision: number; bytes: number; expiresAt: number }> = [];

				const current = () => {
					if (closed || stopped || subscriptions.get(id) !== owner) {
						throw new AgentFailure('unauthenticated');
					}
				};

				const fail = (code: 'forbidden' | 'resync_required' | 'unavailable') => {
					if (stopped || closed) {
						return;
					}
					logger?.write('warn', 'AGENT_STREAM_SUBSCRIPTION_REJECTED', [
						{ name: 'connectionId', value: connectionId },
						{ name: 'subscriptionId', value: id },
						{ name: 'generation', value: generation },
						{ name: 'code', value: code },
						{ name: 'revision', value: revision },
						{ name: 'pendingBytes', value: pendingBytes },
					]);
					send({ type: 'rejected', subscriptionId: id, generation, code });
					remove(id, owner);
				};

				const handleFailure = (cause: unknown) => {
					const code =
						cause instanceof AgentOperationError || cause instanceof AgentFailure ? cause.code : null;
					fail(
						code !== null &&
							['unauthenticated', 'forbidden', 'app_disabled', 'version_conflict'].includes(code)
							? 'forbidden'
							: code === 'not_found' || code === 'invalid_input'
								? 'resync_required'
								: 'unavailable',
					);
				};

				const canRead = () =>
					reader !== null &&
					dirty &&
					pending.length < AGENT_RUN_STREAM_MAX_IN_FLIGHT_PAGES &&
					(reader.requiresDrain()
						? pending.length === 0
						: pendingBytes + reader.nextPageBytes <= AGENT_RUN_STREAM_MAX_JSON_BYTES);

				const schedule = () => {
					if (stopped || closed || reading || timer !== undefined || !canRead()) {
						return;
					}
					timer = setTimeout(() => {
						timer = undefined;
						read();
					}, 16);
					timer.unref();
				};

				const read = () => {
					if (stopped || closed || reading || !canRead() || !reader) {
						return;
					}
					reading = true;
					dirty = false;
					if (revision >= Number.MAX_SAFE_INTEGER) {
						fail('unavailable');
						return;
					}
					const selectedReader = reader;
					const task = Promise.resolve()
						.then(() => selectedReader.read(revision + 1))
						.then((page) => {
							if (stopped || closed) {
								return;
							}
							current();
							selectedReader.assertCurrent();
							revision++;
							const frame = { type: 'data', subscriptionId: id, generation, revision, value: page.value };
							const bytes = Buffer.byteLength(encodeAgentJson(frame, AGENT_RUN_STREAM_MAX_JSON_BYTES));
							if (pendingBytes + bytes > AGENT_RUN_STREAM_MAX_JSON_BYTES) {
								fail('unavailable');
								return;
							}
							pending.push({ revision, bytes, expiresAt: Date.now() + 60_000 });
							pendingBytes += bytes;
							dirty = dirty || page.more;
							send(frame);
						})
						.catch(handleFailure)
						.finally(() => {
							reading = false;
							schedule();
						});
					track(task);
				};

				const owner: Subscription = {
					generation,

					stop() {
						if (stopped) {
							return;
						}
						logger?.write('debug', 'AGENT_STREAM_SUBSCRIPTION_CLOSED', [
							{ name: 'connectionId', value: connectionId },
							{ name: 'subscriptionId', value: id },
							{ name: 'generation', value: generation },
							{ name: 'revision', value: revision },
							{ name: 'pendingBytes', value: pendingBytes },
						]);
						stopped = true;
						clearTimeout(timer);
						clearTimeout(expiry);
						const selectedReader = reader;
						reader = null;
						try {
							selectedReader?.close();
						} catch (cause) {
							cleanupFailures.push(cause);
						}
						pending.length = 0;
						pendingBytes = 0;
					},

					ack(value) {
						const item = pending[0];
						if (!item || item.revision !== value) {
							fail('unavailable');
							return;
						}
						pending.shift();
						pendingBytes -= item.bytes;
						schedule();
					},

					inspect() {
						if (stopped || !reader) {
							return;
						}
						if (pending[0] && Date.now() > pending[0].expiresAt) {
							fail('unavailable');
							return;
						}
						if (reading) {
							return;
						}
						// Retain the safety audit until every legal authorization writer has notifications.
						reading = true;
						const selectedReader = reader;
						track(
							Promise.resolve()
								.then(() => selectedReader.check())
								.catch(handleFailure)
								.finally(() => {
									reading = false;
									schedule();
								}),
						);
					},
				};
				// Registration by the caller precedes initialization, including listener setup and the first snapshot.
				track(
					Promise.resolve()
						.then(async () => {
							const opened = await sources.open(source, {
								identity: { userId: 1, token },
								assertCurrent: current,

								changed() {
									dirty = true;
									schedule();
								},

								stopped() {
									fail('unavailable');
								},

								revoked() {
									fail('forbidden');
								},
							});
							if (stopped || closed) {
								opened.close();
								return;
							}
							current();
							reader = opened;
							if (reader.expiresAt !== null) {
								const checkExpiry = () => {
									if (!reader || stopped || closed || reader.expiresAt === null) {
										return;
									}
									const remaining = reader.expiresAt - Date.now();
									if (remaining <= 0) {
										fail('forbidden');
									} else {
										expiry = setTimeout(checkExpiry, Math.min(2147483647, remaining));
										expiry.unref();
									}
								};

								checkExpiry();
							}
							schedule();
						})
						.catch(handleFailure),
				);
				return owner;
			};

			channel.onMessage((text) => {
				if (closed) {
					return;
				}
				try {
					const input: unknown = JSON.parse(text);
					const command = readAgentRunStreamCommand(input);
					const previous = subscriptions.get(command.subscriptionId);
					if (command.type === 'subscribe') {
						if (previous && command.generation <= previous.generation) {
							channel.close(1008);
							return;
						}
						previous?.stop();
						subscriptions.set(
							command.subscriptionId,
							open(command.subscriptionId, command.generation, command.source),
						);
					} else if (previous?.generation === command.generation) {
						if (command.type === 'ack') {
							previous.ack(command.revision);
						} else {
							remove(command.subscriptionId, previous);
						}
					}
					// Late ACK/unsubscribe cannot release another generation's credit.
				} catch {
					channel.close(1008, 'Invalid Agent stream command');
				}
			});
			const heartbeat = setInterval(() => send({ type: 'heartbeat' }), 15_000);
			heartbeat.unref();
			const inspection = setInterval(() => {
				for (const owner of subscriptions.values()) {
					owner.inspect();
				}
			}, 3000);
			inspection.unref();
			channel.onClose(async () => {
				closed = true;
				logger?.write('debug', 'AGENT_STREAM_CLOSED', [{ name: 'connectionId', value: connectionId }]);
				clearInterval(heartbeat);
				clearInterval(inspection);
				for (const owner of subscriptions.values()) {
					owner.stop();
				}
				subscriptions.clear();
				await Promise.allSettled([...tasks]);
				if (cleanupFailures.length > 0) {
					throw new AggregateError(cleanupFailures, 'Agent stream source cleanup failed');
				}
			});
		},
	};
}
