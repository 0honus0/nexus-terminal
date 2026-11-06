import type { HttpRoute, HttpRequest, HttpReply } from '../../../../platform/http/http-types.js';
import { readRequestCookie } from '../../../../platform/http/http-request.js';
import { ACCESS_SESSION_COOKIE_NAME } from '@nexus-terminal/shared/access/values';
import type { AccessPublicApi } from '../../../access/public.js';
import { AccessOperationError } from '../../../access/public-errors.js';
import type { ManagementService } from '../../management/service/management-service.js';
import type { ManagementActor } from '../../management/model/management-types.js';
import { TargetFailure } from '../../target-failure.js';
import type { TargetsPublicApi } from '../../public.js';
import { TargetOperationError } from '../../public-errors.js';
import { urlId } from './target-http-codec.js';
import { importConnectionRequest } from './connection-import-http.js';
import { TARGET_CONNECTION_IMPORT_MULTIPART_MAX_BYTES } from '@nexus-terminal/shared/targets/connections/values';
import {
	TARGET_MANAGEMENT_MAX_ITEMS,
	TARGET_MANAGEMENT_RESPONSE_MAX_BYTES,
} from '@nexus-terminal/shared/targets/values';
import {
	InvalidTargetPayload,
	targetHttpBodyLimit,
	type TargetDeleteResponse,
	type TargetErrorResponse,
} from '@nexus-terminal/shared/targets/http';
import type { TargetHostKeyRemoveResponse } from '@nexus-terminal/shared/targets/host-keys/http';
import {
	toHostKeyDto,
	toConnectionDto,
	toConnectionMutation,
	toCredentialMutation,
	toCredentialDto,
	toProxyDto,
	toProxyMutation,
	toSshKeyDto,
	toSshKeyMutation,
	toTagDto,
	toTagMutation,
} from './target-http-view.js';

import {
	readConnectionAddTagRequest,
	readConnectionInput,
	readConnectionUpdateRequest,
	readConnectionTagsRequest,
	readConnectionCloneRequest,
	readCredentialSetRequest,
	readCredentialClearRequest,
} from '@nexus-terminal/shared/targets/connections/http-codec';
import { readProxyInput, readProxyUpdateRequest } from '@nexus-terminal/shared/targets/proxies/http-codec';
import { readSshKeyInput, readSshKeyUpdateRequest } from '@nexus-terminal/shared/targets/ssh-keys/http-codec';
import type { TargetTagConnectionsResponse } from '@nexus-terminal/shared/targets/tags/http';
import {
	readTagConnectionsRequest,
	readTagCreateRequest,
	readTagRenameRequest,
} from '@nexus-terminal/shared/targets/tags/http-codec';
import { readHostKeyConfirmRequest, readHostKeyRequest } from '@nexus-terminal/shared/targets/host-keys/http-codec';

type Method = HttpRoute['method'];
type Handler = (request: HttpRequest, reply: HttpReply) => Promise<unknown>;
const ROOT = '/api/v1/targets';

class TargetResponseLimitExceeded extends Error {}

function errorStatus(code: TargetOperationError['code']): number {
	switch (code) {
		case 'unauthenticated':
			return 401;
		case 'forbidden':
			return 403;
		case 'invalid_input':
			return 400;
		case 'reference_not_found':
			return 404;
		case 'reference_in_use':
		case 'conflict':
			return 409;
		case 'unresolvable':
			return 422;
		case 'operation_unknown':
		case 'storage_unavailable':
			return 503;
		default:
			return 500;
	}
}

async function readActor(
	request: HttpRequest,
	reply: HttpReply,
	access: AccessPublicApi,
): Promise<ManagementActor | null> {
	const token = readRequestCookie(request.raw, ACCESS_SESSION_COOKIE_NAME);
	const identity = await access.authenticate(token);
	if (identity === null || token === null) {
		reply.code(401).send({ code: 'unauthenticated' } satisfies TargetErrorResponse);
		return null;
	}
	return { userId: identity.userId, token };
}

function sendAssociated(reply: HttpReply, updated: boolean): void {
	reply
		.code(updated ? 200 : 404)
		.send(
			updated
				? ({ updated: true } satisfies TargetTagConnectionsResponse)
				: ({ code: 'not_found' } satisfies TargetErrorResponse),
		);
}

