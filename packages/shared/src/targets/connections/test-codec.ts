import {
	TARGET_CONNECTION_HOST_MAX_BYTES,
	TARGET_CONNECTION_MAX_JUMPS,
	TARGET_CONNECTION_USERNAME_MAX_BYTES,
	TARGET_CONNECTION_PASSWORD_MAX_BYTES,
} from './values.js';
import { TARGET_SSH_PRIVATE_KEY_MAX_BYTES, TARGET_SSH_PASSPHRASE_MAX_BYTES } from '../ssh-keys/values.js';
import {
	targetObject,
	targetText,
	targetNumber,
	targetIds,
	targetOption,
	targetNullable,
	InvalidTargetPayload,
} from '../http.js';
import { CONNECTION_ROUTES, CONNECTION_TEST_ERROR_CODES, CONNECTION_TEST_BODY_MAX_BYTES } from './values.js';
import type { UnsavedSshTestInput, ConnectionTestResponse, ConnectionTestFailureResponse } from './test-http.js';

export function readUnsavedSshTest(input: unknown): UnsavedSshTestInput {
	if (new TextEncoder().encode(JSON.stringify(input)).byteLength > CONNECTION_TEST_BODY_MAX_BYTES) {
		throw new InvalidTargetPayload();
	}
	const row = targetObject(input, ['host', 'port', 'username', 'authentication', 'route', 'proxyId', 'jumpIds']);
	const auth = targetObject(
		row.authentication,
		['kind', 'password', 'sshKeyId', 'privateKey', 'passphrase'],
		['kind'],
	);
	let authentication: UnsavedSshTestInput['authentication'];
	if (auth.kind === 'password') {
		targetObject(auth, ['kind', 'password']);
		authentication = {
			kind: 'password',
			password: targetText(auth.password, TARGET_CONNECTION_PASSWORD_MAX_BYTES),
		};
	} else if (auth.kind === 'ssh_key') {
		targetObject(auth, ['kind', 'sshKeyId']);
		authentication = { kind: 'ssh_key', sshKeyId: targetNumber(auth.sshKeyId) };
	} else if (auth.kind === 'private_key') {
		targetObject(auth, ['kind', 'privateKey', 'passphrase']);
		authentication = {
			kind: 'private_key',
			privateKey: targetText(auth.privateKey, TARGET_SSH_PRIVATE_KEY_MAX_BYTES, false),
			passphrase: targetNullable(auth.passphrase, TARGET_SSH_PASSPHRASE_MAX_BYTES),
		};
	} else {
		throw new InvalidTargetPayload();
	}
	const route = targetOption(row.route, CONNECTION_ROUTES);
	const proxyId = row.proxyId === null ? null : targetNumber(row.proxyId);
	const jumpIds = targetIds(row.jumpIds, TARGET_CONNECTION_MAX_JUMPS);
	if (
		(route === 'proxy' ? proxyId === null : proxyId !== null) ||
		(route === 'jump' ? !jumpIds.length : jumpIds.length !== 0)
	) {
		throw new InvalidTargetPayload();
	}
	return {
		host: targetText(row.host, TARGET_CONNECTION_HOST_MAX_BYTES, false),
		port: targetNumber(row.port, 65535),
		username: targetText(row.username, TARGET_CONNECTION_USERNAME_MAX_BYTES, false),
		authentication,
		route,
		proxyId,
		jumpIds,
	};
}

export function readConnectionTestResponse(input: unknown): ConnectionTestResponse {
	const row = targetObject(input, ['status', 'latencyMs']);
	if (row.status !== 'ok') {
		throw new InvalidTargetPayload();
	}
	return { status: 'ok', latencyMs: targetNumber(row.latencyMs, Number.MAX_SAFE_INTEGER, 0) };
}

export function readConnectionTestFailure(input: unknown): ConnectionTestFailureResponse {
	const row = targetObject(input, ['code']);
	return { code: targetOption(row.code, CONNECTION_TEST_ERROR_CODES) };
}
