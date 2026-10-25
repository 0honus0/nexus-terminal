import { AGENT_THREAD_ENTRIES_MAX_RESPONSE_BYTES } from '@nexus-terminal/shared/agent/scope/values';
import {
	AGENT_RUN_STREAM_MAX_IN_FLIGHT_PAGES,
	AGENT_RUN_STREAM_MAX_COMMAND_BYTES,
	AGENT_RUN_STREAM_MAX_JSON_BYTES,
} from '@nexus-terminal/shared/agent/runs/values';
import { ACCESS_SESSION_COOKIE_NAME } from '@nexus-terminal/shared/access/values';
import { readAgentRunSubscription, readAgentRunStreamCommand } from '@nexus-terminal/shared/agent/runs/events';
import type { HttpWebSocketRoute } from '../../../../platform/http/http-types.js';
import { readRequestCookie } from '../../../../platform/http/http-request.js';
import type { AccessPublicApi } from '../../../access/public.js';
import type { ThreadService } from '../../scope/service/thread-service.js';
import type { SessionThreadAccess } from '../../scope/model/thread-types.js';
import type { RunService } from '../../runs/service/run-service.js';
import type { RunChanges } from '../../runs/model/run-changes.js';
import { AgentFailure } from '../../agent-failure.js';
import { AgentOperationError } from '../../public-errors.js';
import { encodeAgentJson } from '@nexus-terminal/shared/agent/http-codec';
import type { RunStreamService } from '../../runs/service/run-stream-service.js';
import type { RunStreamCursor, RunChangeKind } from '../../runs/model/run-stream-types.js';
import { fromRunStreamCursor, toRunStreamEvent } from './run-stream-mapper.js';

