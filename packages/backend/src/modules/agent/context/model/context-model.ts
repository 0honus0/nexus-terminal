import { agentStorage } from '../../agent-storage-failure.js';
import type { ThreadEntryCursor, ThreadEntries, ThreadEntryHistory } from './context-types.js';
import type { ContextStorage } from '../storage/context-storage.js';

export class ContextModel {
	constructor(private readonly storage: ContextStorage) {}

	async previousEntries(
		userId: number,
		appId: string,
		threadId: string,
		before: ThreadEntryCursor | null,
		limit: number,
	): Promise<ThreadEntryHistory | null> {
		const value = await agentStorage(() =>
			this.storage.readPreviousEntries(
				userId,
				appId,
				threadId,
				before === null
					? null
					: {
							runSequence: before.runSequence,
							messageOrdinal: before.messageOrdinal,
							chunkIndex: before.chunkIndex,
							textOffset: before.textOffset,
						},
				limit,
			),
		);
		return value === null
			? null
			: {
					startCursor: {
						runSequence: value.startCursor.runSequence,
						messageOrdinal: value.startCursor.messageOrdinal,
						chunkIndex: value.startCursor.chunkIndex,
						textOffset: value.startCursor.textOffset,
					},
					hasEarlier: value.hasEarlier,
					body: {
						appId: value.body.appId,
						threadId: value.body.threadId,
						items: value.body.items.map((item) => ({
							runId: item.runId,
							operationSequence: item.operationSequence,
							role: item.role,
							text: item.text,
							position: {
								runSequence: item.position.runSequence,
								messageOrdinal: item.position.messageOrdinal,
								chunkIndex: item.position.chunkIndex,
								textOffset: item.position.textOffset,
							},
						})),
						nextCursor: {
							runSequence: value.body.nextCursor.runSequence,
							messageOrdinal: value.body.nextCursor.messageOrdinal,
							chunkIndex: value.body.nextCursor.chunkIndex,
							textOffset: value.body.nextCursor.textOffset,
						},
					},
				};
	}

	async entries(
		userId: number,
		appId: string,
		threadId: string,
		after: ThreadEntryCursor,
		limit: number,
	): Promise<ThreadEntries | null> {
		const value = await agentStorage(() =>
			this.storage.readEntries(
				userId,
				appId,
				threadId,
				{
					runSequence: after.runSequence,
					messageOrdinal: after.messageOrdinal,
					chunkIndex: after.chunkIndex,
					textOffset: after.textOffset,
				},
				limit,
			),
		);
		return value === null
			? null
			: {
					appId: value.appId,
					threadId: value.threadId,
					items: value.items.map((item) => ({
						runId: item.runId,
						operationSequence: item.operationSequence,
						role: item.role,
						text: item.text,
						position: {
							runSequence: item.position.runSequence,
							messageOrdinal: item.position.messageOrdinal,
							chunkIndex: item.position.chunkIndex,
							textOffset: item.position.textOffset,
						},
					})),
					nextCursor: {
						runSequence: value.nextCursor.runSequence,
						messageOrdinal: value.nextCursor.messageOrdinal,
						chunkIndex: value.nextCursor.chunkIndex,
						textOffset: value.nextCursor.textOffset,
					},
				};
	}
}
