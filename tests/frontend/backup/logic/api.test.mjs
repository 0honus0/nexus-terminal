// @vitest-environment jsdom
import { Blob, File } from 'node:buffer';
import { afterEach, beforeAll, afterAll, expect, test, vi } from 'vitest';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { backupApi } from '../../../../packages/frontend/src/features/backup/api/backup-api.ts';
import { BackupRequestFailure } from '../../../../packages/frontend/src/features/backup/model/backup-types.ts';
import { BACKUP_MAX_FILE_BYTES } from '../../../../packages/shared/src/system/backups/values.ts';
import { requestBinary } from '../../../../packages/frontend/src/client/http/binary-client.ts';
import { HttpRequestFailure } from '../../../../packages/frontend/src/client/http/request-failure.ts';

const server = setupServer();
beforeAll(() => server.listen({ onUnhandledFrame: 'error' }));
afterEach(() => {
	server.resetHandlers();
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
});
afterAll(() => server.close());

test('backup preflight rejects invalid files, passwords and cancelled intent without reading or dispatching', async () => {
	vi.stubGlobal('Blob', Blob);
	const dispatch = vi.spyOn(globalThis, 'fetch');
	await expect(backupApi.exportFull('')).rejects.toBeInstanceOf(BackupRequestFailure);
	await expect(backupApi.exportFull('')).rejects.toMatchObject({ code: 'invalid_input', outcome: 'not_dispatched' });
	const oversized = new File(['x'], 'oversized.nexus-backup');
	Object.defineProperty(oversized, 'size', { value: BACKUP_MAX_FILE_BYTES + 1 });
	const read = vi.spyOn(oversized, 'arrayBuffer').mockRejectedValue(Error('Oversized file must not be read'));
	await expect(backupApi.importFull(oversized, null)).rejects.toMatchObject({
		code: 'invalid_input',
		outcome: 'not_dispatched',
	});
	expect(read).not.toHaveBeenCalled();
	const cancelled = new AbortController();
	cancelled.abort();
	await expect(
		backupApi.importFull(new File(['x'], 'cancelled.nexus-backup'), null, cancelled.signal),
	).rejects.toMatchObject({ code: 'cancelled', outcome: 'not_dispatched' });
	const budgets = { maxRequestBytes: 16, maxResponseBytes: 16, maxErrorBytes: 16 };
	await expect(
		requestBinary({ method: 'POST', url: 'https://external.invalid', body: 'x', ...budgets }),
	).rejects.toBeInstanceOf(HttpRequestFailure);
	await expect(
		requestBinary({ method: 'POST', url: 'https://external.invalid', body: 'x', ...budgets }),
	).rejects.toMatchObject({ code: 'invalid_input', outcome: 'not_dispatched' });
	await expect(
		requestBinary({ method: 'POST', url: '/api/v1/status', body: 'x'.repeat(17), ...budgets }),
	).rejects.toMatchObject({ code: 'invalid_input', outcome: 'not_dispatched' });
	expect(dispatch).not.toHaveBeenCalled();
});

test('binary transport rejects response overflow and cancels the actual response body', async () => {
	const cancelled = vi.fn();
	const stream = new ReadableStream({
		start(controller) {
			controller.enqueue(new Uint8Array(33));
		},

		cancel: cancelled,
	});
	vi.stubGlobal(
		'fetch',
		vi.fn().mockResolvedValue(new Response(stream, { headers: { 'content-type': 'application/octet-stream' } })),
	);
	await expect(
		requestBinary({
			method: 'GET',
			url: '/api/v1/controlled-binary',
			maxRequestBytes: 16,
			maxResponseBytes: 32,
			maxErrorBytes: 16,
		}),
	).rejects.toMatchObject({ code: 'protocol_failure', outcome: 'unknown' });
	expect(cancelled).toHaveBeenCalledOnce();
});

test('binary transport rejects declared response overflow without publishing its bytes', async () => {
	server.use(
		http.get(
			'http://localhost/api/v1/controlled-binary',
			() =>
				new HttpResponse('x'.repeat(33), {
					headers: { 'content-type': 'application/octet-stream', 'content-length': '33' },
				}),
		),
	);
	await expect(
		requestBinary({
			method: 'GET',
			url: '/api/v1/controlled-binary',
			maxRequestBytes: 16,
			maxResponseBytes: 32,
			maxErrorBytes: 16,
		}),
	).rejects.toMatchObject({ code: 'protocol_failure', outcome: 'unknown' });
});
