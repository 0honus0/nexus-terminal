import assert from 'node:assert/strict';
import { test } from 'node:test';
import { randomBytes } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { once } from 'node:events';
import { openDesktopManagement } from '../support/desktop-management-fixture.mjs';
import { expectStatus } from '../../../../support/protocols/openssh-fixture.mjs';
import {
	readConnectionView,
	readConnectionImportResponse,
} from '../../../../../packages/shared/dist/targets/connections/http-codec.js';
import {
	readRemoteDesktopSessionResponse,
	readRemoteDesktopFailureResponse,
} from '../../../../../packages/shared/dist/remote/desktop/http-codec.js';

async function createRdp(f, services, name) {
	const imported = readConnectionImportResponse(
		expectStatus(
			await f.api('POST', '/api/v1/targets/connections/import', {
				items: [
					{
						connection: {
							type: 'RDP',
							name,
							host: services.host,
							port: services.rdpPort,
							username: 'test',
							route: 'direct',
							proxyId: null,
							notes: null,
							tagIds: [],
							jumpIds: [],
						},
						credential: { kind: 'password', password: 'b10-pass' },
					},
				],
			}),
			200,
		),
	);
	assert.equal(imported.items.length, 1);
	const result = imported.items[0];
	assert.equal(result.status, 'ok');
	return result.id;
}

function certificateApproval(certificate, remember = false) {
	return {
		host: certificate.host,
		port: certificate.port,
		fingerprint: certificate.fingerprint,
		previousFingerprint: certificate.previousFingerprint,
		remember,
	};
}

async function issueOnce(f, services, id, remember = false) {
	const path = '/api/v1/connections/' + id + '/rdp-session?width=1600&height=1000&dpi=144';
	const untrusted = readRemoteDesktopFailureResponse(expectStatus(await f.api('POST', path), 409));
	assert.equal(untrusted.code, 'certificate_required');
	const result = await f.api('POST', path, { certificate: certificateApproval(untrusted.certificate, remember) });
	const payload = readRemoteDesktopSessionResponse(expectStatus(result, 200));
	assert.deepEqual(Object.keys(payload), ['ticket', 'protocol', 'host', 'port', 'username', 'password']);
	assert.equal(payload.protocol, 'RDP');
	assert.equal(payload.host, services.host);
	assert.equal(payload.port, services.rdpPort);
	assert.equal(payload.password, 'b10-pass');
	assert.equal(result.headers['cache-control'], 'no-store');
	assert.match(payload.ticket, /^[A-Za-z0-9_-]{43}$/u);
	return payload.ticket;
}

async function openCleanPath(peer) {
	const der = (tag, bytes) => Buffer.concat([Buffer.from([tag, bytes.length]), bytes]);

	const firstMessage = once(peer.socket, 'message');
	await once(peer.socket, 'open');
	const x224 = Buffer.from([3, 0, 0, 19, 14, 224, 0, 0, 0, 0, 0, 1, 0, 8, 0, 3, 0, 0, 0]);
	peer.socket.send(
		der(
			0x30,
			Buffer.concat([
				der(0xa0, der(2, Buffer.from([0x0d, 0x3e]))),
				der(0xa2, der(0x0c, Buffer.from('ignored.invalid:3389'))),
				der(0xa3, der(0x0c, Buffer.alloc(0))),
				der(0xa6, der(4, x224)),
			]),
		),
	);
	const [bytes] = await firstMessage;
	assert.equal(bytes[0], 0x30, 'Actual RDCleanPath response is DER, not a text bridge');
	await peer.close();
}