export function createRunChangesWebSocketRoute(
	access: AccessPublicApi,
	threads: ThreadService,
	runs: RunService,
	changes: RunChanges,
	stream: RunStreamService,
	boundary: <T>(work: () => Promise<T>) => Promise<T>,
): HttpWebSocketRoute {
	return {
		path: '/ws/agent-runs',
		maxBufferedTextBytes: AGENT_RUN_STREAM_MAX_JSON_BYTES + 1024,
		maxTextMessageBytes: AGENT_RUN_STREAM_MAX_COMMAND_BYTES,

		async authorize(request, url) {
			try {
				const selected = readAgentRunSubscription(url.searchParams);
				const token = readRequestCookie(request, ACCESS_SESSION_COOKIE_NAME);
				const identity = await access.authenticate(token);
				if (!token || identity?.userId !== 1) {
					return false;
				}
				return await boundary(() =>
					threads.withAdmission(
						{
							kind: 'session',
							userId: identity.userId,
							appId: selected.appId,
							appVersion: selected.appVersion,
							token,

							assertCurrent: () => {
								if (request.destroyed) {
									throw new AgentFailure('unauthenticated');
								}
							},
						},
						async () => (await runs.get(identity.userId, selected.appId, selected.runId)) !== null,
					),
				);
			} catch {
				return false;
			}
		},

		connected(channel, request, url) {
			const selected = readAgentRunSubscription(url.searchParams);
			const token = readRequestCookie(request, ACCESS_SESSION_COOKIE_NAME);
			if (!token) {
				channel.close(1008);
				return;
			}
			let closed = false;
			let dirty = true;
			let stateDirty = true;
			let revision = 0;
			let cursor: RunStreamCursor | null = null;
			const pending: Array<{ revision: number; bytes: number; expiresAt: number }> = [];
			let pendingBytes = 0;
			let flushing = false;
			let timer: ReturnType<typeof setTimeout> | undefined;
			let heartbeat: ReturnType<typeof setInterval> | undefined;

			let unsubscribe = () => {};

			let task = Promise.resolve();
			const startedAt = Date.now();
			let lastHeartbeat = startedAt;
			const actor: SessionThreadAccess = {
				kind: 'session',
				userId: 1,
				appId: selected.appId,
				appVersion: selected.appVersion,
				token,

				assertCurrent: () => {
					if (closed) {
						throw new AgentFailure('unauthenticated');
					}
				},
			};

			const stop = () => {
				closed = true;
				dirty = false;
				pending.length = 0;
				pendingBytes = 0;
				clearTimeout(timer);
				clearInterval(heartbeat);
				unsubscribe();
			};

			const reject = (code = 1011) => {
				stop();
				channel.close(code, 'Agent stream unavailable');
			};

			const canSendPage = () => {
				if (!cursor || pending.length >= AGENT_RUN_STREAM_MAX_IN_FLIGHT_PAGES) {
					return false;
				}
				// State can contain a large approvals snapshot: send it only after prior pages drain.
				return stateDirty
					? pending.length === 0
					: pendingBytes + AGENT_THREAD_ENTRIES_MAX_RESPONSE_BYTES + 1024 <= AGENT_RUN_STREAM_MAX_JSON_BYTES;
			};

			const flush = () => {
				if (closed || flushing) {
					return;
				}
				if (
					(cursor === null && Date.now() - startedAt > 15_000) ||
					(pending[0] && Date.now() > pending[0].expiresAt)
				) {
					reject();
					return;
				}
				clearTimeout(timer);
				timer = undefined;
				flushing = true;
				const current = dirty && canSendPage() ? cursor : null;
				const includeState = stateDirty;
				if (current) {
					dirty = false;
					stateDirty = false;
				}
				task = boundary(() =>
					threads.withAdmission(actor, async () => {
						return current
							? stream.read(actor.userId, actor.appId, selected.runId, current, includeState)
							: null;
					}),
				)
					.then((page) => {
						if (closed) {
							return;
						}
						if (page && current) {
							if (revision >= Number.MAX_SAFE_INTEGER) {
								reject();
								return;
							}
							revision += 1;
							const encoded = encodeAgentJson(
								toRunStreamEvent(actor.appId, selected.runId, revision, page),
								AGENT_RUN_STREAM_MAX_JSON_BYTES,
							);
							const bytes = Buffer.byteLength(encoded);
							pending.push({ revision, bytes, expiresAt: Date.now() + 60_000 });
							pendingBytes += bytes;
							cursor = {
								threadId: current.threadId,
								entries: {
									runSequence: page.body.nextCursor.runSequence,
									stepIndex: page.body.nextCursor.stepIndex,
									eventSequence: page.body.nextCursor.eventSequence,
									textOffset: page.body.nextCursor.textOffset,
								},
								events: page.state?.events.nextCursor ?? current.events,
							};
							dirty = dirty || page.more;
							stateDirty = stateDirty || (page.state?.events.items.length ?? 0) > 0;
							if (!channel.send(encoded)) {
								reject();
							}
						} else if (Date.now() - lastHeartbeat >= 15_000) {
							lastHeartbeat = Date.now();
							if (!channel.send(JSON.stringify({ type: 'heartbeat' }))) {
								reject();
							}
						}
					})
					.catch((cause: unknown) => {
						const denied =
							cause instanceof AgentOperationError &&
							['unauthenticated', 'forbidden', 'app_disabled', 'version_conflict', 'not_found'].includes(
								cause.code,
							);
						reject(denied ? 1008 : 1011);
					})
					.finally(() => {
						flushing = false;
						if (dirty && !closed && canSendPage()) {
							schedule();
						}
					});
			};

			const schedule = () => {
				if (closed || !dirty || timer !== undefined || flushing || !canSendPage()) {
					return;
				}
				timer = setTimeout(() => {
					timer = undefined;
					flush();
				}, 16);
				timer.unref();
			};

			const changed = (kind: RunChangeKind) => {
				dirty = true;
				if (kind === 'state') {
					stateDirty = true;
				}
				schedule();
			};

			channel.onMessage(async (text) => {
				if (closed) {
					return;
				}
				try {
					if (Buffer.byteLength(text) > AGENT_RUN_STREAM_MAX_COMMAND_BYTES) {
						reject(1008);
						return;
					}
					const input: unknown = JSON.parse(text);
					const command = readAgentRunStreamCommand(input);
					if (command.type === 'subscribe') {
						if (cursor !== null) {
							reject(1008);
							return;
						}
						cursor = fromRunStreamCursor(command.cursor);
					} else {
						const oldest = pending[0];
						if (!oldest || command.revision !== oldest.revision) {
							reject(1008);
							return;
						}
						pending.shift();
						pendingBytes -= oldest.bytes;
					}
					schedule();
				} catch {
					reject(1008);
				}
			});
			channel.onClose(async () => {
				stop();
				await task;
			});
			unsubscribe = changes.subscribe(actor.userId, actor.appId, changed, () => reject(1001));
			if (closed) {
				return;
			}
			heartbeat = setInterval(flush, 3000);
			heartbeat.unref();
		},
	};
}