function addRoute(
	routes: HttpRoute[],
	method: Method,
	suffix: string,
	access: AccessPublicApi,
	management: ManagementService,
	action: Handler,
): void {
	routes.push({
		method,
		url: ROOT + suffix,

		errorHandler(error, _request, reply) {
			if (!(error instanceof TargetFailure) && !(error instanceof TargetResponseLimitExceeded)) {
				throw error;
			}
			reply.removeHeader('Set-Cookie');
			reply.type('application/json; charset=utf-8').serializer(JSON.stringify);
			if (error instanceof TargetResponseLimitExceeded) {
				reply.code(413).send({ code: 'limit_exceeded' } satisfies TargetErrorResponse);
			} else if (error instanceof TargetFailure) {
				reply.code(errorStatus(error.code)).send({ code: error.code } satisfies TargetErrorResponse);
			}
		},

		bodyLimit: targetHttpBodyLimit(suffix),

		...(suffix === '/connections/import'
			? { config: { multipartBodyLimit: TARGET_CONNECTION_IMPORT_MULTIPART_MAX_BYTES } }
			: {}),

		async handler(request, reply): Promise<void> {
			try {
				// Bootstrap supports only initial administrator (row 1) until Access adds
				// explicit roles. Never treat a caller-supplied user ID as authority.
				const actor = await readActor(request, reply, access);
				if (actor === null) {
					return;
				}
				if (request.query.size !== 0) {
					throw new InvalidTargetPayload();
				}
				await management.run(actor, async () => {
					await action(request, reply);
				});
			} catch (error) {
				if (error instanceof InvalidTargetPayload) {
					reply.code(400).send({ code: 'invalid_input' } satisfies TargetErrorResponse);
				} else if (error instanceof AccessOperationError) {
					reply.code(error.code === 'storage_unavailable' ? 503 : 500).send({
						code: error.code === 'storage_unavailable' ? 'storage_unavailable' : 'internal_failure',
					} satisfies TargetErrorResponse);
				} else if (error instanceof TargetOperationError || error instanceof TargetFailure) {
					reply.code(errorStatus(error.code)).send({ code: error.code } satisfies TargetErrorResponse);
				} else {
					// Transport failures (including JSON parser 400/413/415) must not be
					// interpreted as business or storage failures.
					throw error;
				}
			}
		},
	});
}

function id(request: HttpRequest): number {
	return urlId(request.params.id);
}

function status(
	reply: HttpReply,
	result: { status: 'updated' | 'not_found' | 'version_conflict' },
	value: unknown,
): void {
	switch (result.status) {
		case 'not_found':
			reply.code(404).send({ code: 'not_found' } satisfies TargetErrorResponse);
			return;
		case 'version_conflict':
			reply.code(409).send({ code: 'version_conflict' } satisfies TargetErrorResponse);
			return;
		case 'updated':
			reply.code(200).send(value);
			return;
	}
}

function sendDeleted(reply: HttpReply, deleted: boolean): void {
	reply
		.code(deleted ? 200 : 404)
		.send(
			deleted
				? ({ deleted: true } satisfies TargetDeleteResponse)
				: ({ code: 'not_found' } satisfies TargetErrorResponse),
		);
}

function sendManagementList(reply: HttpReply, items: readonly unknown[], maxBytes: number): void {
	if (items.length > TARGET_MANAGEMENT_MAX_ITEMS) {
		reply.code(413).send({ code: 'limit_exceeded' } satisfies TargetErrorResponse);
		return;
	}
	reply.type('application/json; charset=utf-8').serializer((payload) => {
		let encoded: string;
		try {
			encoded = JSON.stringify(payload);
		} catch {
			throw new TargetFailure('internal_failure');
		}
		if (Buffer.byteLength(encoded, 'utf8') > maxBytes) {
			throw new TargetResponseLimitExceeded();
		}
		return encoded;
	});
	reply.code(200).send(items);
}

