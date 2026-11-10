import assert from 'node:assert/strict';
import { test } from 'node:test';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { request } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../../../../../packages/backend/dist/bootstrap/create-app.js';

import { SealedBytes } from '../../../../../packages/backend/dist/platform/security/sealed-bytes.js';
import { BACKUP_MAX_SNAPSHOT_BYTES } from '../../../../../packages/shared/dist/system/backups/values.js';

const publicOrigin = 'http://127.0.0.1:0';
const password = 'b10-isolated-password-123';

function send(address, method, path, body, cookie = '', headers = {}) {
	const bytes = Buffer.isBuffer(body) ? body : body === undefined ? undefined : Buffer.from(JSON.stringify(body));
	return new Promise((resolve, reject) => {
		const req = request(
			'http://' + address + path,
			{
				method,
				headers: {
					Host: new URL(publicOrigin).host,
					Origin: publicOrigin,
					Cookie: cookie,
					...(bytes ? { 'Content-Type': 'application/json', 'Content-Length': bytes.byteLength } : {}),
					...headers,
				},
			},
			(response) => {
				const chunks = [];
				response.on('data', (chunk) => chunks.push(chunk));
				response.on('error', reject);
				response.on('end', () => {
					try {
						const data = Buffer.concat(chunks);
						resolve({
							status: response.statusCode,
							headers: response.headers,
							bytes: data,
							body: response.headers['content-type']?.includes('application/json')
								? JSON.parse(data.toString('utf8'))
								: null,
						});
					} catch (error) {
						reject(error);
					}
				});
			},
		);
		req.on('error', reject);
		req.setTimeout(15000, () => req.destroy(new Error('B10 HTTP deadline exceeded')));
		req.end(bytes);
	});
}

function expectStatus(response, status) {
	assert.equal(response.status, status, JSON.stringify(response.body));
	return response.body;
}

