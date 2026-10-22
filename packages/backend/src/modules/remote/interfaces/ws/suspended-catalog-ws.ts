import { ACCESS_SESSION_COOKIE_NAME } from '@nexus-terminal/shared/access/values';
import {
	SUSPENDED_STREAM_MAX_JSON_BYTES,
	readSuspendedCatalogEvent,
} from '@nexus-terminal/shared/remote/suspend/events';
import type { HttpWebSocketRoute } from '../../../../platform/http/http-types.js';
import { readRequestCookie } from '../../../../platform/http/http-request.js';
import type { AccessPublicApi } from '../../../access/public.js';
import type { WorkspaceService } from '../../sessions/service/workspace-service.js';
import { suspendSessionView } from '../suspend-view.js';

export function createSuspendedCatalogWebSocketRoute(
	access: AccessPublicApi,
	workspaces: WorkspaceService,
): HttpWebSocketRoute {
	return {
		path: '/ws/suspended-sessions',
		maxBufferedTextBytes: SUSPENDED_STREAM_MAX_JSON_BYTES,

		async authorize(request, url) {
			if (url.searchParams.size) {
				return false;
			}
			const token = readRequestCookie(request, ACCESS_SESSION_COOKIE_NAME);
			return token !== null && (await access.authenticate(token))?.userId === 1;
		},

		connected(channel, request) {
			const token = readRequestCookie(request, ACCESS_SESSION_COOKIE_NAME);
			let closed = false;
			let dirty = false;
			let scheduled = false;
			let revision = 0;
			let task = Promise.resolve();
			let verification: Promise<void> | null = null;
			let lastHeartbeat = Date.now();

			const stop = () => {
				closed = true;
				dirty = false;
				unsubscribe();
				clearInterval(timer);
			};

			const reject = (code = 1011) => {
				stop();
				channel.close(code, 'Suspended catalog unavailable');
			};

			const schedule = () => {
				if (closed || scheduled) {
					return;
				}
				scheduled = true;
				task = task
					.then(async () => {
						while (!closed && dirty) {
							dirty = false;
							const current = revision;
							const sessions = await workspaces.listSuspended(token);
							if (closed || !(await workspaces.mayReceiveSuspendedEvent(token, 1))) {
								reject(1008);
								return;
							}
							if (closed || current !== revision) {
								continue;
							}
							const event = readSuspendedCatalogEvent({
								type: 'snapshot',
								revision: current,
								sessions: sessions.map(suspendSessionView),
							});
							if (!channel.send(JSON.stringify(event))) {
								reject();
							}
						}
					})
					.catch(() => reject())
					.finally(() => {
						scheduled = false;
						if (dirty && !closed) {
							schedule();
						}
					});
			};

			const changed = () => {
				if (closed) {
					return;
				}
				if (revision >= Number.MAX_SAFE_INTEGER) {
					reject();
					return;
				}
				revision += 1;
				dirty = true;
				schedule();
			};

			const unsubscribe = workspaces.onSuspendedCatalogChanged((userId) => {
				if (userId === 1) {
					changed();
				}
			});
			const timer = setInterval(() => {
				if (closed || verification) {
					return;
				}
				verification = workspaces
					.mayReceiveSuspendedEvent(token, 1)
					.then((allowed) => {
						if (closed) {
							return;
						}
						if (!allowed) {
							reject(1008);
						} else if (Date.now() - lastHeartbeat >= 15_000) {
							lastHeartbeat = Date.now();
							if (!channel.send(JSON.stringify({ type: 'heartbeat' }))) {
								reject();
							}
						}
					})
					.catch(() => reject())
					.finally(() => {
						verification = null;
					});
			}, 3_000);
			timer.unref();
			channel.onMessage(async () => {
				reject(1008);
			});
			channel.onClose(async () => {
				stop();
				await Promise.all([task, verification]);
			});
			changed();
		},
	};
}
