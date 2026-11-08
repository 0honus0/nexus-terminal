import assert from 'node:assert/strict';
import { test } from 'vitest';
import {
	readRemoteDesktopSessionResponse as readSession,
	readRemoteDesktopFailureResponse as readFailure,
} from '@nexus-terminal/shared/remote/desktop/http-codec';

test('desktop ticket and safe failure codecs retain all original vectors', async () => {
	const checks = [];

	const check = (value, name) => {
		if (!value) throw Error(name);
		checks.push(name);
	};

	const rejects = async (action, name, predicate = () => true) => {
		let failure;
		try {
			await action();
		} catch (cause) {
			failure = cause;
		}
		check(failure !== undefined && predicate(failure), name);
	};

	const ticket = 'A'.repeat(43);
	const wire = {
		ticket,
		protocol: 'VNC',
		host: '127.0.0.1',
		port: 5900,
		username: '',
		password: 'private-password',
	};
	check(readSession(wire).ticket === ticket, 'strict successful ticket');
	for (const value of [
		{ ...wire, secret: 'private' },
		{ ...wire, ticket: 'bad' },
		{ ...wire, lastConnectedAt: 1700000000 },
		{ ...wire, ticket: ticket + 'A' },
	]) {
		await rejects(() => readSession(value), 'invalid success refuses extras/ticket');
	}
	for (const value of [{ code: 'remote_unavailable', message: 'secret' }, { code: 'other' }, { code: 401 }])
		await rejects(() => readFailure(value), 'strict safe failure');

	assert.equal(checks.length, 8);
});
