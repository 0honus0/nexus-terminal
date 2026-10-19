import { ACCESS_SESSION_COOKIE_NAME } from '@nexus-terminal/shared/access/values';
import {
	InvalidServerTransferPayload,
	readServerTransferInput,
	readServerTransferId,
} from '@nexus-terminal/shared/remote/transfers/server-codec';
import {
	SERVER_TRANSFER_REQUEST_MAX_BYTES,
	serverTransferErrorStatus,
} from '@nexus-terminal/shared/remote/transfers/server-values';
import type { ServerTransferSnapshot } from '@nexus-terminal/shared/remote/transfers/server-model';
import type {
	ServerTransferPage,
	ServerTransferCancellation,
	ServerTransferHttpError,
} from '@nexus-terminal/shared/remote/transfers/server-http';
import type { HttpRoute, HttpRouteContext } from '../../../../platform/http/http-types.js';
import { HttpInputFailure } from '../../../../platform/http/http-errors.js';
import { ServerTransferFailure } from '../../transfers/model/server-transfer-types.js';
import type { ServerTransferTask } from '../../transfers/model/server-transfer-types.js';
import type { ServerTransferService } from '../../transfers/service/server-transfer-service.js';

function toSnapshot(task: ServerTransferTask): ServerTransferSnapshot {
	return {
		taskId: task.taskId,
		status: task.status,
		createdAt: task.createdAt,
		updatedAt: task.updatedAt,
		overallProgress: task.overallProgress,
		payload: {
			sourceConnectionId: task.payload.sourceConnectionId,
			connectionIds: task.payload.connectionIds.map((id) => id),
			sourceItems: task.payload.sourceItems.map((item) => ({
				name: item.name,
				path: item.path,
				type: item.type,
			})),
			remoteTargetPath: task.payload.remoteTargetPath,
			transferMethod: task.payload.transferMethod,
		},
		subTasks: task.subTasks.map((item) => ({
			subTaskId: item.subTaskId,
			connectionId: item.connectionId,
			sourceItemIndex: item.sourceItemIndex,
			status: item.status,
			progress: item.progress,
			error: item.error,
			transferMethodUsed: item.transferMethodUsed,
		})),
	};
}

type Action = 'send' | 'list' | 'details' | 'cancel' | 'remove';

async function handle(ctx: HttpRouteContext, owner: ServerTransferService, action: Action): Promise<void> {
	const controller = new AbortController();

	const disconnected = () => controller.abort();

	ctx.response.once('close', disconnected);
	try {
		if (
			[...ctx.query.keys()].some((key) => action !== 'list' || key !== 'after') ||
			ctx.query.getAll('after').length > 1
		) {
			throw new InvalidServerTransferPayload();
		}
		const token = ctx.cookie(ACCESS_SESSION_COOKIE_NAME);
		if (action === 'send') {
			const task = await owner.send(
				token,
				async () => {
					const input = readServerTransferInput(await ctx.json(controller.signal));
					return {
						sourceConnectionId: input.sourceConnectionId,
						connectionIds: input.connectionIds.map((id) => id),
						sourceItems: input.sourceItems.map((item) => ({
							name: item.name,
							path: item.path,
							type: item.type,
						})),
						remoteTargetPath: input.remoteTargetPath,
						transferMethod: input.transferMethod,
					};
				},
				controller.signal,
			);
			ctx.send(202, toSnapshot(task));
		} else if (action === 'list') {
			const after = ctx.query.get('after');
			const page = await owner.list(token, after === null ? null : readServerTransferId(after));
			ctx.send(200, {
				items: page.items.map(toSnapshot),
				nextCursor: page.nextCursor,
			} satisfies ServerTransferPage);
		} else {
			const id = readServerTransferId(ctx.params.taskId);
			if (action === 'details') {
				ctx.send(200, toSnapshot(await owner.details(token, id)));
			} else if (action === 'cancel') {
				await owner.cancel(token, id);
				ctx.send(200, { taskId: id, accepted: true } satisfies ServerTransferCancellation);
			} else {
				await owner.remove(token, id);
				ctx.response.writeHead(204);
				ctx.response.end();
			}
		}
	} catch (error) {
		if (error instanceof HttpInputFailure) {
			throw error;
		}
		const code =
			error instanceof InvalidServerTransferPayload
				? 'invalid_input'
				: error instanceof ServerTransferFailure
					? error.code
					: 'internal_failure';
		ctx.send(serverTransferErrorStatus(code), { code } satisfies ServerTransferHttpError);
	} finally {
		ctx.response.off('close', disconnected);
	}
}

export function createServerTransferRoutes(owner: ServerTransferService): HttpRoute[] {
	return [
		{
			method: 'POST',
			path: '/api/v1/transfers/send',
			maxBodyBytes: SERVER_TRANSFER_REQUEST_MAX_BYTES,

			handle: (ctx) => handle(ctx, owner, 'send'),
		},
		{
			method: 'GET',
			path: '/api/v1/transfers/status',

			handle: (ctx) => handle(ctx, owner, 'list'),
		},
		{
			method: 'GET',
			path: '/api/v1/transfers/status/:taskId',

			handle: (ctx) => handle(ctx, owner, 'details'),
		},
		{
			method: 'POST',
			path: '/api/v1/transfers/cancel/:taskId',

			handle: (ctx) => handle(ctx, owner, 'cancel'),
		},
		{
			method: 'DELETE',
			path: '/api/v1/transfers/:taskId',

			handle: (ctx) => handle(ctx, owner, 'remove'),
		},
	];
}
