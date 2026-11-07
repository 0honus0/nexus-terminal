import { randomUUID } from 'node:crypto';
import { AGENT_RUN_STREAM_MAX_COMMAND_BYTES } from '@nexus-terminal/shared/agent/runs/values';
import type { ThreadService } from '../../scope/service/thread-service.js';
import type { PluginService } from '../../plugins/service/plugin-service.js';
import type { MemoryChanges } from '../../memory/service/memory-changes.js';
import { defineAgentStreamSource } from './agent-stream-sources.js';
import type { AgentStreamSourceRegistration } from './agent-stream-sources.js';
import { createStreamAccess } from './stream-access.js';

/** Runtime invalidation: every new subscription/epoch asks its consumer to reread the current list. */
export function createMemoryStreamSource(
	changes: MemoryChanges,
	threads: ThreadService,
	plugins: Pick<PluginService, 'frontendAccess' | 'watchFrontendGrant'>,
	boundary: <T>(work: () => Promise<T>) => Promise<T>,
): AgentStreamSourceRegistration {
	const epoch = randomUUID();
	return defineAgentStreamSource(
		'memory',
		(source) => source.kind === 'memory',
		async (source, context) => {
			const observed = await createStreamAccess(plugins, context, source.appId, source.access);
			const actor = observed.actor;
			const unsubscribe = changes.subscribe(
				source.threadId === null
					? { userId: actor.userId, appId: actor.appId }
					: { userId: actor.userId, appId: actor.appId, threadId: source.threadId },
				context.changed,
				context.stopped,
			);
			try {
				await boundary(() =>
					threads.withAdmission(actor, async () => {
						actor.assertCurrent();
					}),
				);
				actor.assertCurrent();
			} catch (cause) {
				unsubscribe();
				observed.close();
				throw cause;
			}
			return {
				expiresAt: actor.kind === 'plugin' ? actor.expiresAt : null,
				nextPageBytes: AGENT_RUN_STREAM_MAX_COMMAND_BYTES,

				requiresDrain: () => false,

				close() {
					unsubscribe();
					observed.close();
				},

				assertCurrent: actor.assertCurrent,

				check: () =>
					boundary(() =>
						threads.withState(actor, async () => {
							actor.assertCurrent();
						}),
					),

				read: (revision) =>
					boundary(() =>
						threads.withState(actor, async () => {
							actor.assertCurrent();
							return { value: { type: 'memory-invalidated', epoch, revision }, more: false };
						}),
					),
			};
		},
	);
}
