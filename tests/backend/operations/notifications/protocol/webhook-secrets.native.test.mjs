import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openManagement } from '../../../../support/http/management-fixture.mjs';
import { expectStatus, until } from '../../../../support/protocols/openssh-fixture.mjs';
import {
	readNotificationList,
	readNotificationResponse,
	readNotificationDeliveries,
	readOperationsError,
} from '../../../../../packages/shared/dist/operations/http-codec.js';

const base = '/api/v1/settings/notifications';

await test('Webhook secret commands remain atomic through real HTTP, storage and delivery', async (t) => {
	const artifactRoot = process.env.NEXUS_TEST_ARTIFACT_DIR ?? tmpdir();
	await mkdir(artifactRoot, { recursive: true });
	const directory = await mkdtemp(join(artifactRoot, 'webhook-secrets-'));
	const started = performance.now();
	const timing = { setupMs: null, executeMs: null, drainMs: null };
	const calls = [];
	const server = createServer((request, response) => {
		request.resume();
		calls.push(request.headers);
		response.writeHead(204).end();
	});
	let f;
	t.after(async () => {
		const drain = performance.now();
		timing.executeMs = drain - started - (timing.setupMs ?? 0);
		const failures = [];
		try {
			await f?.close();
		} catch (error) {
			failures.push(error);
		}
		try {
			server.closeAllConnections();
			await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
		} catch (error) {
			failures.push(error);
		}
		timing.drainMs = performance.now() - drain;
		await writeFile(join(directory, 'timings.json'), JSON.stringify(timing, null, 2));
		t.diagnostic(JSON.stringify(timing));
		if (failures.length) {
			throw new AggregateError(failures, 'Webhook secret test cleanup failed');
		}
	});
	server.listen(0, '127.0.0.1');
	await once(server, 'listening');
	f = await openManagement(directory);
	timing.setupMs = performance.now() - started;

	const config = () => ({
		kind: 'webhook',
		url: 'http://127.0.0.1:' + server.address().port + '/secrets',
		method: 'POST',
		bodyTemplate: null,
		headers: [
			{ name: 'Authorization', value: { action: 'replace', value: 'Bearer e2e-original' } },
			{ name: 'X-E2E-Private', value: { action: 'replace', value: 'private-original' } },
			{ name: 'X-Public', value: { action: 'replace', value: 'visible' } },
			{ name: 'X-Api-Key', value: { action: 'replace', value: 'key-original' } },
			{ name: 'Cookie', value: { action: 'replace', value: 'cookie-original' } },
		],
	});

	const list = async () => readNotificationList(expectStatus(await f.api('GET', base), 200)).items;

	const keep = { action: 'keep' };
	const replacement = { action: 'replace', value: 'public-replacement' };
	const cases = [
		['all header values are redacted', null],
		[
			'keep resolves original credentials with different casing',
			{
				headers: [
					{ name: 'authorization', value: keep },
					{ name: 'x-e2e-private', value: keep },
					{ name: 'X-Public', value: keep },
				],
			},
			true,
		],
		['null is not a public header command', { headers: [{ name: 'X-Public', value: null }] }],
		['null cannot create a secret header', { headers: [{ name: 'X-New-Secret', value: null }] }],
		['legacy secret classification is rejected', { secretHeaderNames: [] }],
		['invalid names reject atomically', { headers: [{ name: 'invalid header', value: keep }] }],
		[
			'non-string replacement rejects atomically',
			{
				headers: [{ name: 'Authorization', value: { action: 'replace', value: 123 } }],
			},
		],
		[
			'case-colliding edits reject atomically',
			{
				headers: [
					{ name: 'X-E2E-Private', value: replacement },
					{ name: 'x-e2e-private', value: keep },
				],
			},
		],
		[
			'reversed case-colliding edits also reject',
			{
				headers: [
					{ name: 'x-e2e-private', value: keep },
					{ name: 'X-E2E-Private', value: replacement },
				],
			},
		],
	];
	await t.test('create and unsaved delivery reject case collisions without persistence or dispatch', async () => {
		const value = config();
		value.headers.push({ name: 'authorization', value: replacement });
		for (const [path, input] of [
			[base, { name: 'rejected create', enabled: false, events: [], config: value }],
			[base + '/test-unsaved', { config: value }],
		]) {
			assert.equal(
				readOperationsError(expectStatus(await f.api('POST', path, input), 400)).code,
				'invalid_input',
			);
		}
		assert.deepEqual(await list(), []);
		assert.equal(calls.length, 0);
	});
	for (const [name, change, preserve = false] of cases) {
		await t.test(name, async () => {
			const initial = readNotificationResponse(
				expectStatus(
					await f.api('POST', base, {
						name,
						enabled: false,
						events: [],
						config: config(),
					}),
					200,
				),
			).setting;
			assert.equal(initial.config.kind, 'webhook');
			assert.deepEqual(
				initial.config.headers,
				config().headers.map((header) => ({ name: header.name, hasValue: true })),
			);
			for (const secret of [
				'Bearer e2e-original',
				'private-original',
				'key-original',
				'cookie-original',
				'visible',
			]) {
				assert.equal(JSON.stringify(initial).includes(secret), false);
			}
			if (change !== null) {
				const response = await f.api('PUT', base + '/' + initial.id, {
					expectedVersion: initial.version,
					name: name + ' edited',
					enabled: false,
					events: [],
					config: { ...config(), ...change },
				});
				const body = expectStatus(response, preserve ? 200 : 400);
				assert.equal(JSON.stringify(body).includes('private-original'), false);
				if (preserve) {
					assert.equal(readNotificationResponse(body).setting.version, initial.version + 1);
					await f.restart();
				} else {
					assert.equal(readOperationsError(body).code, 'invalid_input');
				}
			}
			const current = (await list()).find((item) => item.id === initial.id);
			assert.ok(current);
			assert.equal(current.name, preserve ? name + ' edited' : name);
			assert.equal(current.version, initial.version + (preserve ? 1 : 0));
			assert.equal(JSON.stringify(current).includes('Bearer e2e-original'), false);
			if (!preserve) {
				assert.deepEqual(current.config, initial.config);
			}
			const before = calls.length;
			const delivery = expectStatus(await f.api('POST', base + '/' + initial.id + '/test', {}), 200).delivery;
			assert.equal(delivery.settingId, initial.id);
			await until(
				async () =>
					readNotificationDeliveries(
						expectStatus(await f.api('GET', '/api/v1/settings/notification-deliveries?limit=100'), 200),
					).items.find((item) => item.id === delivery.id),
				(item) => item?.status === 'sent',
				'Exact original credential delivery',
			);
			assert.equal(calls.length, before + 1);
			assert.equal(calls.at(-1).authorization, 'Bearer e2e-original');
			assert.equal(calls.at(-1)['x-e2e-private'], 'private-original');
			expectStatus(await f.api('DELETE', base + '/' + current.id, { expectedVersion: current.version }), 200);
		});
	}
});
