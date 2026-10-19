import type { HttpRoute, HttpRouteContext } from '../../../../platform/http/http-types.js';
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

async function authenticate(context: HttpRouteContext, access: AccessPublicApi): Promise<CommandActor> {
	const token = context.cookie(ACCESS_SESSION_COOKIE_NAME);
	const identity = await access.authenticate(token);
	if (!token || !identity) {
		throw new CommandFailure('unauthenticated');
	}
	return { userId: identity.userId, token };
}

async function revalidate(context: HttpRouteContext, access: AccessPublicApi, actor: CommandActor): Promise<void> {
	const current = await authenticate(context, access);
	if (current.userId !== actor.userId || current.token !== actor.token) {
		throw new CommandFailure('forbidden');
	}
}

function ready(context: HttpRouteContext): void {
	if (context.response.destroyed || context.response.writableEnded) {
		throw new CommandFailure('unavailable');
	}
}

function send(context: HttpRouteContext, status: number, body: unknown): void {
	if (Buffer.byteLength(JSON.stringify(body), 'utf8') > COMMAND_RESPONSE_MAX_BYTES) {
		throw new CommandFailure('limit_exceeded');
	}
	ready(context);
	context.send(status, body);
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

async function handle(context: HttpRouteContext, work: () => Promise<void>): Promise<void> {
	try {
		await work();
	} catch (error) {
		const code = failureCode(error);
		if (context.response.headersSent) {
			context.response.destroy();
		} else if (!context.response.destroyed && !context.response.writableEnded) {
			context.send(error instanceof HttpInputFailure ? error.status : ERROR_STATUS[code], { code });
		}
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
	context: HttpRouteContext,
	access: AccessPublicApi,
	service: CommandService,
	decode: (value: unknown) => CommandTask,
	status: number,
): Promise<void> {
	if (context.query.size) {
		throw new InvalidCommandPayload();
	}
	const actor = await authenticate(context, access);
	const input = await context.json();
	const task = decode(input);
	await revalidate(context, access, actor);
	ready(context);
	const result = await service.mutate(actor, task);
	try {
		await revalidate(context, access, actor);
		send(context, status, projectResult(task, result));
	} catch (cause) {
		throw new CommandFailure('operation_unknown', { cause });
	}
}

export function createCommandRoutes(service: CommandService, access: AccessPublicApi): HttpRoute[] {
	const path = '/api/v1/quick-commands';
	const tags = '/api/v1/quick-command-tags';
	return [
		{
			method: 'GET',
			path,

			handle: (context) =>
				handle(context, async () => {
					const actor = await authenticate(context, access);
					const query = readCommandQuery(context.query);
					const page = await service.list(actor, {
						sortBy: query.sortBy,
						offset: query.offset,
						limit: query.limit,
					});
					await revalidate(context, access, actor);
					const body: CommandListResponse = {
						entries: page.entries.map(toCommand),
						nextOffset: page.nextOffset,
					};
					send(context, 200, body);
				}),
		},
		{
			method: 'GET',
			path: tags,

			handle: (context) =>
				handle(context, async () => {
					const actor = await authenticate(context, access);
					const query = readCommandQuery(context.query, true);
					const page = await service.listTags(actor, {
						sortBy: query.sortBy,
						offset: query.offset,
						limit: query.limit,
					});
					await revalidate(context, access, actor);
					const body: CommandTagListResponse = {
						entries: page.entries.map(toTag),
						nextOffset: page.nextOffset,
					};
					send(context, 200, body);
				}),
		},
		{
			method: 'POST',
			path,
			maxBodyBytes: COMMAND_REQUEST_MAX_BYTES,

			handle: (context) =>
				handle(context, () =>
					execute(
						context,
						access,
						service,
						(value) => ({ action: 'create', input: toInput(readCommandCreate(value)) }),
						201,
					),
				),
		},
		{
			method: 'PUT',
			path: path + '/:id',
			maxBodyBytes: COMMAND_REQUEST_MAX_BYTES,

			handle: (context) =>
				handle(context, () =>
					execute(
						context,
						access,
						service,
						(value) => {
							const input = readCommandUpdate(value);
							return {
								action: 'update',
								id: readCommandId(context.params.id),
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
			path: path + '/:id',
			maxBodyBytes: COMMAND_REQUEST_MAX_BYTES,

			handle: (context) =>
				handle(context, () =>
					execute(
						context,
						access,
						service,
						(value) => ({
							action: 'delete',
							id: readCommandId(context.params.id),
							expectedVersion: readCommandVersion(value).expectedVersion,
						}),
						200,
					),
				),
		},
		{
			method: 'POST',
			path: path + '/:id/increment-usage',
			maxBodyBytes: COMMAND_REQUEST_MAX_BYTES,

			handle: (context) =>
				handle(context, () =>
					execute(
						context,
						access,
						service,
						(value) => ({
							action: 'increment',
							id: readCommandId(context.params.id),
							expectedVersion: readCommandVersion(value).expectedVersion,
						}),
						200,
					),
				),
		},
		{
			method: 'POST',
			path: path + '/bulk-assign-tag',
			maxBodyBytes: COMMAND_REQUEST_MAX_BYTES,

			handle: (context) =>
				handle(context, () =>
					execute(
						context,
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
			path: tags,
			maxBodyBytes: COMMAND_REQUEST_MAX_BYTES,

			handle: (context) =>
				handle(context, () =>
					execute(
						context,
						access,
						service,
						(value) => ({ action: 'create_tag', name: readCommandTagCreate(value).name }),
						201,
					),
				),
		},
		{
			method: 'PUT',
			path: tags + '/:id',
			maxBodyBytes: COMMAND_REQUEST_MAX_BYTES,

			handle: (context) =>
				handle(context, () =>
					execute(
						context,
						access,
						service,
						(value) => {
							const input = readCommandTagUpdate(value);
							return {
								action: 'update_tag',
								id: readCommandId(context.params.id),
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
			path: tags + '/:id',
			maxBodyBytes: COMMAND_REQUEST_MAX_BYTES,

			handle: (context) =>
				handle(context, () =>
					execute(
						context,
						access,
						service,
						(value) => ({
							action: 'delete_tag',
							id: readCommandId(context.params.id),
							expectedVersion: readCommandVersion(value).expectedVersion,
						}),
						200,
					),
				),
		},
	];
}
