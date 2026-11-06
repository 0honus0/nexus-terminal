import { readRequestCookie } from '../../../../platform/http/http-request.js';
import type { HttpRoute, HttpRequest, HttpReply } from '../../../../platform/http/http-types.js';
import { HttpInputFailure } from '../../../../platform/http/http-errors.js';
import type { AccessPublicApi } from '../../../access/public.js';
import { AccessOperationError } from '../../../access/public-errors.js';
import { ACCESS_SESSION_COOKIE_NAME } from '@nexus-terminal/shared/access/values';
import {
	COMMAND_REQUEST_MAX_BYTES,
	COMMAND_RESPONSE_MAX_BYTES,
	type CommandErrorCode,
} from '@nexus-terminal/shared/preferences/commands/values';
import {
	InvalidCommandPayload,
	readCommandCreate,
	readCommandUpdate,
	readCommandVersion,
	readCommandTagCreate,
	readCommandTagUpdate,
	readCommandAssign,
	readCommandGroupDelete,
	readCommandUntaggedGroupDelete,
	readCommandId,
	readCommandQuery,
} from '@nexus-terminal/shared/preferences/commands/http-codec';
import type { QuickCommand, QuickCommandTag } from '@nexus-terminal/shared/preferences/commands/model';
import type {
	QuickCommandCreateRequest,
	CommandListResponse,
	CommandTagListResponse,
	CommandMutationResponse,
	CommandTagMutationResponse,
	CommandDeleteResponse,
	CommandAssignTagResponse,
} from '@nexus-terminal/shared/preferences/commands/http';
import type { CommandService } from '../../commands/service/command-service.js';
import type {
	CommandActor,
	CommandInput,
	CommandRecord,
	CommandTagRecord,
	CommandTask,
	CommandResult,
} from '../../commands/model/command-types.js';
import { CommandFailure } from '../../command-failure.js';

const ERROR_STATUS: Record<CommandErrorCode, number> = {
	invalid_input: 400,
	unauthenticated: 401,
	forbidden: 403,
	not_found: 404,
	version_conflict: 409,
	name_conflict: 409,
	limit_exceeded: 413,
	storage_unavailable: 503,
	operation_unknown: 503,
	internal_failure: 503,
	unavailable: 503,
};

function variables(value: Record<string, string>): Record<string, string> {
	const result: Record<string, string> = {};
	for (const [key, entry] of Object.entries(value)) {
		Object.defineProperty(result, key, { value: entry, enumerable: true });
	}
	return result;
}

function toInput(value: QuickCommandCreateRequest): CommandInput {
	return {
		name: value.name,
		command: value.command,
		variables: variables(value.variables),
		tagIds: value.tagIds.map((id) => id),
	};
}

function toCommand(value: CommandRecord): QuickCommand {
	return {
		id: value.id,
		version: value.version,
		name: value.name,
		command: value.command,
		variables: variables(value.variables),
		tagIds: value.tagIds.map((id) => id),
		usageCount: value.usageCount,
		createdAt: value.createdAt,
		updatedAt: value.updatedAt,
	};
}

function toTag(value: CommandTagRecord): QuickCommandTag {
	return {
		id: value.id,
		version: value.version,
		name: value.name,
		createdAt: value.createdAt,
		updatedAt: value.updatedAt,
	};
}

async function authenticate(request: HttpRequest, reply: HttpReply, access: AccessPublicApi): Promise<CommandActor> {
	const token = readRequestCookie(request.raw, ACCESS_SESSION_COOKIE_NAME);
	const identity = await access.authenticate(token);
	if (!token || !identity) {
		throw new CommandFailure('unauthenticated');
	}
	return { userId: identity.userId, token };
}

async function revalidate(
	request: HttpRequest,
	reply: HttpReply,
	access: AccessPublicApi,
	actor: CommandActor,
): Promise<void> {
	const current = await authenticate(request, reply, access);
	if (current.userId !== actor.userId || current.token !== actor.token) {
		throw new CommandFailure('forbidden');
	}
}

function ready(request: HttpRequest, reply: HttpReply): void {
	if (reply.raw.destroyed || reply.raw.writableEnded) {
		throw new CommandFailure('unavailable');
	}
}

function send(request: HttpRequest, reply: HttpReply, status: number, body: unknown, mutation = false): void {
	ready(request, reply);
	reply.type('application/json; charset=utf-8').serializer((payload) => {
		try {
			const encoded = JSON.stringify(payload);
			if (encoded === undefined) {
				throw new CommandFailure('internal_failure');
			}
			if (Buffer.byteLength(encoded, 'utf8') > COMMAND_RESPONSE_MAX_BYTES) {
				throw new CommandFailure('limit_exceeded');
			}
			return encoded;
		} catch (cause) {
			throw new CommandFailure(
				mutation ? 'operation_unknown' : cause instanceof CommandFailure ? cause.code : 'internal_failure',
				{ cause },
			);
		}
	});
	reply.code(status).send(body);
}

