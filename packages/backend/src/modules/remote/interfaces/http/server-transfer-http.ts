import { readRequestCookie } from '../../../../platform/http/http-request.js';
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
import type { HttpRoute, HttpRequest, HttpReply } from '../../../../platform/http/http-types.js';
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

async function handle(
	request: HttpRequest,
	reply: HttpReply,
	owner: ServerTransferService,
	action: Action,
): Promise<void> {
	const controller = new AbortController();

	const disconnected = () => controller.abort();

	reply.raw.once('close', disconnected);
	try {
		if (
			[...request.query.keys()].some((key) => action !== 'list' || key !== 'after') ||
			request.query.getAll('after').length > 1
		) {
			throw new InvalidServerTransferPayload();
		}
		const token = readRequestCookie(request.raw, ACCESS_SESSION_COOKIE_NAME);
		if (action === 'send') {
			const task = await owner.send(
				token,
				async () => {
					const input = readServerTransferInput(request.body);
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
			reply.code(202).send(toSnapshot(task));
		} else if (action === 'list') {
			const after = request.query.get('after');
			const page = await owner.list(token, after === null ? null : readServerTransferId(after));
			reply.code(200).send({
				items: page.items.map(toSnapshot),
				nextCursor: page.nextCursor,
			} satisfies ServerTransferPage);
		} else {
			const id = readServerTransferId(request.params.taskId);
			if (action === 'details') {
				reply.code(200).send(toSnapshot(await owner.details(token, id)));
			} else if (action === 'cancel') {
				await owner.cancel(token, id);
				reply.code(200).send({ taskId: id, accepted: true } satisfies ServerTransferCancellation);
			} else {
				await owner.remove(token, id);
				reply.code(204).send();
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
		reply.code(serverTransferErrorStatus(code)).send({ code } satisfies ServerTransferHttpError);
	} finally {
		reply.raw.off('close', disconnected);
	}
}

export function createServerTransferRoutes(owner: ServerTransferService): HttpRoute[] {
	return [
		{
			method: 'POST',
			url: '/api/v1/transfers/send',
			bodyLimit: SERVER_TRANSFER_REQUEST_MAX_BYTES,

			handler: (request, reply) => handle(request, reply, owner, 'send'),
		},
		{
			method: 'GET',
			url: '/api/v1/transfers/status',

			handler: (request, reply) => handle(request, reply, owner, 'list'),
		},
		{
			method: 'GET',
			url: '/api/v1/transfers/status/:taskId',

			handler: (request, reply) => handle(request, reply, owner, 'details'),
		},
		{
			method: 'POST',
			url: '/api/v1/transfers/cancel/:taskId',

			handler: (request, reply) => handle(request, reply, owner, 'cancel'),
		},
		{
			method: 'DELETE',
			url: '/api/v1/transfers/:taskId',

			handler: (request, reply) => handle(request, reply, owner, 'remove'),
		},
	];
}