test(
	'RDP binary session, removed RemoteApp fields, certificate matching and one-time versus remembered trust',
	{ timeout: 60_000 },
	async (t) => {
		const { f, services, base, rawPeerFor } = await openDesktopManagement(t, 'session-http');
		const id = await createRdp(f, services, 'RDP HTTP protocol');
		const path = '/api/v1/connections/' + id + '/rdp-session';
		const persisted = readConnectionView(expectStatus(await f.api('GET', base + '/' + id), 200));
		assert.equal(persisted.id, id);
		assert.equal(persisted.type, 'RDP');
		for (const field of ['rdpRemoteApp', 'rdpRemoteAppDirectory', 'rdpRemoteAppArguments']) {
			const latest = readConnectionView(expectStatus(await f.api('GET', base + '/' + id), 200));
			expectStatus(
				await f.api('PUT', base + '/' + id, { version: latest.version, changes: { [field]: 'removed' } }),
				400,
			);
		}
		const rejected = expectStatus(await f.api('POST', path), 409);
		assert.deepEqual(Object.keys(rejected), ['code', 'certificate']);
		const failure = readRemoteDesktopFailureResponse(rejected);
		assert.equal(failure.code, 'certificate_required');
		const certificate = failure.certificate;
		assert.equal(certificate.host, services.host);
		assert.equal(certificate.port, services.rdpPort);
		assert.equal(certificate.previousFingerprint, null);
		for (const approval of [
			{ ...certificateApproval(certificate, true), fingerprint: '00:'.repeat(31) + '00' },
			{ ...certificateApproval(certificate, true), host: 'different.invalid' },
		]) {
			assert.equal(
				readRemoteDesktopFailureResponse(
					expectStatus(await f.api('POST', path, { certificate: approval }), 409),
				).code,
				'certificate_required',
			);
		}
		const ticket = await issueOnce(f, services, id);
		expectStatus(await f.api('POST', path), 409);
		await openCleanPath(rawPeerFor(ticket));
		assert.deepEqual(await rawPeerFor(ticket).closed, { code: 1008, reason: 'invalid_input' });
		expectStatus(await f.api('POST', path, { certificate: { fingerprint: certificate.fingerprint } }), 400);
		await issueOnce(f, services, id, true);
		assert.equal(readRemoteDesktopSessionResponse(expectStatus(await f.api('POST', path), 200)).protocol, 'RDP');
	},
);

test(
	'RDP ticket is bound to both user and login session without consuming the owner ticket',
	{ timeout: 60_000 },
	async (t) => {
		const { f, services, rawPeerFor } = await openDesktopManagement(t, 'session-identity');
		const id = await createRdp(f, services, 'Ticket user binding');
		const ticket = await issueOnce(f, services, id);
		// An asynchronous child lets the application's SQLite Worker finish its real audit transaction.
		// Synchronous SQLite lock waiting on the main thread would prevent that transaction from completing.
		await promisify(execFile)(process.execPath, [
			'-e',
			String.raw`
		const { DatabaseSync } = require('node:sqlite');
		const database = new DatabaseSync(process.argv[1]);
		try {
			database.exec('PRAGMA busy_timeout=5000; BEGIN IMMEDIATE');
			const source = database.prepare('SELECT password_hash FROM access_accounts WHERE username=?').get('admin');
			if (!source?.password_hash) throw new Error('Missing original account');
			const now = Date.now();
			database.prepare('INSERT INTO access_accounts(username,password_hash,created_at,updated_at) VALUES (?,?,?,?)').run('ticket-other-user', source.password_hash, now, now);
			database.exec('COMMIT');
		} finally { database.close(); }
	`,
			f.database,
		]);
		const otherLogin = await f.anonymous('POST', '/api/v1/auth/login', {
			username: 'ticket-other-user',
			password: f.password,
			rememberMe: false,
		});
		expectStatus(otherLogin, 200);
		const otherCookie = otherLogin.headers['set-cookie'].map((value) => value.split(';')[0]).join('; ');
		assert.ok(otherCookie);
		const rejected = rawPeerFor(ticket, { Cookie: otherCookie });
		await rejected.closed;
		assert.equal(rejected.upgradeStatus, 401);
		const anotherLogin = await f.anonymous('POST', '/api/v1/auth/login', {
			username: 'admin',
			password: f.password,
			rememberMe: false,
		});
		expectStatus(anotherLogin, 200);
		const anotherCookie = anotherLogin.headers['set-cookie'].map((value) => value.split(';')[0]).join('; ');
		assert.deepEqual(await rawPeerFor(ticket, { Cookie: anotherCookie }).closed, {
			code: 1008,
			reason: 'invalid_input',
		});
		await openCleanPath(rawPeerFor(ticket));
	},
);

test('RDP rejects unknown, oversized and expired tickets', { timeout: 60_000 }, async (t) => {
	const { f, services, rawPeerFor } = await openDesktopManagement(t, 'session-expiry');
	assert.deepEqual(await rawPeerFor(randomBytes(32).toString('base64url')).closed, {
		code: 1008,
		reason: 'invalid_input',
	});
	const oversized = rawPeerFor('x'.repeat(257));
	await oversized.closed;
	assert.equal(oversized.upgradeStatus, 401);
	const id = await createRdp(f, services, 'Expiring RDP ticket');
	const ticket = await issueOnce(f, services, id);
	// Like the original controlled backend clock, change Date only; TCP and TLS timers stay real.
	t.mock.timers.enable({ apis: ['Date'], now: Date.now() });
	try {
		t.mock.timers.tick(31_000);
		assert.deepEqual(await rawPeerFor(ticket).closed, { code: 1008, reason: 'invalid_input' });
	} finally {
		t.mock.timers.reset();
	}
});
