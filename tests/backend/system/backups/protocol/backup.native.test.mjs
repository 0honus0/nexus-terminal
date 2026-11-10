import assert from 'node:assert/strict';
import { test } from 'node:test';
import { randomBytes, randomUUID } from 'node:crypto';
import { request } from 'node:http';
import { mkdtemp, mkdir, writeFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createApp } from '../../../../../packages/backend/dist/bootstrap/create-app.js';
import { MachineMutationService } from '../../../../../packages/backend/dist/modules/remote/machines/service/mutation-service.js';
import { SealedBytes } from '../../../../../packages/backend/dist/platform/security/sealed-bytes.js';
import { BACKUP_MAX_SNAPSHOT_BYTES } from '../../../../../packages/shared/dist/system/backups/values.js';
import { openSshManagement } from '../../../../support/http/management-fixture.mjs';
import { openSshd, origin, send, until, expectStatus } from '../../../../support/protocols/openssh-fixture.mjs';

const sourcePassword = 'isolated-management-b10-password-123';
const destinationPassword = 'isolated-destination-password-456';

function multipart(parts) {
	const boundary = 'b10-' + randomUUID();
	const chunks = [];
	for (const part of parts) {
		chunks.push(
			Buffer.from(
				'--' +
					boundary +
					'\r\nContent-Disposition: form-data; name="' +
					part.name +
					'"' +
					(part.filename === undefined ? '' : '; filename="' + part.filename + '"') +
					'\r\n\r\n',
			),
		);
		chunks.push(Buffer.isBuffer(part.bytes) ? part.bytes : Buffer.from(part.bytes));
		chunks.push(Buffer.from('\r\n'));
	}
	chunks.push(Buffer.from('--' + boundary + '--\r\n'));
	return { bytes: Buffer.concat(chunks), headers: { 'Content-Type': 'multipart/form-data; boundary=' + boundary } };
}

function heldRequest(address, cookie, path, bytes, headers) {
	let req;
	const result = new Promise((resolve, reject) => {
		req = request(
			'http://' + address + path,
			{
				method: 'POST',
				headers: {
					Host: new URL(origin).host,
					Origin: origin,
					Cookie: cookie,
					...headers,
					'Content-Length': bytes.length,
				},
			},
			(response) => {
				const chunks = [];
				response.on('data', (chunk) => chunks.push(chunk));
				response.on('error', reject);
				response.on('end', () => resolve({ status: response.statusCode, bytes: Buffer.concat(chunks) }));
			},
		);
		req.on('error', reject);
		req.setTimeout(15000, () => req.destroy(new Error('Held request deadline')));
		req.write(bytes.subarray(0, 1));
	});
	// Attach the observer before cancellation can reject the request.
	void result.catch(() => undefined);
	return {
		result,

		finish: () => req.end(bytes.subarray(1)),

		abort: () => req.destroy(new Error('Fixture cancelled upload')),
	};
}

function heldExport(address, cookie, password) {
	return heldRequest(address, cookie, '/api/v1/settings/backup/export', Buffer.from(JSON.stringify({ password })), {
		'Content-Type': 'application/json',
	});
}

function heldImport(address, cookie, archive, password) {
	const body = multipart([
		{ name: 'backupFile', filename: 'held.nexus-backup', bytes: archive },
		{ name: 'password', bytes: password },
	]);
	return heldRequest(address, cookie, '/api/v1/settings/backup/import', body.bytes, body.headers);
}

