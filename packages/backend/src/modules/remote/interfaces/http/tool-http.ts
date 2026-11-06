import { readRequestCookie } from '../../../../platform/http/http-request.js';
import { ACCESS_SESSION_COOKIE_NAME } from '@nexus-terminal/shared/access/values';
import {
	InvalidRemoteToolPayload,
	readRemoteToolCheckRequest,
	readRemoteToolInstallRequest,
} from '@nexus-terminal/shared/remote/tools/http-codec';
import { TOOL_BODY_MAX_BYTES, type ToolErrorCode } from '@nexus-terminal/shared/remote/tools/values';
import type { RemoteToolCheck } from '@nexus-terminal/shared/remote/tools/model';
import type { RemoteToolInstallResponse, RemoteToolErrorResponse } from '@nexus-terminal/shared/remote/tools/http';
import type { HttpRoute, HttpRequest, HttpReply } from '../../../../platform/http/http-types.js';
import { HttpInputFailure } from '../../../../platform/http/http-errors.js';
import type { RemoteToolService } from '../../tools/service/tool-service.js';
import { RemoteToolFailure, type ToolCheckIntent } from '../../tools/model/tool-types.js';

function status(code: ToolErrorCode): number {
	if (code === 'unauthenticated') {
		return 401;
	}
	if (code === 'forbidden') {
		return 403;
	}
	if (code === 'invalid_input') {
		return 400;
	}
	if (code === 'not_found') {
		return 404;
	}
	if (code === 'stale_plan' || code === 'conflict') {
		return 409;
	}
	if (code === 'limit_exceeded') {
		return 429;
	}
	return code === 'unavailable' || code === 'connection_unavailable' || code === 'shutting_down' ? 503 : 422;
}

async function handle(
	request: HttpRequest,
	reply: HttpReply,
	owner: RemoteToolService,
	installing: boolean,
): Promise<void> {
	const controller = new AbortController();

	const disconnected = () => controller.abort();

	reply.raw.once('close', disconnected);
	try {
		if (request.query.size) {
			throw new InvalidRemoteToolPayload();
		}
		const token = readRequestCookie(request.raw, ACCESS_SESSION_COOKIE_NAME);
		const body = request.body;
		if (installing) {
			const command = readRemoteToolInstallRequest(body);
			const value = await owner.install(token, command.planId, command.password, controller.signal);
			reply.code(200).send({ targetId: value.targetId, ready: true } satisfies RemoteToolInstallResponse);
		} else {
			const input = readRemoteToolCheckRequest(body);
			const intent: ToolCheckIntent =
				input.kind === 'tools'
					? { kind: 'tools', targetId: input.targetId, tools: input.tools.map((tool) => tool) }
					: {
							kind: 'transfer',
							targetId: input.targetId,
							peerId: input.peerId,
							side: input.side,
							method: input.method,
						};
			const result = await owner.check(token, intent, controller.signal);
			const value = result.inspection;
			reply.code(200).send({
				targetId: value.targetId,
				tools: value.tools.map((tool) => tool),
				missing: value.missing.map((tool) => tool),
				manager: value.manager,
				privilege: value.privilege,
				planId: result.planId,
				expiresAt: result.expiresAt,
			} satisfies RemoteToolCheck);
		}
	} catch (cause) {
		if (cause instanceof HttpInputFailure) {
			throw cause;
		}
		const code =
			cause instanceof InvalidRemoteToolPayload
				? 'invalid_input'
				: cause instanceof RemoteToolFailure
					? cause.code
					: 'unavailable';
		reply.code(status(code)).send({ code } satisfies RemoteToolErrorResponse);
	} finally {
		reply.raw.off('close', disconnected);
	}
}

export function createRemoteToolRoutes(owner: RemoteToolService): HttpRoute[] {
	return [
		{
			method: 'POST',
			url: '/api/v1/remote/tools/check',
			bodyLimit: TOOL_BODY_MAX_BYTES,

			handler: (request, reply) => handle(request, reply, owner, false),
		},
		{
			method: 'POST',
			url: '/api/v1/remote/tools/install',
			bodyLimit: TOOL_BODY_MAX_BYTES,

			handler: (request, reply) => handle(request, reply, owner, true),
		},
	];
}
