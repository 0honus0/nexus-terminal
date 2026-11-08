import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdir, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openManagement } from '../../../../support/http/management-fixture.mjs';
import { expectStatus, until } from '../../../../support/protocols/openssh-fixture.mjs';
import { readAuditResponse } from '../../../../../packages/shared/dist/operations/http-codec.js';
import { readConnectionList } from '../../../../../packages/shared/dist/targets/connections/http-codec.js';
import {
	readPreferencesResponse,
	readPresentationUpdateResponse,
} from '../../../../../packages/shared/dist/preferences/presentation/http-codec.js';

const origin = 'http://127.0.0.1:0';
const host = new URL(origin).host;
const path = '/api/v1/settings/preferences';
const cases = [
	[
		'public same-origin browser mutation succeeds',
		{ Host: host, Origin: origin, 'Sec-Fetch-Site': 'same-origin' },
		null,
	],
	['positive same-origin metadata without Origin succeeds', { Host: host, 'Sec-Fetch-Site': 'same-origin' }, null],
	['direct unconfigured backend Host is rejected', { Origin: origin }, 'invalid_host'],
	['missing Origin and Fetch Metadata rejects', { Host: host }, 'csrf_rejected'],
	['foreign Origin rejects', { Host: host, Origin: 'https://foreign.invalid' }, 'csrf_rejected'],
	['opaque null Origin rejects', { Host: host, Origin: 'null' }, 'csrf_rejected'],
	['Origin containing a path rejects', { Host: host, Origin: origin + '/untrusted' }, 'csrf_rejected'],
	[
		'cross-site overrides matching Origin',
		{ Host: host, Origin: origin, 'Sec-Fetch-Site': 'cross-site' },
		'csrf_rejected',
	],
	['same-site metadata without Origin rejects', { Host: host, 'Sec-Fetch-Site': 'same-site' }, 'csrf_rejected'],
];

await test('Real application mutation source policy preserves authenticated SQLite state', async (t) => {
	const artifactRoot = process.env.NEXUS_TEST_ARTIFACT_DIR ?? tmpdir();
	await mkdir(artifactRoot, { recursive: true });
	const directory = await mkdtemp(join(artifactRoot, 'source-policy-'));
	const f = await openManagement(directory);
	t.after(() => f.close());
	for (const [name, headers, code] of cases) {
		await t.test(name, async () => {
			const original = readPreferencesResponse(expectStatus(await f.api('GET', path), 200));
			const preferences = {
				...original.preferences,
				language: original.preferences.language === 'en-US' ? 'zh-CN' : 'en-US',
			};
			const response = await f.requestWithHeaders(
				'PUT',
				path,
				{
					expectedVersion: original.version,
					preferences,
				},
				headers,
			);
			const value = expectStatus(response, code === null ? 200 : 403);
			if (code === null) {
				const saved = readPresentationUpdateResponse(value);
				assert.equal(saved.version, original.version + 1);
				assert.equal(saved.value.preferences.language, preferences.language);
			} else {
				assert.deepEqual(value, { code });
			}
			const current = readPreferencesResponse(expectStatus(await f.api('GET', path), 200));
			assert.deepEqual(current.preferences, code === null ? preferences : original.preferences);
			assert.equal(current.version, original.version + (code === null ? 1 : 0));
		});
	}
	await t.test(
		'writes authenticate before parsing malformed JSON and audit the unauthenticated failure',
		async () => {
			const targets = '/api/v1/targets/connections';
			const before = readConnectionList(expectStatus(await f.api('GET', targets), 200));
			expectStatus(await f.api('POST', '/api/v1/auth/logout'), 200);
			assert.deepEqual(
				expectStatus(
					await f.requestWithHeaders('POST', targets, Buffer.from('{'), {
						Host: host,
						Origin: origin,
					}),
					401,
				),
				{ code: 'unauthenticated' },
			);
			await f.login();
			assert.deepEqual(readConnectionList(expectStatus(await f.api('GET', targets), 200)), before);
			await until(
				async () =>
					readAuditResponse(
						expectStatus(
							await f.api(
								'GET',
								'/api/v1/settings/audit-logs?event=HTTP_MUTATION_FAILED&limit=100&offset=0',
							),
							200,
						),
					).items,
				(items) =>
					items.some(
						(item) =>
							item.event === 'HTTP_MUTATION_FAILED' &&
							item.route === targets &&
							item.statusCode === 401 &&
							item.userId === null,
					),
				'Durable failed mutation audit with no authenticated actor',
			);
		},
	);
});
