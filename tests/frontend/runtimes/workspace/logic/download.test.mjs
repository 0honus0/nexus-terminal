// @vitest-environment jsdom
import { test } from 'vitest';

test('download attachment validates tickets, failures and late lifetime results', async () => {
	const { createFilesystemDownloadPort } =
		await import('../../../../../packages/frontend/src/runtimes/workspace/adapters/download-adapters.ts');
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
		const url = new URL(directory.url, window.location.href);
		expect(
			calls === beforeDirectory &&
				url.origin === window.location.origin &&
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
		await fails(download.createDownload('/seed', 'file'), 'protocol_error', 'status and failure code must agree');
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
		await fails(download.createDownload('/seed', 'file'), 'protocol_error', 'technical failure text never escapes');
		respond({ ...ticket, extra: 'x'.repeat(33 * 1024) });
		await fails(download.createDownload('/seed', 'file'), 'protocol_error', 'actual response bytes stay bounded');
		respond(ticket, 201, { 'Content-Type': 'text/html' });
		await fails(download.createDownload('/seed', 'file'), 'protocol_error', 'unexpected media type is rejected');
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
		deliver(new Response(JSON.stringify(ticket), { status: 201, headers: { 'Content-Type': 'application/json' } }));
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
