import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { createServer } from '../../packages/frontend/node_modules/vite/dist/node/index.js';
import {
	readDownloadTicketResponse,
	readWorkspaceTransferHttpError,
} from '../../packages/shared/dist/remote/transfers/http-codec.js';

const requirePlaywright = createRequire(new URL('../e2e/package.json', import.meta.url));
const { chromium } = requirePlaywright('@playwright/test');
const directory = await mkdtemp(join(tmpdir(), 'nexus-f1-workspace-download-'));
let vite;
let browser;
try {
	const ticket = { url: '/api/v1/sftp/download?ticket=fixture.secret', expiresInSeconds: 300 };
	assert.deepEqual(readDownloadTicketResponse({ ...ticket, password: 'discard' }), ticket);
	let codecChecks = 1;
	for (const url of [
		'https://elsewhere.test/api/v1/sftp/download?ticket=x',
		'//elsewhere.test/x',
		'/api/v1/sftp/download?ticket=x&other=y',
		'/api/v1/sftp/download?ticket=x#fragment',
		'/api/v1/sftp/download-directory?ticket=x',
		'/api/v1/sftp/download?ticket=%0A',
	]) {
		assert.throws(() => readDownloadTicketResponse({ ...ticket, url }));
		codecChecks++;
	}
	for (const expiresInSeconds of [0, 301, '300', null]) {
		assert.throws(() => readDownloadTicketResponse({ ...ticket, expiresInSeconds }));
		codecChecks++;
	}
	assert.throws(() => readWorkspaceTransferHttpError({ message: 'raw diagnostic' }));
	assert.throws(() => readWorkspaceTransferHttpError({ message: 'not_found', code: 'not_found' }));
	codecChecks += 2;
	assert.deepEqual(readWorkspaceTransferHttpError({ code: 'invalid_body' }), { code: 'invalid_body' });
	codecChecks++;
	vite = await createServer({
		root: fileURLToPath(new URL('../../packages/frontend', import.meta.url)),
		configFile: fileURLToPath(new URL('../../packages/frontend/vite.config.ts', import.meta.url)),
		cacheDir: join(directory, 'vite-cache'),
		logLevel: 'error',
		server: { host: '127.0.0.1', port: 0 },
		plugins: [
			{
				name: 'workspace-download-page',

				configureServer(server) {
					server.middlewares.use('/__c2_download', (_request, response) => {
						response.setHeader('Content-Type', 'text/html');
						response.end('<!doctype html><title>Download boundaries</title>');
					});
				},
			},
		],
	});
	await vite.listen();
	browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
	const page = await browser.newPage();
	await page.goto('http://127.0.0.1:' + vite.httpServer.address().port + '/__c2_download');
	const checks = await page.evaluate(async () => {
		const { createFilesystemDownloadPort } = await import('/src/runtimes/workspace/adapters/download-adapters.ts');
		const originalFetch = window.fetch;
		const checks = [];
		const ticket = { url: '/api/v1/sftp/download?ticket=fixture.secret', expiresInSeconds: 300 };
		let calls = 0;
		let available = false;
		const download = createFilesystemDownloadPort('original-workspace', 7, () => available);

		const expect = (condition, label) => {
			if (!condition) throw Error(label);
			checks.push(label);
		};

		const fails = async (operation, code, label) => {
			await operation.then(
				() => {
					throw Error(label + ': unexpectedly succeeded');
				},
				(error) => expect(error.code === code && !error.outcomeUnknown, label),
			);
		};

		const respond = (body, status = 201, headers = {}) => {
			window.fetch = async (_url, input) => {
				calls++;
				if (input.credentials !== 'same-origin' || input.redirect !== 'error') throw Error('unsafe fetch');
				return new Response(JSON.stringify(body), {
					status,
					headers: { 'Content-Type': 'application/json', ...headers },
				});
			};
		};

		try {
			respond(ticket);
			await fails(download.createDownload('/seed', 'file'), 'not_connected', 'ACK gate rejects before HTTP');
			expect(calls === 0, 'unbound attachment has no dispatch');
			available = true;
			const valid = await download.createDownload('/seed', 'file');
			expect(
				valid.url === ticket.url && Object.keys(valid).join() === 'url',
				'wire projects a narrow application result',
			);
			const beforeDirectory = calls;
			const directory = await download.createDownload('/a b/#?中文', 'directory');
			const url = new URL(directory.url, location.href);
			expect(
				calls === beforeDirectory &&
					url.origin === location.origin &&
					url.searchParams.get('sessionId') === 'original-workspace' &&
					url.searchParams.get('remotePath') === '/a b/#?中文',
				'directory URL encodes the original resource without ticket HTTP',
			);
			await fails(
				download.createDownload('/' + 'x'.repeat(4096), 'directory'),
				'invalid_input',
				'directory path uses real transfer byte capacity',
			);
			respond({ ...ticket, url: 'https://elsewhere.test/file' });
			await fails(
				download.createDownload('/seed', 'file'),
				'protocol_error',
				'arbitrary navigation response is rejected',
			);
			respond(ticket, 200);
			await fails(download.createDownload('/seed', 'file'), 'protocol_error', 'wrong success status is rejected');
			respond({ message: 'not_found' }, 404);
			await fails(download.createDownload('/seed', 'file'), 'not_found', 'finite route failure is mapped');
			respond({ message: 'not_found' }, 503);
			await fails(
				download.createDownload('/seed', 'file'),
				'protocol_error',
				'status and failure code must agree',
			);
			respond({ code: 'body_too_large' }, 413);
			await fails(
				download.createDownload('/seed', 'file'),
				'remote_unavailable',
				'transport failure envelope is decoded independently',
			);
			respond({ code: 'invalid_body' }, 400);
			await fails(
				download.createDownload('/seed', 'file'),
				'remote_unavailable',
				'transport body rejection is finite',
			);
			respond({ message: 'vendor diagnostic' }, 503);
			await fails(
				download.createDownload('/seed', 'file'),
				'protocol_error',
				'technical failure text never escapes',
			);
			respond({ ...ticket, extra: 'x'.repeat(33 * 1024) });
			await fails(
				download.createDownload('/seed', 'file'),
				'protocol_error',
				'actual response bytes stay bounded',
			);
			respond(ticket, 201, { 'Content-Type': 'text/html' });
			await fails(
				download.createDownload('/seed', 'file'),
				'protocol_error',
				'unexpected media type is rejected',
			);
			const beforeFailure = calls;
			window.fetch = async () => {
				calls++;
				throw new TypeError('isolated network failure');
			};
			await fails(download.createDownload('/seed', 'file'), 'remote_unavailable', 'network failure is safe');
			expect(calls === beforeFailure + 1, 'failed ticket request is not automatically retried');
			window.fetch = async () => {
				calls++;
				return new Response(
					new ReadableStream({
						start(controller) {
							controller.error(new TypeError('isolated response interruption'));
						},
					}),
					{ status: 201, headers: { 'Content-Type': 'application/json' } },
				);
			};
			await fails(
				download.createDownload('/seed', 'file'),
				'remote_unavailable',
				'interrupted ticket body is not a successful delivery',
			);
			const aborted = new AbortController();
			aborted.abort();
			const beforeAbort = calls;
			await fails(
				download.createDownload('/seed', 'file', aborted.signal),
				'not_connected',
				'pre-abort does not issue a ticket',
			);
			expect(calls === beforeAbort, 'pre-abort has no dispatch');
			let deliver;
			let dispatched;
			const started = new Promise((resolve) => {
				dispatched = resolve;
			});
			window.fetch = async () => {
				calls++;
				dispatched();
				return new Promise((resolve) => {
					deliver = resolve;
				});
			};
			const late = download.createDownload('/seed', 'file');
			await started;
			download.disconnect();
			deliver(
				new Response(JSON.stringify(ticket), { status: 201, headers: { 'Content-Type': 'application/json' } }),
			);
			await fails(late, 'not_connected', 'late response cannot escape its original attachment');
			respond(ticket);
			expect(
				(await download.createDownload('/seed', 'file')).url === ticket.url,
				'new attachment lifetime permits explicit new reads',
			);
			download.dispose();
			const beforeDispose = calls;
			await fails(download.createDownload('/seed', 'file'), 'not_connected', 'disposed owner stays closed');
			expect(calls === beforeDispose, 'dispose cannot reopen transport');
			return checks;
		} finally {
			download.dispose();
			window.fetch = originalFetch;
		}
	});
	console.log(`Download boundaries: ${codecChecks} codec + ${checks.length} browser checks PASS`);
	console.log(checks.join('\n'));
} finally {
	const failures = [];
	for (const close of [
		() => browser?.close(),
		() => vite?.close(),
		() => rm(directory, { recursive: true, force: true }),
	]) {
		try {
			await close();
		} catch (error) {
			failures.push(error);
		}
	}
	if (failures.length) throw new AggregateError(failures, 'Download fixture cleanup failed');
}