function failureCode(error: unknown): CommandErrorCode {
	if (error instanceof CommandFailure) {
		return error.code;
	}
	if (error instanceof HttpInputFailure) {
		return error.status === 413 ? 'limit_exceeded' : 'invalid_input';
	}
	if (error instanceof InvalidCommandPayload) {
		return 'invalid_input';
	}
	if (
		error instanceof AccessOperationError &&
		(error.code === 'storage_unavailable' || error.code === 'operation_unknown')
	) {
		return error.code;
	}
	return 'internal_failure';
}

function sendFailure(error: unknown, request: HttpRequest, reply: HttpReply): void {
	const code = failureCode(error);
	if (reply.sent || reply.raw.headersSent) {
		reply.raw.destroy();
	} else if (!reply.raw.destroyed && !reply.raw.writableEnded) {
		reply
			.removeHeader('Content-Length')
			.type('application/json; charset=utf-8')
			.serializer(JSON.stringify)
			.code(error instanceof HttpInputFailure ? error.status : ERROR_STATUS[code])
			.send({ code });
	}
}

function httpErrorHandler(error: unknown, request: HttpRequest, reply: HttpReply): void {
	if (!(error instanceof CommandFailure)) {
		throw error;
	}
	sendFailure(error, request, reply);
}

async function handle(request: HttpRequest, reply: HttpReply, work: () => Promise<void>): Promise<void> {
	try {
		await work();
	} catch (error) {
		sendFailure(error, request, reply);
	}
}

function projectResult(
	task: CommandTask,
	result: CommandResult,
): CommandMutationResponse | CommandTagMutationResponse | CommandDeleteResponse | CommandAssignTagResponse {
	switch (task.action) {
		case 'create':
		case 'update':
		case 'increment':
			if (result.status === 'command') {
				return { command: toCommand(result.value) };
			}
			break;
		case 'create_tag':
		case 'update_tag':
			if (result.status === 'tag') {
				return { tag: toTag(result.value) };
			}
			break;
		case 'delete':
		case 'delete_tag':
		case 'delete_untagged_group':
		case 'delete_group':
			if (result.status === 'deleted') {
				return { deleted: true };
			}
			break;
		case 'assign_tag':
			if (result.status === 'assigned') {
				return { count: result.count };
			}
			break;
	}
	throw new CommandFailure('operation_unknown');
}

async function execute(
	request: HttpRequest,
	reply: HttpReply,
	access: AccessPublicApi,
	service: CommandService,
	decode: (value: unknown) => CommandTask,
	status: number,
): Promise<void> {
	if (request.query.size) {
		throw new InvalidCommandPayload();
	}
	const actor = await authenticate(request, reply, access);
	const input = request.body;
	const task = decode(input);
	await revalidate(request, reply, access, actor);
	ready(request, reply);
	const result = await service.mutate(actor, task);
	try {
		await revalidate(request, reply, access, actor);
		send(request, reply, status, projectResult(task, result), true);
	} catch (cause) {
		throw new CommandFailure('operation_unknown', { cause });
	}
}