export function createTargetsRoutes(
	access: AccessPublicApi,
	targets: TargetsPublicApi,
	management: ManagementService,
): HttpRoute[] {
	const routes: HttpRoute[] = [];
	addRoute(routes, 'GET', '/host-keys', access, management, async (request, reply) => {
		sendManagementList(
			reply,
			(await targets.hostKeys.list()).map(toHostKeyDto),
			TARGET_MANAGEMENT_RESPONSE_MAX_BYTES['host-keys'],
		);
	});
	addRoute(routes, 'POST', '/host-keys/confirm', access, management, async (request, reply) => {
		const confirmed = await targets.hostKeys.confirm(readHostKeyConfirmRequest(request.body));
		reply.code(201).send(toHostKeyDto(confirmed));
	});
	addRoute(routes, 'POST', '/host-keys/remove', access, management, async (request, reply) => {
		const row = readHostKeyRequest(request.body);
		const removed = await targets.hostKeys.remove(row.host, row.port);
		reply
			.code(removed ? 200 : 404)
			.send(
				removed
					? ({ removed: true } satisfies TargetHostKeyRemoveResponse)
					: ({ code: 'not_found' } satisfies TargetErrorResponse),
			);
	});
	addRoute(routes, 'GET', '/connections', access, management, async (request, reply) =>
		sendManagementList(
			reply,
			(await targets.list()).map(toConnectionDto),
			TARGET_MANAGEMENT_RESPONSE_MAX_BYTES.connections,
		),
	);
	addRoute(routes, 'GET', '/connections/:id', access, management, async (request, reply) => {
		const result = await targets.get(id(request));
		reply
			.code(result === null ? 404 : 200)
			.send(result === null ? ({ code: 'not_found' } satisfies TargetErrorResponse) : toConnectionDto(result));
	});
	addRoute(routes, 'POST', '/connections', access, management, async (request, reply) => {
		const command = readConnectionInput(request.body);
		reply.code(201).send(toConnectionDto(await targets.create(command)));
	});
	addRoute(routes, 'PUT', '/connections/:id', access, management, async (request, reply) => {
		const row = readConnectionUpdateRequest(request.body);
		const result = await targets.update(id(request), row.version, row.changes, row.credential);
		status(reply, result, toConnectionMutation(result));
	});
	addRoute(routes, 'DELETE', '/connections/:id', access, management, async (request, reply) => {
		const deleted = await targets.delete(id(request));
		sendDeleted(reply, deleted);
	});
	addRoute(routes, 'POST', '/connections/:id/clone', access, management, async (request, reply) => {
		const input = readConnectionCloneRequest(request.body);
		const result = await targets.clone(id(request), input.name);
		reply
			.code(result === null ? 404 : 201)
			.send(result === null ? ({ code: 'not_found' } satisfies TargetErrorResponse) : toConnectionDto(result));
	});
	addRoute(routes, 'PUT', '/connections/:id/tags', access, management, async (request, reply) => {
		const row = readConnectionTagsRequest(request.body);
		const result = await targets.setTags(id(request), row.version, row.tagIds);
		status(reply, result, toConnectionMutation(result));
	});
	addRoute(routes, 'POST', '/connections/add-tag', access, management, async (request, reply) => {
		const command = readConnectionAddTagRequest(request.body);
		sendAssociated(reply, await targets.tags.addConnections(command.tagId, command.connectionIds));
	});
	addRoute(routes, 'POST', '/connections/import', access, management, async (request, reply) => {
		reply.code(200).send(await importConnectionRequest(request, reply, targets));
	});
	addRoute(routes, 'GET', '/connections/:id/credential', access, management, async (request, reply) => {
		const value = await targets.credentials.get(id(request));
		reply
			.code(value === null ? 404 : 200)
			.send(value === null ? ({ code: 'not_found' } satisfies TargetErrorResponse) : toCredentialDto(value));
	});
	addRoute(routes, 'PUT', '/connections/:id/credential', access, management, async (request, reply) => {
		const row = readCredentialSetRequest(request.body);
		const result = await targets.credentials.set(id(request), row.version, row.credential);
		status(reply, result, toCredentialMutation(result));
	});
	addRoute(routes, 'DELETE', '/connections/:id/credential', access, management, async (request, reply) => {
		const row = readCredentialClearRequest(request.body);
		const result = await targets.credentials.clear(id(request), row.version);
		status(reply, result, toCredentialMutation(result));
	});

	addRoute(routes, 'GET', '/proxies', access, management, async (request, reply) =>
		sendManagementList(
			reply,
			(await targets.proxies.list()).map(toProxyDto),
			TARGET_MANAGEMENT_RESPONSE_MAX_BYTES.proxies,
		),
	);
	addRoute(routes, 'GET', '/proxies/:id', access, management, async (request, reply) => {
		const result = await targets.proxies.get(id(request));
		reply
			.code(result === null ? 404 : 200)
			.send(result === null ? ({ code: 'not_found' } satisfies TargetErrorResponse) : toProxyDto(result));
	});
	addRoute(routes, 'POST', '/proxies', access, management, async (request, reply) =>
		reply.code(201).send(toProxyDto(await targets.proxies.create(readProxyInput(request.body)))),
	);
	addRoute(routes, 'PUT', '/proxies/:id', access, management, async (request, reply) => {
		const row = readProxyUpdateRequest(request.body);
		const result = await targets.proxies.update(id(request), row.version, row.changes);
		status(reply, result, toProxyMutation(result));
	});
	addRoute(routes, 'DELETE', '/proxies/:id', access, management, async (request, reply) => {
		const deleted = await targets.proxies.delete(id(request));
		sendDeleted(reply, deleted);
	});

	addRoute(routes, 'GET', '/tags', access, management, async (request, reply) =>
		sendManagementList(reply, (await targets.tags.list()).map(toTagDto), TARGET_MANAGEMENT_RESPONSE_MAX_BYTES.tags),
	);
	addRoute(routes, 'GET', '/tags/:id', access, management, async (request, reply) => {
		const result = await targets.tags.get(id(request));
		reply
			.code(result === null ? 404 : 200)
			.send(result === null ? ({ code: 'not_found' } satisfies TargetErrorResponse) : toTagDto(result));
	});
	addRoute(routes, 'POST', '/tags', access, management, async (request, reply) =>
		reply.code(201).send(toTagDto(await targets.tags.create(readTagCreateRequest(request.body).name))),
	);
	addRoute(routes, 'PUT', '/tags/:id', access, management, async (request, reply) => {
		const row = readTagRenameRequest(request.body);
		const result = await targets.tags.rename(id(request), row.version, row.name);
		status(reply, result, toTagMutation(result));
	});
	addRoute(routes, 'PUT', '/tags/:id/connections', access, management, async (request, reply) => {
		const tagId = id(request);
		const command = readTagConnectionsRequest(request.body);
		sendAssociated(reply, await targets.tags.setConnections(tagId, command.connectionIds));
	});
	addRoute(routes, 'DELETE', '/tags/:id', access, management, async (request, reply) => {
		const deleted = await targets.tags.delete(id(request));
		sendDeleted(reply, deleted);
	});

	addRoute(routes, 'GET', '/ssh-keys', access, management, async (request, reply) =>
		sendManagementList(
			reply,
			(await targets.sshKeys.list()).map(toSshKeyDto),
			TARGET_MANAGEMENT_RESPONSE_MAX_BYTES['ssh-keys'],
		),
	);
	addRoute(routes, 'GET', '/ssh-keys/:id', access, management, async (request, reply) => {
		const result = await targets.sshKeys.get(id(request));
		reply
			.code(result === null ? 404 : 200)
			.send(result === null ? ({ code: 'not_found' } satisfies TargetErrorResponse) : toSshKeyDto(result));
	});
	addRoute(routes, 'POST', '/ssh-keys', access, management, async (request, reply) =>
		reply.code(201).send(toSshKeyDto(await targets.sshKeys.create(readSshKeyInput(request.body)))),
	);
	addRoute(routes, 'PUT', '/ssh-keys/:id', access, management, async (request, reply) => {
		const row = readSshKeyUpdateRequest(request.body);
		const result = await targets.sshKeys.update(id(request), row.version, row.changes);
		status(reply, result, toSshKeyMutation(result));
	});
	addRoute(routes, 'DELETE', '/ssh-keys/:id', access, management, async (request, reply) => {
		const deleted = await targets.sshKeys.delete(id(request));
		sendDeleted(reply, deleted);
	});
	return routes;
}
