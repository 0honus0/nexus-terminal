import { AGENT_RUN_EVENT_MAX_LIMIT } from '@nexus-terminal/shared/agent/runs/values';
import { AGENT_THREAD_ENTRIES_MAX_RESPONSE_BYTES } from '@nexus-terminal/shared/agent/scope/values';
import { AGENT_MAX_RESPONSE_BYTES } from '@nexus-terminal/shared/agent/values';
import type { ThreadService } from '../../scope/service/thread-service.js';
import type { RunService } from '../../runs/service/run-service.js';
import type { RunChanges } from '../../runs/model/run-changes.js';
import type { RunStreamService } from '../../runs/service/run-stream-service.js';
import type { PluginService } from '../../plugins/service/plugin-service.js';
import { AgentFailure } from '../../agent-failure.js';
import { fromRunStreamCursor, toRunStreamEvent } from './run-stream-mapper.js';
import { toRunEvents } from '../http/workspace-mapper.js';
import { defineAgentStreamSource } from './agent-stream-sources.js';
import type { AgentStreamSourceRegistration } from './agent-stream-sources.js';
import { createStreamAccess } from './stream-access.js';

export function createRunStreamSources(
	threads: ThreadService,
	runs: RunService,
	changes: RunChanges,
	stream: RunStreamService,
	plugins: Pick<PluginService, 'frontendAccess' | 'watchFrontendGrant'>,
	boundary: <T>(work: () => Promise<T>) => Promise<T>,
): AgentStreamSourceRegistration[] {
	return [
		defineAgentStreamSource(
			'run',
			(source) => source.kind === 'run',
			async (source, context) => {
				const observed = await createStreamAccess(plugins, context, source.appId, source.access);
				const actor = observed.actor;
				let cursor = fromRunStreamCursor(source.cursor);
				let stateDirty = true;
				let approvalRescan = false;
				const watchedRuns = new Set([source.runId]);
				const unsubscribe = changes.subscribe(
					actor,
					(kind) => {
						if (kind === 'state') {
							stateDirty = true;
							approvalRescan = true;
						}
						context.changed();
					},
					context.stopped,
					(change) =>
						(change.runId !== undefined && watchedRuns.has(change.runId)) ||
						(change.threadId !== undefined && change.threadId === cursor.threadId),
				);
				try {
					await boundary(() =>
						threads.withAdmission(actor, async () => {
							const run = await runs.get(actor.userId, actor.appId, source.runId);
							actor.assertCurrent();
							if (!run || run.threadId !== cursor.threadId) {
								throw new AgentFailure('not_found');
							}
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
					nextPageBytes: AGENT_THREAD_ENTRIES_MAX_RESPONSE_BYTES + 1024,

					requiresDrain: () => stateDirty,

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
								const previous = cursor;
								const includeState = stateDirty;
								if (includeState && cursor.approvals === null) {
									approvalRescan = false;
								}
								stateDirty = false;
								const page = await stream.read(
									actor.userId,
									actor.appId,
									source.runId,
									previous,
									includeState,
								);
								actor.assertCurrent();
								if (page.state) {
									watchedRuns.clear();
									watchedRuns.add(source.runId);
									for (const child of page.state.children) {
										watchedRuns.add(child.id);
									}
								}
								const repeat = page.state !== null && !page.state.approvals.hasMore && approvalRescan;
								page.more = page.more || stateDirty || repeat;
								cursor = {
									threadId: previous.threadId,
									entries: {
										runSequence: page.body.nextCursor.runSequence,
										messageOrdinal: page.body.nextCursor.messageOrdinal,
										chunkIndex: page.body.nextCursor.chunkIndex,
										textOffset: page.body.nextCursor.textOffset,
									},
									events: page.state?.events.nextCursor ?? previous.events,
									approvals: page.state
										? page.state.approvals.hasMore
											? page.state.approvals.nextCursor
											: null
										: previous.approvals,
								};
								stateDirty =
									stateDirty ||
									(page.state?.events.items.length ?? 0) > 0 ||
									(page.state?.approvals.hasMore ?? false) ||
									repeat;
								return {
									value: toRunStreamEvent(source.appId, source.runId, revision, page),
									more: page.more,
								};
							}),
						),
				};
			},
		),
		defineAgentStreamSource(
			'run-events',
			(source) => source.kind === 'run-events',
			async (source, context) => {
				const observed = await createStreamAccess(plugins, context, source.appId, {
					kind: 'plugin',
					grant: source.grant,
				});
				const actor = observed.actor;
				let after = source.after;
				const unsubscribe = changes.subscribe(
					actor,
					context.changed,
					context.stopped,
					(change) => change.runId === source.runId,
				);
				try {
					await boundary(() =>
						threads.withAdmission(actor, async () => {
							const run = await runs.get(actor.userId, actor.appId, source.runId);
							actor.assertCurrent();
							if (!run) {
								throw new AgentFailure('not_found');
							}
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
					nextPageBytes: AGENT_MAX_RESPONSE_BYTES + 1024,

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

					read: () =>
						boundary(() =>
							threads.withState(actor, async () => {
								const page = await runs.listEvents(
									actor.userId,
									actor.appId,
									source.runId,
									after,
									AGENT_RUN_EVENT_MAX_LIMIT,
								);
								actor.assertCurrent();
								if (!page) {
									throw new AgentFailure('not_found');
								}
								after = page.nextCursor;
								return { value: toRunEvents(page), more: page.items.length > 0 };
							}),
						),
				};
			},
		),
	];
}