export function createCommandRoutes(service: CommandService, access: AccessPublicApi): HttpRoute[] {
	const path = '/api/v1/quick-commands';
	const tags = '/api/v1/quick-command-tags';
	return [
		{
			method: 'DELETE',
			url: path + '/untagged-group',
			bodyLimit: COMMAND_REQUEST_MAX_BYTES,

			errorHandler: httpErrorHandler,

			handler: (request, reply) =>
				handle(request, reply, () =>
					execute(
						request,
						reply,
						access,
						service,
						(value) => {
							const input = readCommandUntaggedGroupDelete(value);
							return {
								action: 'delete_untagged_group',
								commands: input.commands.map((row) => ({
									id: row.id,
									expectedVersion: row.expectedVersion,
								})),
							};
						},
						200,
					),
				),
		},
		{
			method: 'GET',
			url: path,

			errorHandler: httpErrorHandler,

			handler: (request, reply) =>
				handle(request, reply, async () => {
					const actor = await authenticate(request, reply, access);
					const query = readCommandQuery(request.query);
					const page = await service.list(actor, {
						sortBy: query.sortBy,
						offset: query.offset,
						limit: query.limit,
					});
					await revalidate(request, reply, access, actor);
					const body: CommandListResponse = {
						entries: page.entries.map(toCommand),
						nextOffset: page.nextOffset,
					};
					send(request, reply, 200, body);
				}),
		},
		{
			method: 'GET',
			url: tags,

			errorHandler: httpErrorHandler,

			handler: (request, reply) =>
				handle(request, reply, async () => {
					const actor = await authenticate(request, reply, access);
					const query = readCommandQuery(request.query, true);
					const page = await service.listTags(actor, {
						sortBy: query.sortBy,
						offset: query.offset,
						limit: query.limit,
					});
					await revalidate(request, reply, access, actor);
					const body: CommandTagListResponse = {
						entries: page.entries.map(toTag),
						nextOffset: page.nextOffset,
					};
					send(request, reply, 200, body);
				}),
		},
		{
			method: 'POST',
			url: path,
			bodyLimit: COMMAND_REQUEST_MAX_BYTES,

			errorHandler: httpErrorHandler,

			handler: (request, reply) =>
				handle(request, reply, () =>
					execute(
						request,
						reply,
						access,
						service,
						(value) => ({ action: 'create', input: toInput(readCommandCreate(value)) }),
						201,
					),
				),
		},
		{
			method: 'PUT',
			url: path + '/:id',
			bodyLimit: COMMAND_REQUEST_MAX_BYTES,

			errorHandler: httpErrorHandler,

			handler: (request, reply) =>
				handle(request, reply, () =>
					execute(
						request,
						reply,
						access,
						service,
						(value) => {
							const input = readCommandUpdate(value);
							return {
								action: 'update',
								id: readCommandId(request.params.id),
								expectedVersion: input.expectedVersion,
								input: toInput(input),
							};
						},
						200,
					),
				),
		},
		{
			method: 'DELETE',
			url: path + '/:id',
			bodyLimit: COMMAND_REQUEST_MAX_BYTES,

			errorHandler: httpErrorHandler,

			handler: (request, reply) =>
				handle(request, reply, () =>
					execute(
						request,
						reply,
						access,
						service,
						(value) => ({
							action: 'delete',
							id: readCommandId(request.params.id),
							expectedVersion: readCommandVersion(value).expectedVersion,
						}),
						200,
					),
				),
		},
		{
			method: 'POST',
			url: path + '/:id/increment-usage',
			bodyLimit: COMMAND_REQUEST_MAX_BYTES,

			errorHandler: httpErrorHandler,

			handler: (request, reply) =>
				handle(request, reply, () =>
					execute(
						request,
						reply,
						access,
						service,
						(value) => ({
							action: 'increment',
							id: readCommandId(request.params.id),
							expectedVersion: readCommandVersion(value).expectedVersion,
						}),
						200,
					),
				),
		},
		{
			method: 'POST',
			url: path + '/bulk-assign-tag',
			bodyLimit: COMMAND_REQUEST_MAX_BYTES,

			errorHandler: httpErrorHandler,

			handler: (request, reply) =>
				handle(request, reply, () =>
					execute(
						request,
						reply,
						access,
						service,
						(value) => {
							const input = readCommandAssign(value);
							return {
								action: 'assign_tag',
								commands: input.commands.map((row) => ({
									id: row.id,
									expectedVersion: row.expectedVersion,
								})),
								tagId: input.tagId,
							};
						},
						200,
					),
				),
		},
		{
			method: 'POST',
			url: tags,
			bodyLimit: COMMAND_REQUEST_MAX_BYTES,

			errorHandler: httpErrorHandler,

			handler: (request, reply) =>
				handle(request, reply, () =>
					execute(
						request,
						reply,
						access,
						service,
						(value) => ({ action: 'create_tag', name: readCommandTagCreate(value).name }),
						201,
					),
				),
		},
		{
			method: 'PUT',
			url: tags + '/:id',
			bodyLimit: COMMAND_REQUEST_MAX_BYTES,

			errorHandler: httpErrorHandler,

			handler: (request, reply) =>
				handle(request, reply, () =>
					execute(
						request,
						reply,
						access,
						service,
						(value) => {
							const input = readCommandTagUpdate(value);
							return {
								action: 'update_tag',
								id: readCommandId(request.params.id),
								expectedVersion: input.expectedVersion,
								name: input.name,
							};
						},
						200,
					),
				),
		},
		{
			method: 'DELETE',
			url: tags + '/:id/group',
			bodyLimit: COMMAND_REQUEST_MAX_BYTES,

			errorHandler: httpErrorHandler,

			handler: (request, reply) =>
				handle(request, reply, () =>
					execute(
						request,
						reply,
						access,
						service,
						(value) => {
							const input = readCommandGroupDelete(value);
							return {
								action: 'delete_group',
								id: readCommandId(request.params.id),
								expectedVersion: input.expectedVersion,
								commands: input.commands.map((row) => ({
									id: row.id,
									expectedVersion: row.expectedVersion,
								})),
							};
						},
						200,
					),
				),
		},
		{
			method: 'DELETE',
			url: tags + '/:id',
			bodyLimit: COMMAND_REQUEST_MAX_BYTES,

			errorHandler: httpErrorHandler,

			handler: (request, reply) =>
				handle(request, reply, () =>
					execute(
						request,
						reply,
						access,
						service,
						(value) => ({
							action: 'delete_tag',
							id: readCommandId(request.params.id),
							expectedVersion: readCommandVersion(value).expectedVersion,
						}),
						200,
					),
				),
		},
	];
}
