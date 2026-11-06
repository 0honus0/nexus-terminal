import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import { expect, test } from '../../support/fixtures';
import { loginAsInitialAdmin } from '../../support/auth';
import { readAuditResponse } from '../../../../packages/shared/src/operations/http-codec';
import { readConnectionList } from '../../../../packages/shared/src/targets/connections/http-codec';
import { E2E_URLS } from '../../support/test-env';

test('Fastify transport preserves parsing, delivery, admission and maintenance lifecycle', async ({}, testInfo) => {
	test.setTimeout(120_000);
	const result = await promisify(execFile)(
		process.execPath,
		[
			'--test',
			'--test-concurrency=1',
			'--test-reporter=tap',
			path.resolve(__dirname, '../../../backend/http/backend-next-fastify.integration.mjs'),
			path.resolve(__dirname, '../../../backend/http/backend-next-http-resource-delivery.integration.mjs'),
			path.resolve(__dirname, '../../../backend/http/backend-next-multipart.integration.mjs'),
			path.resolve(__dirname, '../../../backend/http/backend-next-json-serialization.integration.mjs'),
			path.resolve(__dirname, '../../../backend/http/backend-next-preferences-serialization.integration.mjs'),
			path.resolve(__dirname, '../../../backend/http/backend-next-agent-serializer.integration.mjs'),
		],
		{ timeout: 90_000, maxBuffer: 1024 * 1024 },
	).catch(async (error: unknown) => {
		if (error instanceof Error && 'stdout' in error && typeof error.stdout === 'string') {
			await testInfo.attach('fastify-transport.stdout', { body: error.stdout, contentType: 'text/plain' });
		}
		if (error instanceof Error && 'stderr' in error && typeof error.stderr === 'string') {
			await testInfo.attach('fastify-transport.stderr', { body: error.stderr, contentType: 'text/plain' });
		}
		throw error;
	});
	await testInfo.attach('fastify-transport.stdout', { body: result.stdout, contentType: 'text/plain' });
	await testInfo.attach('fastify-transport.stderr', { body: result.stderr, contentType: 'text/plain' });
	expect(result.stdout).toContain('# fail 0');
	expect(result.stdout).toContain('# cancelled 0');
	expect(result.stdout).toContain('# skipped 0');
	expect(result.stdout).toContain('Fastify preserves strict JSON');
	expect(result.stdout).toContain('restore owner can drain, rebuild and reply');
});

test('application writes authenticate before parsing and preserve failed-mutation audit', async ({ request }) => {
	await loginAsInitialAdmin(request);
	const before = await request.get('/api/v1/targets/connections');
	expect(before.status()).toBe(200);
	const connections = readConnectionList(await before.json());
	const logout = await request.post('/api/v1/auth/logout', { headers: { Origin: E2E_URLS.frontendOrigin } });
	expect(logout.status()).toBe(200);
	const response = await request.post('/api/v1/targets/connections', {
		headers: { Origin: E2E_URLS.frontendOrigin, 'Content-Type': 'application/json' },
		data: '{',
	});
	expect(response.status()).toBe(401);
	expect(await response.json()).toEqual({ code: 'unauthenticated' });

	await loginAsInitialAdmin(request);
	const after = await request.get('/api/v1/targets/connections');
	expect(after.status()).toBe(200);
	expect(readConnectionList(await after.json())).toEqual(connections);
	await expect
		.poll(async () => {
			const audit = await request.get(
				'/api/v1/settings/audit-logs?event=HTTP_MUTATION_FAILED&limit=100&offset=0',
			);
			expect(audit.status()).toBe(200);
			return readAuditResponse(await audit.json()).items;
		})
		.toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					event: 'HTTP_MUTATION_FAILED',
					route: '/api/v1/targets/connections',
					statusCode: 401,
					userId: null,
				}),
			]),
		);
});