await test('B10 cross-instance sealed backup, actual SSH secrets', { timeout: 120000 }, async (t) => {
	const root = await mkdtemp(join(process.env.NEXUS_TEST_ARTIFACT_DIR ?? tmpdir(), 'nexus-b10-backup-'));
	let sshd;
	let source;
	let destination;
	let address;
	let cookie = '';
	let archive;
	let archiveTableCount;
	let command;
	const targetKey = randomBytes(32);
	const targetDatabase = join(root, 'target.db');
	const sourceDirectory = join(root, 'source');

	const api = (method, path, input, headers) => send(address, cookie, method, path, input, headers);

	const login = (password) => api('POST', '/api/v1/auth/login', { username: 'admin', password, rememberMe: false });

	async function boot() {
		destination = await createApp(targetDatabase, { encryptionKey: targetKey });
		address = await destination.listenHttp({
			publicOrigin: origin,
			bindHost: '127.0.0.1',
			port: 0,
			trustedProxies: [],
		});
	}

	async function restore(bytes, password, extra = []) {
		const body = multipart([
			{ name: 'backupFile', filename: 'b10.nexus-backup', bytes },
			...(password === undefined ? [] : [{ name: 'password', bytes: password }]),
			...extra,
		]);
		return api('POST', '/api/v1/settings/backup/import', body.bytes, body.headers);
	}

	async function unchanged() {
		assert.equal(expectStatus(await api('GET', '/api/v1/auth/status'), 200).isAuthenticated, true);
		assert.deepEqual(expectStatus(await api('GET', '/api/v1/quick-commands'), 200).entries, [command]);
	}

	try {
		await mkdir(sourceDirectory);
		sshd = await openSshd(root);
		source = await openSshManagement(sourceDirectory, sshd);
		const preferences = expectStatus(await source.api('GET', '/api/v1/settings/preferences'), 200);
		expectStatus(
			await source.api('PUT', '/api/v1/settings/preferences', {
				expectedVersion: preferences.version,
				preferences: { ...preferences.preferences, showPopupFileManager: true },
			}),
			200,
		);
		const sourceFiles = await readdir(sourceDirectory);
		for (const name of ['appearance']) {
			assert.ok(sourceFiles.includes(name), 'Data directory must contain ' + name);
			assert.ok(!sourceFiles.includes('state.db.' + name), 'Legacy resource directory must not be created');
		}
		await boot();
		expectStatus(
			await api('POST', '/api/v1/auth/setup', {
				username: 'admin',
				password: destinationPassword,
				confirmPassword: destinationPassword,
			}),
			201,
		);
		const authenticated = await login(destinationPassword);
		expectStatus(authenticated, 200);
		cookie = authenticated.headers['set-cookie'].map((value) => value.split(';')[0]).join('; ');
		command = expectStatus(
			await api('POST', '/api/v1/quick-commands', {
				name: 'destination sentinel',
				command: 'pwd',
				variables: {},
				tagIds: [],
			}),
			201,
		).command;

		await t.test('portable export seals source settings and credentials', async () => {
			const exported = await source.api('POST', '/api/v1/settings/backup/export', {
				password: sourcePassword,
			});
			expectStatus(exported, 200);
			archive = exported.bytes;
			assert.equal(archive.subarray(0, 9).toString('ascii'), 'NXSEALED2');
			assert.match(exported.headers['content-disposition'], /\.nexus-backup/);
			assert.equal(exported.headers['cache-control'], 'no-store');
			assert.equal(Number(exported.headers['content-length']), archive.length);
			assert.equal(archive.includes(Buffer.from('isolated-secret')), false);
			// Compare the receipt to the actual portable archive, including the important
			// resource owners. A stale total must not stand in for complete schema coverage.
			const decoded = await new SealedBytes(BACKUP_MAX_SNAPSHOT_BYTES, null).decode(archive, sourcePassword);
			try {
				const snapshot = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(decoded));
				assert.equal(snapshot.format, 'registered-snapshot');
				assert.ok(Array.isArray(snapshot.tables));
				const names = snapshot.tables.map((table) => table.name);
				assert.equal(new Set(names).size, names.length);
				for (const name of [
					'operations_logging',
					'remote_desktop_certificates',
					'operations_notification_pending',
				]) {
					assert.ok(names.includes(name), 'Portable backup includes ' + name);
				}
				archiveTableCount = names.length;
			} finally {
				decoded.fill(0);
			}
		});
		for (const [name, password] of [
			['missing source password', undefined],
			['wrong source password', 'incorrect-backup-password'],
			['destination login password is not backup password', destinationPassword],
		]) {
			await t.test(name + ' rejects before changing destination', async () => {
				assert.equal(expectStatus(await restore(archive, password), 401).code, 'invalid_password');
				await unchanged();
			});
		}
		await t.test('tampered portable ciphertext leaves destination intact', async () => {
			const damaged = Buffer.from(archive);
			damaged[damaged.length - 1] ^= 1;
			assert.equal(expectStatus(await restore(damaged, sourcePassword), 401).code, 'invalid_password');
			await unchanged();
		});
		for (const [name, parts] of [
			['unknown multipart field', [{ name: 'unknown', bytes: 'value' }]],
			['duplicate backup file', [{ name: 'backupFile', filename: 'duplicate', bytes: archive }]],
			['duplicate password', [{ name: 'password', bytes: sourcePassword }]],
		]) {
			await t.test(name + ' rejects without maintenance or state change', async () => {
				assert.equal(expectStatus(await restore(archive, sourcePassword, parts), 400).code, 'invalid_input');
				await unchanged();
			});
		}
		await t.test(
			'cross-instance import replaces product state and preserves destination session/listener',
			async () => {
				const restored = expectStatus(await restore(archive, sourcePassword), 200);
				assert.equal(restored.restoredTables, archiveTableCount);
				assert.ok(restored.restoredRows > 0);
				assert.equal(restored.restoredFiles, 0);
				assert.equal(restored.cleanupPending, false);
				assert.equal(
					expectStatus(await api('GET', '/api/v1/settings/preferences'), 200).preferences
						.showPopupFileManager,
					true,
				);
				assert.deepEqual(expectStatus(await api('GET', '/api/v1/quick-commands'), 200).entries, []);
				assert.equal(expectStatus(await api('GET', '/api/v1/auth/status'), 200).isAuthenticated, true);
			},
		);
		await t.test('restored SSH private key and host trust actually authenticate to original daemon', async () => {
			const path = join(root, 'real-ssh-content.txt');
			const text = 'restored private key works\n恢复';
			await writeFile(path, text);
			const resource = expectStatus(
				await api('POST', '/api/v1/remote/files/resources', { targetId: source.connectionId }),
				201,
			);
			try {
				assert.equal(
					expectStatus(
						await api('POST', '/api/v1/remote/files/resources/' + resource.id + '/read-text', {
							path,
						}),
						200,
					).text,
					text,
				);
			} finally {
				expectStatus(await api('DELETE', '/api/v1/remote/files/resources/' + resource.id), 200);
			}
		});
		await t.test('destination password remains authoritative while source password cannot log in', async () => {
			expectStatus(await login(sourcePassword), 401);
			expectStatus(await login(destinationPassword), 200);
			assert.equal(expectStatus(await api('GET', '/api/v1/auth/status'), 200).isAuthenticated, true);
		});
		await t.test('unauthenticated import/export cannot read or replace product state', async () => {
			expectStatus(
				await send(address, '', 'POST', '/api/v1/settings/backup/export', {
					password: destinationPassword,
				}),
				401,
			);
			const body = multipart([{ name: 'backupFile', filename: 'b10', bytes: archive }]);
			expectStatus(
				await send(address, '', 'POST', '/api/v1/settings/backup/import', body.bytes, body.headers),
				401,
			);
		});
		await t.test('held raw import body occupies the shared slot; cancellation releases it for export', async () => {
			const held = heldImport(address, cookie, archive, sourcePassword);
			try {
				await until(
					() => api('POST', '/api/v1/settings/backup/export', { password: destinationPassword }),
					(response) => response.status === 409 && response.body.code === 'busy',
					'Held import admission',
				);
				assert.equal(expectStatus(await restore(archive, sourcePassword), 409).code, 'busy');
			} finally {
				held.abort();
				await assert.rejects(held.result, /Fixture cancelled upload/u);
			}
			const exported = await until(
				() => api('POST', '/api/v1/settings/backup/export', { password: destinationPassword }),
				(response) => response.status === 200,
				'Admission released after aborted import',
			);
			assert.equal(exported.bytes.subarray(0, 9).toString('ascii'), 'NXSEALED2');
		});
		await t.test('logout while export body is pending revokes authorization before archive delivery', async () => {
			const held = heldExport(address, cookie, destinationPassword);
			try {
				// Native JSON parsing completes before the export enters the business scope.
				const exported = await api('POST', '/api/v1/settings/backup/export', {
					password: destinationPassword,
				});
				expectStatus(exported, 200);
				assert.equal(exported.bytes.subarray(0, 9).toString('ascii'), 'NXSEALED2');
				expectStatus(await api('POST', '/api/v1/auth/logout', {}), 200);
				held.finish();
				const response = await held.result;
				assert.equal(response.status, 401);
				assert.deepEqual(JSON.parse(response.bytes.toString('utf8')), { code: 'unauthenticated' });
			} finally {
				held.abort();
				const authenticated = await login(destinationPassword);
				expectStatus(authenticated, 200);
				cookie = authenticated.headers['set-cookie'].map((value) => value.split(';')[0]).join('; ');
			}
		});
		await t.test('restored files and destination-encrypted secrets survive actual rebuild', async () => {
			await destination.close();
			destination = null;
			await boot();
			expectStatus(await api('GET', '/api/v1/auth/status'), 200);
			const resource = expectStatus(
				await api('POST', '/api/v1/remote/files/resources', { targetId: source.connectionId }),
				201,
			);
			expectStatus(await api('DELETE', '/api/v1/remote/files/resources/' + resource.id), 200);
			const exported = await api('POST', '/api/v1/settings/backup/export', { password: destinationPassword });
			expectStatus(exported, 200);
			assert.equal(exported.bytes.subarray(0, 9).toString('ascii'), 'NXSEALED2');
		});
		await t.test(
			'Committed restore keeps transport paused after actual owner rebuild failure and restart completes initialization',
			async (child) => {
				const initialize = MachineMutationService.prototype.initialize;
				const failure = new Error('controlled failure after actual restored remote initialization');
				let rebuilt = 0;
				child.mock.method(MachineMutationService.prototype, 'initialize', async function () {
					await initialize.call(this);
					rebuilt += 1;
					throw failure;
				});
				const result = await restore(archive, sourcePassword);
				assert.deepEqual(expectStatus(result, 503), { code: 'unavailable' });
				assert.equal(rebuilt, 1, 'a failed rebuild is not automatically repeated');
				const db = new DatabaseSync(targetDatabase, { readOnly: true });
				let marker;
				try {
					marker = db.prepare('SELECT restore_id,initialized FROM snapshot_restore_state WHERE id=1').get();
					assert.equal(
						marker.initialized,
						0,
						'committed restoration retains its unfinished initialization marker',
					);
				} finally {
					db.close();
				}
				assert.deepEqual(expectStatus(await api('GET', '/api/v1/auth/status'), 503), {
					code: 'shutting_down',
				});
				child.mock.restoreAll();
				await destination.close();
				destination = null;
				await boot();
				expectStatus(await api('GET', '/api/v1/auth/status'), 200);
				const recovered = new DatabaseSync(targetDatabase, { readOnly: true });
				try {
					assert.deepEqual(
						{
							...recovered
								.prepare('SELECT restore_id,initialized FROM snapshot_restore_state WHERE id=1')
								.get(),
						},
						{ restore_id: marker.restore_id, initialized: 1 },
					);
				} finally {
					recovered.close();
				}
				const resource = expectStatus(
					await api('POST', '/api/v1/remote/files/resources', { targetId: source.connectionId }),
					201,
				);
				expectStatus(await api('DELETE', '/api/v1/remote/files/resources/' + resource.id), 200);
			},
		);
	} finally {
		const failures = [];
		for (const close of [
			() => destination?.close(),
			() => source?.close(),
			() => sshd?.close(),
			() => rm(root, { recursive: true, force: true }),
		]) {
			try {
				await close();
			} catch (error) {
				failures.push(error);
			}
		}
		if (failures.length) throw new AggregateError(failures, 'Backup fixture cleanup failed');
	}
});