await test(
	'Installed application preserves HTTP, durable state across restore/restart',
	{ timeout: 60000 },
	async (t) => {
		const directory = await mkdtemp(
			join(process.env.NEXUS_TEST_ARTIFACT_DIR ?? tmpdir(), 'nexus-application-roundtrip-'),
		);
		const started = performance.now();
		const timing = { setupMs: null, executeMs: null, drainMs: null };
		let executing;
		const key = randomBytes(32);
		let app;
		let cookie = '';
		let command;
		let address;

		const api = (method, path, body, headers) => send(address, method, path, body, cookie, headers);

		t.after(async () => {
			timing.executeMs = executing === undefined ? null : performance.now() - executing;
			const draining = performance.now();
			const results = await Promise.allSettled([Promise.resolve().then(() => app?.close())]);
			timing.drainMs = performance.now() - draining;
			await writeFile(join(directory, 'timings.json'), JSON.stringify(timing, null, 2));
			t.diagnostic(JSON.stringify(timing));
			const failures = results.filter((result) => result.status === 'rejected').map((result) => result.reason);
			if (failures.length) throw new AggregateError(failures, 'Application cleanup failed');
		});
		{
			const dbPath = join(directory, 'backend-next.db');
			app = await createApp(dbPath, { encryptionKey: key });
			address = await app.listenHttp({ publicOrigin, bindHost: '127.0.0.1', port: 0, trustedProxies: [] });
			timing.setupMs = performance.now() - started;
			executing = performance.now();

			await t.test(
				'Access denies anonymous/cross-origin writes and issues a real revocable session',
				async () => {
					expectStatus(await api('GET', '/api/v1/quick-commands'), 401);
					assert.equal(expectStatus(await api('GET', '/api/v1/auth/needs-setup'), 200).needsSetup, true);
					assert.equal(
						expectStatus(
							await api(
								'POST',
								'/api/v1/auth/setup',
								{
									username: 'admin',
									password,
									confirmPassword: password,
								},
								{ Origin: 'http://other.invalid' },
							),
							403,
						).code,
						'csrf_rejected',
					);
					expectStatus(
						await api('POST', '/api/v1/auth/setup', {
							username: 'admin',
							password,
							confirmPassword: password,
						}),
						201,
					);
					const login = await api('POST', '/api/v1/auth/login', {
						username: 'admin',
						password,
						rememberMe: false,
					});
					expectStatus(login, 200);
					cookie = login.headers['set-cookie'].map((value) => value.split(';')[0]).join('; ');
					assert.equal(expectStatus(await api('GET', '/api/v1/auth/status'), 200).isAuthenticated, true);
				},
			);

			await t.test('Preferences normalizes tag input and enforces command CAS and usage', async () => {
				const tag = expectStatus(await api('POST', '/api/v1/quick-command-tags', { name: '  ops  ' }), 201).tag;
				assert.equal(tag.name, 'ops');
				const input = { name: 'B10 command', command: 'printf hello', variables: {}, tagIds: [tag.id] };
				command = expectStatus(await api('POST', '/api/v1/quick-commands', input), 201).command;
				const incremented = expectStatus(
					await api('POST', `/api/v1/quick-commands/${command.id}/increment-usage`, {
						expectedVersion: command.version,
					}),
					200,
				).command;
				assert.equal(incremented.usageCount, 1);
				assert.equal(incremented.version, command.version + 1);
				assert.equal(
					expectStatus(
						await api('PUT', `/api/v1/quick-commands/${command.id}`, {
							...input,
							expectedVersion: command.version,
						}),
						409,
					).code,
					'version_conflict',
				);
				const listed = expectStatus(await api('GET', '/api/v1/quick-commands'), 200);
				assert.deepEqual(listed.entries, [incremented]);
				command = incremented;
			});

			await t.test(
				'encrypted backup imports through real maintenance and rebinds the existing HTTP listener',
				async () => {
					assert.equal(
						expectStatus(
							await api('POST', '/api/v1/settings/backup/export', { password: 'incorrect-password' }),
							401,
						).code,
						'invalid_password',
					);
					assert.deepEqual(expectStatus(await api('GET', '/api/v1/settings/logging'), 200), {
						version: 0,
						level: 'info',
						effectiveLevel: 'info',
						updatedAt: 0,
					});
					const exported = await api('POST', '/api/v1/settings/backup/export', { password });
					expectStatus(exported, 200);
					assert.equal(exported.bytes.subarray(0, 9).toString('ascii'), 'NXSEALED2');
					expectStatus(
						await api('POST', '/api/v1/quick-commands', {
							name: 'after snapshot',
							command: 'pwd',
							variables: {},
							tagIds: [],
						}),
						201,
					);
					const boundary = 'b10-' + randomUUID();
					const multipart = Buffer.concat([
						Buffer.from(
							'--' +
								boundary +
								'\r\nContent-Disposition: form-data; name="backupFile"; filename="b10.nexus-backup"\r\nContent-Type: application/octet-stream\r\n\r\n',
						),
						exported.bytes,
						Buffer.from('\r\n--' + boundary + '--\r\n'),
					]);
					const corrupted = Buffer.from(multipart);
					const payloadOffset = multipart.indexOf(exported.bytes);
					assert.ok(payloadOffset > 0);
					corrupted[payloadOffset + exported.bytes.length - 1] ^= 1;
					assert.equal(
						expectStatus(
							await api('POST', '/api/v1/settings/backup/import', corrupted, {
								'Content-Type': 'multipart/form-data; boundary=' + boundary,
							}),
							401,
						).code,
						'invalid_password',
					);
					assert.equal(expectStatus(await api('GET', '/api/v1/quick-commands'), 200).entries.length, 2);
					const restored = expectStatus(
						await api('POST', '/api/v1/settings/backup/import', multipart, {
							'Content-Type': 'multipart/form-data; boundary=' + boundary,
						}),
						200,
					);
					const decoded = await new SealedBytes(BACKUP_MAX_SNAPSHOT_BYTES, null).decode(
						exported.bytes,
						password,
					);
					try {
						const snapshot = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(decoded));
						assert.equal(snapshot.format, 'registered-snapshot');
						assert.ok(snapshot.tables.length > 0);
						assert.equal(new Set(snapshot.tables.map((table) => table.name)).size, snapshot.tables.length);
						assert.equal(restored.restoredTables, snapshot.tables.length);
					} finally {
						decoded.fill(0);
					}
					assert.ok(restored.restoredRows > 0);
					assert.equal(typeof restored.cleanupPending, 'boolean');
					assert.deepEqual(expectStatus(await api('GET', '/api/v1/quick-commands'), 200).entries, [command]);
					assert.equal(expectStatus(await api('GET', '/api/v1/auth/status'), 200).isAuthenticated, true);
				},
			);

			await t.test('restart preserves personal state and revokes the logged-out session', async () => {
				await app.close();
				app = await createApp(dbPath, { encryptionKey: key });
				address = await app.listenHttp({
					publicOrigin,
					bindHost: '127.0.0.1',
					port: 0,
					trustedProxies: [],
				});
				assert.deepEqual(expectStatus(await api('GET', '/api/v1/quick-commands'), 200).entries, [command]);
				expectStatus(await api('POST', '/api/v1/auth/logout'), 200);
				expectStatus(await api('GET', '/api/v1/auth/status'), 401);
				expectStatus(await api('GET', '/api/v1/quick-commands'), 401);
			});
		}
	},
);
