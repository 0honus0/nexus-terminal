import { ACCESS_SESSION_COOKIE_NAME } from '@nexus-terminal/shared/access/values';
import type { HttpRoute, HttpRouteContext } from '../../../../platform/http/http-types.js';
import { HttpInputFailure } from '../../../../platform/http/http-errors.js';
import type { ConnectionTestService } from '../../machines/service/connection-test-service.js';
import type { ConnectionTestCommand, UnsavedConnectionTest } from '../../machines/model/connection-test-types.js';
import { ConnectionTestFailure } from '../../connection-test-failure.js';
import { ConnectionTestHostKeyFailure } from '../../machines/model/connection-test-errors.js';
import { InvalidTargetPayload, targetNumber } from '@nexus-terminal/shared/targets/http';
import { CONNECTION_TEST_BODY_MAX_BYTES } from '@nexus-terminal/shared/targets/connections/values';
import type { ConnectionTestErrorCode } from '@nexus-terminal/shared/targets/connections/values';
import type {
	UnsavedSshTestInput,
	ConnectionTestResponse,
	ConnectionTestFailureResponse,
} from '@nexus-terminal/shared/targets/connections/test-http';
import { readUnsavedSshTest } from '@nexus-terminal/shared/targets/connections/test-codec';

function toUnsaved(value: UnsavedSshTestInput): UnsavedConnectionTest {
	const auth = value.authentication;
	return {
		host: value.host,
		port: value.port,
		username: value.username,
		authentication:
			auth.kind === 'password'
				? { kind: 'password', password: auth.password }
				: auth.kind === 'ssh_key'
					? { kind: 'ssh_key', sshKeyId: auth.sshKeyId }
					: { kind: 'private_key', privateKey: auth.privateKey, passphrase: auth.passphrase },
		route: value.route,
		proxyId: value.proxyId,
		jumpIds: value.jumpIds.map((id) => id),
	};
}

function status(code: ConnectionTestErrorCode): number {
	switch (code) {
		case 'invalid_input':
			return 400;
		case 'unauthenticated':
			return 401;
		case 'forbidden':
			return 403;
		case 'reference_not_found':
			return 404;
		case 'conflict':
			return 409;
		case 'host_key_untrusted':
		case 'unresolvable':
		case 'connection_failed':
			return 422;
		case 'limit_exceeded':
			return 429;
		case 'internal_failure':
			return 500;
		case 'cleanup_failed':
		case 'storage_unavailable':
		case 'unavailable':
		case 'shutting_down':
			return 503;
	}
}

async function handle(context: HttpRouteContext, owner: ConnectionTestService, stored: boolean): Promise<void> {
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), 15_000);

	const disconnected = () => controller.abort();

	context.response.once('close', disconnected);
	try {
		if (context.query.size) {
			throw new InvalidTargetPayload();
		}
		let command: ConnectionTestCommand;
		if (stored) {
			if (!/^[1-9]\d*$/u.test(context.params.id)) {
				throw new InvalidTargetPayload();
			}
			command = { kind: 'stored', targetId: targetNumber(Number(context.params.id)) };
		} else {
			command = { kind: 'unsaved', target: toUnsaved(readUnsavedSshTest(await context.json(controller.signal))) };
		}
		const value = await owner.test(context.cookie(ACCESS_SESSION_COOKIE_NAME), command, controller.signal);
		controller.signal.throwIfAborted();
		context.send(200, { status: 'ok', latencyMs: value.latencyMs } satisfies ConnectionTestResponse);
	} catch (error) {
		if (error instanceof HttpInputFailure) {
			throw error;
		}
		if (error instanceof ConnectionTestHostKeyFailure && !controller.signal.aborted) {
			context.send(422, {
				code: 'host_key_untrusted',
				hostKey: {
					host: error.hostKey.host,
					port: error.hostKey.port,
					fingerprint: error.hostKey.fingerprint,
					expectedFingerprint: error.hostKey.expectedFingerprint,
				},
			} satisfies ConnectionTestFailureResponse);
			return;
		}
		const code =
			error instanceof InvalidTargetPayload
				? 'invalid_input'
				: error instanceof ConnectionTestFailure && error.code !== 'host_key_untrusted'
					? error.code
					: controller.signal.aborted
						? 'unavailable'
						: 'internal_failure';
		context.send(status(code), { code } satisfies ConnectionTestFailureResponse);
	} finally {
		clearTimeout(timer);
		context.response.off('close', disconnected);
	}
}

export function createConnectionTestRoutes(owner: ConnectionTestService): HttpRoute[] {
	return [
		{
			method: 'POST',
			path: '/api/v1/targets/connections/:id/test',
			maxBodyBytes: CONNECTION_TEST_BODY_MAX_BYTES,

			handle: (ctx) => handle(ctx, owner, true),
		},
		{
			method: 'POST',
			path: '/api/v1/targets/connections/test-unsaved',
			maxBodyBytes: CONNECTION_TEST_BODY_MAX_BYTES,

			handle: (ctx) => handle(ctx, owner, false),
		},
	];
}
