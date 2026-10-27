import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdtemp, rm, mkdir, writeFile, symlink, readFile, stat, truncate } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { createServer as createPortServer } from 'node:net';
import { once } from 'node:events';
import { createServer } from '../../packages/frontend/node_modules/vite/dist/node/index.js';
import { createApp } from '../../packages/backend/dist/bootstrap/create-app.js';
import { openSshd, send, expectStatus } from '../backend/remote/openssh-fixture.mjs';

const requirePlaywright = createRequire(new URL('../e2e/package.json', import.meta.url));
const { chromium } = requirePlaywright('@playwright/test');
const directory = await mkdtemp(join(tmpdir(), 'nexus-f1-workspace-files-'));
let app;
let ssh;
let vite;
let browser;
try {
	ssh = await openSshd(directory);
	await mkdir(join(directory, 'files'));
	await writeFile(join(directory, 'files', 'seed.txt'), 'seed');
	await writeFile(join(directory, 'files', 'oversized.png'), '');
	await truncate(join(directory, 'files', 'oversized.png'), 20 * 1024 * 1024 + 1);
	await symlink(join(directory, 'files', 'seed.txt'), join(directory, 'files', 'link.txt'));
	await mkdir(join(directory, 'files', 'nested'));
	await writeFile(join(directory, 'files', 'nested', 'needle.txt'), 'nested');
	const reservation = createPortServer();
	reservation.listen(0, '127.0.0.1');
	await once(reservation, 'listening');
	const port = reservation.address().port;
	await new Promise((resolve) => reservation.close(resolve));
	const origin = 'http://127.0.0.1:' + port;
	app = await createApp(join(directory, 'state.db'), { encryptionKey: randomBytes(32) });
	const address = await app.listenHttp({
		publicOrigin: origin,
		bindHost: '127.0.0.1',
		port: 0,
		trustedProxies: ['loopback'],
	});
	expectStatus(
		await send(
			address,
			'',
			'POST',
			'/api/v1/auth/setup',
			{
				username: 'admin',
				password: 'c2-isolated-password-123',
				confirmPassword: 'c2-isolated-password-123',
			},
			{ Host: new URL(origin).host, Origin: origin },
		),
		201,
	);
	await app.targets.hostKeys.confirm({ host: '127.0.0.1', port: ssh.port, fingerprint: ssh.fingerprint });
	const key = await app.targets.sshKeys.create({ name: 'C2 browser key', privateKey: ssh.privateKey });
	const target = await app.targets.create({
		name: 'C2 browser SSH',
		type: 'SSH',
		host: '127.0.0.1',
		port: ssh.port,
		username: ssh.user,
		route: 'direct',
		proxyId: null,
		tagIds: [],
		jumpIds: [],
		notes: null,
	});
	assert.equal(
		(await app.targets.credentials.set(target.id, target.version, { kind: 'ssh_key', sshKeyId: key.id })).status,
		'updated',
	);
	vite = await createServer({
		root: fileURLToPath(new URL('../../packages/frontend', import.meta.url)),
		configFile: fileURLToPath(new URL('../../packages/frontend/vite.config.ts', import.meta.url)),
		cacheDir: join(directory, 'vite-cache'),
		logLevel: 'error',
		server: {
			host: '127.0.0.1',
			port,
			strictPort: true,
			proxy: {
				'/api': { target: 'http://' + address },
				'/ws/workspace': { target: 'ws://' + address, ws: true },
				'/ws/uploads': { target: 'ws://' + address, ws: true },
			},
		},
		plugins: [
			{
				name: 'workspace-files-page',

				resolveId(id) {
					if (id === '/__c2_files_imports.js') return id;
				},

				load(id) {
					if (id === '/__c2_files_imports.js') return 'export {createPinia,setActivePinia} from "pinia";';
				},

				configureServer(server) {
					server.middlewares.use('/__c2_files', (_request, response) => {
						response.setHeader('Content-Type', 'text/html');
						response.end('<!doctype html><title>Workspace SSH</title>');
					});
				},
			},
		],
	});
	await vite.listen();
	browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
	const page = await browser.newPage();
	await page.goto(origin + '/__c2_files');

	const results = await page.evaluate(
		async ({ target, root }) => {
			const { createPinia, setActivePinia } = await import('/__c2_files_imports.js');
			setActivePinia(createPinia());
			const { useAuthStore } = await import('/src/features/auth/store/auth.store.ts');
			const { WorkspaceRuntimeSession } =
				await import('/src/runtimes/workspace/session/workspaceRuntimeSession.ts');
			await useAuthStore().login({ username: 'admin', password: 'c2-isolated-password-123' });
			const session = new WorkspaceRuntimeSession(target);
			const results = [];

			const expect = (condition, name) => {
				if (!condition) throw Error(name);
				results.push(name);
			};

			let timer;
			let ready;
			const readyPromise = new Promise((resolve, reject) => {
				ready = resolve;
				timer = setTimeout(() => reject(Error('Files readiness timeout')), 15000);
			});
			const off = session.socket.on('filesystem.ready', () => ready());
			try {
				await session.connect();
				await readyPromise;
				clearTimeout(timer);
				const fs = session.adapters.filesystem;
				const download = session.adapters.download;
				const { createTransferController } =
					await import('/src/features/transfers/state/transferController.ts');
				const transfers = createTransferController(session.adapters.transfers);

				const waitTask = async (id) => {
					let timer;
					try {
						return await Promise.race([
							transfers.waitForTask(id),
							new Promise((_, reject) => {
								timer = setTimeout(
									() =>
										reject(
											Error(
												'Transfer terminal timeout: ' + JSON.stringify(transfers.tasks.value),
											),
										),
									20000,
								);
							}),
						]);
					} finally {
						clearTimeout(timer);
					}
				};

				try {
					const content = '真实上传 ✓\n' + 'x'.repeat(1024 * 1024 + 17);
					const [id] = await transfers.startUploadBatch([new File([content], 'uploaded.txt')], {
						scopeId: session.id,
						path: root,
					});
					const uploaded = await waitTask(id);
					expect(
						uploaded.status === 'completed',
						'formal controller receives real staged upload terminal: ' + JSON.stringify(uploaded),
					);
					const bytes = await fs.readBinary(root + '/uploaded.txt', 2 * 1024 * 1024);
					expect(
						new TextDecoder().decode(bytes.bytes) === content,
						'multi-chunk real SFTP upload bytes match exactly',
					);
					const [empty] = await transfers.startUploadBatch([new File([], 'uploaded-empty.txt')], {
						scopeId: session.id,
						path: root,
					});
					expect(
						(await waitTask(empty)).status === 'completed' &&
							(await fs.stat(root + '/uploaded-empty.txt')).metadata.size === 0,
						'empty upload commits without binary socket',
					);
					const [directoryUpload] = await transfers.startUploadBatch(
						[{ file: new File(['directory'], 'file.txt'), relativeDirectory: 'upload-dir/nested' }],
						{ scopeId: session.id, path: root },
						['upload-dir', 'upload-dir/nested'],
					);
					expect(
						(await waitTask(directoryUpload)).status === 'completed',
						'real directory prepare allowlist and relative upload complete',
					);
					const [conflictId] = await transfers.startUploadBatch([new File(['replacement'], 'uploaded.txt')], {
						scopeId: session.id,
						path: root,
					});
					const deadline = Date.now() + 15000;
					while (!transfers.conflict.value && Date.now() < deadline)
						await new Promise((resolve) => setTimeout(resolve, 10));
					expect(
						transfers.conflict.value?.id === conflictId,
						'real existing file requires explicit conflict decision',
					);
					await transfers.resolveConflict('skip');
					expect(
						(await waitTask(conflictId)).status === 'skipped',
						'explicit skip leaves original remote file',
					);
					const [overwriteId] = await transfers.startUploadBatch(
						[new File(['replacement'], 'uploaded.txt')],
						{ scopeId: session.id, path: root },
					);
					while (transfers.conflict.value?.id !== overwriteId && Date.now() < deadline)
						await new Promise((resolve) => setTimeout(resolve, 10));
					await transfers.resolveConflict('overwrite');
					expect(
						(await waitTask(overwriteId)).status === 'completed',
						'explicit overwrite publishes real replacement',
					);
					expect(
						new TextDecoder().decode((await fs.readBinary(root + '/uploaded.txt', 1024)).bytes) ===
							'replacement',
						'overwrite confirmed by separate real SFTP read',
					);
					await fs.createDirectory(root + '/copy-target');
					const copied = await transfers.copyMove({
						kind: 'copy',
						sources: [{ scopeId: session.id, path: root + '/nested' }],
						destination: { scopeId: session.id, path: root + '/copy-target' },
					});
					expect(
						(await waitTask(copied)).status === 'completed',
						'real recursive copy completes through Shared events',
					);
					expect(
						new TextDecoder().decode(
							(await fs.readBinary(root + '/copy-target/nested/needle.txt', 1024)).bytes,
						) === 'nested',
						'copied directory content verified through independent SFTP read',
					);
					const moved = await transfers.copyMove({
						kind: 'move',
						sources: [{ scopeId: session.id, path: root + '/copy-target/nested/needle.txt' }],
						destination: { scopeId: session.id, path: root + '/copy-target' },
					});
					expect(
						(await waitTask(moved)).status === 'completed',
						'real move confirms source removal and destination',
					);
					await fs.stat(root + '/copy-target/nested/needle.txt').then(
						() => {
							throw Error('move source remains');
						},
						(error) => expect(error.code === 'not_found', 'real move removes original path'),
					);
					for (const format of ['zip', 'tar.gz', 'tar.bz2']) {
						const name = 'archive-' + format.replaceAll('.', '-');
						await fs.createDirectory(root + '/' + name);
						await fs.createFile(root + '/' + name + '/content.txt', 'native ' + format);
						const archive = root + '/bundle.' + format;
						const compressed = await transfers.archive({
							kind: 'compress',
							sources: [{ scopeId: session.id, path: root + '/' + name }],
							destination: { scopeId: session.id, path: archive },
							format,
						});
						const compressedTask = await waitTask(compressed);
						expect(
							compressedTask.status === 'completed',
							'real native ' + format + ' compression completes: ' + JSON.stringify(compressedTask),
						);
						await fs.remove([root + '/' + name]);
						const extracted = await transfers.archive({
							kind: 'decompress',
							sources: [{ scopeId: session.id, path: archive }],
							destination: { scopeId: session.id, path: root },
						});
						expect(
							(await waitTask(extracted)).status === 'completed',
							'real native ' + format + ' extraction completes',
						);
						expect(
							new TextDecoder().decode(
								(await fs.readBinary(root + '/' + name + '/content.txt', 1024)).bytes,
							) ===
								'native ' + format,
							'real ' + format + ' roundtrip bytes match',
						);
					}
					const encrypted = await transfers.archive({
						kind: 'compress',
						sources: [{ scopeId: session.id, path: root + '/seed.txt' }],
						destination: { scopeId: session.id, path: root + '/encrypted.zip' },
						format: 'zip',
						password: 'fixture password',
					});
					expect(
						(await waitTask(encrypted)).status === 'completed',
						'real password ZIP compression completes',
					);
					const noPassword = await transfers.archive({
						kind: 'decompress',
						sources: [{ scopeId: session.id, path: root + '/encrypted.zip' }],
						destination: { scopeId: session.id, path: root },
					});
					expect(
						(await waitTask(noPassword)).errorCode === 'PASSWORD_REQUIRED',
						'real encrypted ZIP reports finite password requirement',
					);
					const wrongPassword = await transfers.archive({
						kind: 'decompress',
						sources: [{ scopeId: session.id, path: root + '/encrypted.zip' }],
						destination: { scopeId: session.id, path: root },
						password: 'wrong fixture password',
					});
					expect(
						(await waitTask(wrongPassword)).errorCode === 'INVALID_PASSWORD',
						'real encrypted ZIP reports finite wrong password',
					);
					const decrypted = await transfers.archive({
						kind: 'decompress',
						sources: [{ scopeId: session.id, path: root + '/encrypted.zip' }],
						destination: { scopeId: session.id, path: root },
						password: 'fixture password',
					});
					expect(
						(await waitTask(decrypted)).status === 'completed',
						'real encrypted ZIP extraction completes',
					);
					const second = new WorkspaceRuntimeSession(target);
					let crossTransfers;
					try {
						await second.connect();
						await second.adapters.filesystem.createDirectory(root + '/cross-target');
						await fs.createFile(root + '/cross-source.txt', 'cross workspace');
						crossTransfers = createTransferController(second.adapters.transfers);
						const cross = await crossTransfers.copyMove({
							kind: 'move',
							sources: [{ scopeId: session.id, path: root + '/cross-source.txt' }],
							destination: { scopeId: second.id, path: root + '/cross-target' },
						});
						const crossTask = await Promise.race([
							crossTransfers.waitForTask(cross),
							new Promise((_, reject) => {
								timer = setTimeout(() => reject(Error('cross Workspace move timeout')), 20000);
							}),
						]);
						clearTimeout(timer);
						expect(
							crossTask.status === 'completed',
							'real cross Workspace move uses backend owner for complete operation: ' +
								JSON.stringify(crossTask),
						);
						expect(
							new TextDecoder().decode(
								(
									await second.adapters.filesystem.readBinary(
										root + '/cross-target/cross-source.txt',
										1024,
									)
								).bytes,
							) === 'cross workspace',
							'cross Workspace destination bytes confirmed',
						);
						await fs.stat(root + '/cross-source.txt').then(
							() => {
								throw Error('cross source remains');
							},
							(error) =>
								expect(error.code === 'not_found', 'cross Workspace backend confirms source removal'),
						);
					} finally {
						clearTimeout(timer);
						crossTransfers?.dispose();
						await second.dispose();
					}
				} finally {
					transfers.dispose();
				}

				const ticket = await download.createDownload(root + '/seed.txt', 'file');
				expect(Object.keys(ticket).join() === 'url', 'download ticket projects only application fields');
				const head = await fetch(ticket.url, { method: 'HEAD' });
				expect(
					head.status === 200 && head.headers.get('content-length') === '4',
					'ticket HEAD uses actual size',
				);
				expect((await head.arrayBuffer()).byteLength === 0, 'HEAD does not deliver file bytes');
				const downloaded = await fetch(ticket.url);
				expect(
					downloaded.status === 200 && (await downloaded.text()) === 'seed',
					'formal ticket downloads real bytes',
				);
				const partial = await fetch(ticket.url, { headers: { Range: 'bytes=1-2' } });
				const partialText = await partial.text();
				expect(
					partial.status === 206 &&
						partial.headers.get('content-range') === 'bytes 1-2/4' &&
						partialText === 'ee',
					`ticket exact Range is preserved (${partial.status}, ${partial.headers.get('content-range')}, ${partialText})`,
				);
				const suffix = await fetch(ticket.url, { headers: { Range: 'bytes=-2' } });
				expect(suffix.status === 206 && (await suffix.text()) === 'ed', 'ticket suffix Range is preserved');
				const invalid = await fetch(ticket.url, { headers: { Range: 'bytes=99-' } });
				expect(
					invalid.status === 416 && invalid.headers.get('content-range') === 'bytes */4',
					'unsatisfied Range is explicit',
				);
				await invalid.arrayBuffer();
				const directory = await download.createDownload(root + '/nested', 'directory');
				const zip = await fetch(directory.url);
				const zipBytes = new Uint8Array(await zip.arrayBuffer());
				expect(
					zip.status === 200 &&
						zip.headers.get('content-type') === 'application/zip' &&
						zipBytes[0] === 0x50 &&
						zipBytes[1] === 0x4b,
					'directory port downloads actual streamed ZIP',
				);
				const directQuery = new URLSearchParams({
					connectionId: String(target.id),
					sessionId: session.id,
					remotePath: root + '/nested',
				});
				const directoryHead = await fetch('/api/v1/sftp/download?' + directQuery, { method: 'HEAD' });
				expect(
					directoryHead.status === 200 && directoryHead.headers.get('content-type') === 'application/zip',
					'direct directory HEAD remains available',
				);
				await directoryHead.arrayBuffer();
				const directZip = await fetch('/api/v1/sftp/download?' + directQuery);
				const directZipBytes = new Uint8Array(await directZip.arrayBuffer());
				expect(
					directZip.status === 200 && directZipBytes[0] === 0x50 && directZipBytes[1] === 0x4b,
					'direct GET keeps directory ZIP behavior',
				);
				directQuery.set('remotePath', root + '/seed.txt');
				directQuery.set('disposition', 'inline');
				const inline = await fetch('/api/v1/sftp/download?' + directQuery);
				expect(
					inline.status === 200 &&
						inline.headers.get('content-disposition').startsWith('inline;') &&
						(await inline.text()) === 'seed',
					'direct inline delivery keeps actual file bytes',
				);
				directQuery.set('remotePath', root + '/oversized.png');
				const oversizedPreview = await fetch('/api/v1/sftp/download?' + directQuery);
				expect(
					oversizedPreview.status === 413 &&
						(await oversizedPreview.json()).message === 'inline_preview_too_large',
					'inline preview capacity has a finite safe failure',
				);
				await download.createDownload(root + '/missing', 'file').then(
					() => {
						throw Error('missing download accepted');
					},
					(error) =>
						expect(
							error.code === 'not_found' && !error.outcomeUnknown,
							'ticket rejects missing file safely',
						),
				);
				const malformed = await fetch('/api/v1/sftp/download-ticket', {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: '{',
				});
				expect(
					malformed.status === 400 && (await malformed.json()).code === 'invalid_json',
					'ticket malformed JSON retains transport rejection',
				);
				const oversized = await fetch('/api/v1/sftp/download-ticket', {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({ data: 'x'.repeat(33 * 1024) }),
				});
				expect(
					oversized.status === 413 && (await oversized.json()).code === 'body_too_large',
					'ticket complete request capacity retains transport rejection',
				);
				const listing = await fs.listDirectory(root);
				expect(
					listing.path === root && listing.entries.some((item) => item.name === 'seed.txt'),
					'formal listing reads real SFTP',
				);
				const seed = await fs.stat(root + '/seed.txt');
				expect(
					seed.metadata.size === 4 && seed.metadata.modifiedAt > 1700000000000,
					'metadata uses actual milliseconds',
				);
				expect((await fs.stat('/')).metadata.isDirectory, 'root stat permits actual empty basename');
				const result = await fs.search(root, 'needle');
				expect(
					result.entries.length === 2 &&
						result.entries.some((entry) => entry.relativePath === 'nested/needle.txt') &&
						result.entries.some((entry) => entry.relativePath === 'copy-target/needle.txt'),
					'recursive search preserves request root and relative path',
				);
				const resolved = await fs.realpath(root + '/link.txt');
				expect(
					resolved.requestedPath === root + '/link.txt' &&
						resolved.path === root + '/seed.txt' &&
						resolved.targetType === 'file',
					'realpath allows legitimate symlink target',
				);
				expect(
					(await fs.stat(root + '/link.txt')).metadata.isSymbolicLink,
					'stat retains symbolic link metadata',
				);
				await fs.createDirectory(root + '/created');
				expect(
					(await fs.stat(root + '/created')).metadata.isDirectory,
					'create directory confirmed by real stat',
				);
				await fs.createFile(root + '/created/empty.txt');
				const emptyTicket = await download.createDownload(root + '/created/empty.txt', 'file');
				const emptyDownload = await fetch(emptyTicket.url);
				expect(
					emptyDownload.status === 200 && (await emptyDownload.arrayBuffer()).byteLength === 0,
					'empty file ticket completes without a phantom byte',
				);
				const empty = await fs.readBinary(root + '/created/empty.txt', 16);
				expect(empty.bytes.length === 0, 'empty binary final and JSON response complete');
				await fs.createFile(root + '/created/doc.txt', 'before');
				const text = '中文\r\nUTF-16 ✓';
				await session.adapters.documents.save(root + '/created/doc.txt', text, 'utf16le');
				const document = await session.adapters.documents.load(root + '/created/doc.txt', 'utf16le');
				expect(
					document.path === root + '/created/doc.txt' &&
						document.content === text &&
						document.encoding === 'utf-16le',
					'formal editor saves and decodes UTF-16LE over SFTP',
				);
				const raw = await fs.readBinary(root + '/created/doc.txt', 1024);
				expect(raw.bytes[0] === 255 && raw.bytes[1] === 254, 'wire bytes retain UTF-16 BOM');
				const preview = await session.adapters.preview.read(root + '/created/doc.txt', { maxBytes: 1024 });
				expect(
					'bytes' in preview && preview.bytes.byteLength === raw.bytes.length,
					'formal preview preserves complete binary bytes',
				);
				const tooLarge = await session.adapters.preview.read(root + '/created/doc.txt', { maxBytes: 1 });
				expect(
					'tooLarge' in tooLarge && tooLarge.actualBytes === raw.bytes.length,
					'preview applies configured lower read budget',
				);
				const aborted = new AbortController();
				aborted.abort();
				await session.adapters.preview.read(root + '/seed.txt', { signal: aborted.signal }).then(
					() => {
						throw Error('abort accepted');
					},
					(error) => expect(error.name === 'AbortError', 'preview pre-abort rejects without reading'),
				);
				await fs.chmod(root + '/created/doc.txt', 0o640);
				expect(
					((await fs.stat(root + '/created/doc.txt')).metadata.mode & 0o777) === 0o640,
					'chmod changes actual remote mode',
				);
				await fs.rename(root + '/created/doc.txt', root + '/created/renamed.txt');
				expect(
					(await fs.stat(root + '/created/renamed.txt')).metadata.size === raw.bytes.length,
					'rename preserves actual content',
				);
				await fs.remove([root + '/created']);
				expect(
					!(await fs.listDirectory(root)).entries.some((item) => item.name === 'created'),
					'recursive remove deletes actual subtree',
				);
				await fs.stat(root + '/missing').then(
					() => {
						throw Error('missing accepted');
					},
					(error) =>
						expect(
							error.code === 'not_found' && !error.outcomeUnknown,
							'finite not_found from real producer',
						),
				);
				await fs.writeText(root + '/too-large', 'x'.repeat(1024 * 1024)).then(
					() => {
						throw Error('large input accepted');
					},
					(error) =>
						expect(
							error.code === 'limit_exceeded' && !error.outcomeUnknown,
							'complete inbound request budget rejects before dispatch',
						),
				);
				expect((await session.close()) === 'closed', 'real Workspace close confirms resource release');
				const revoked = await fetch(ticket.url);
				expect(
					revoked.status === 410 && (await revoked.json()).message === 'download_ticket_expired',
					'ticket cannot read from a released original resource',
				);
				await download.createDownload(root + '/seed.txt', 'file').then(
					() => {
						throw Error('closed download accepted');
					},
					(error) => expect(error.code === 'not_connected', 'closed attachment cannot issue a download'),
				);
				await fs.createFile(root + '/late.txt').then(
					() => {
						throw Error('disconnected write accepted');
					},
					(error) =>
						expect(
							error.code === 'not_connected' && !error.outcomeUnknown && !session.socket.connected,
							'disconnected mutation does not open another socket',
						),
				);
				return { checks: results, zip: Array.from(zipBytes) };
			} finally {
				clearTimeout(timer);
				off();
				await session.dispose();
			}
		},
		{ target, root: join(directory, 'files') },
	);
	for (const format of ['zip', 'tar.gz', 'tar.bz2'])
		assert.equal(
			await readFile(join(directory, 'files', 'archive-' + format.replaceAll('.', '-'), 'content.txt'), 'utf8'),
			'native ' + format,
		);
	assert.equal(await readFile(join(directory, 'files', 'copy-target', 'needle.txt'), 'utf8'), 'nested');
	assert.equal(
		await readFile(join(directory, 'files', 'cross-target', 'cross-source.txt'), 'utf8'),
		'cross workspace',
	);
	assert.equal(
		execFileSync('unzip', ['-P', 'fixture password', '-p', join(directory, 'files', 'encrypted.zip')], {
			encoding: 'utf8',
		}),
		'seed',
	);
	const zipPath = join(directory, 'download.zip');
	await writeFile(zipPath, Uint8Array.from(results.zip));
	assert.equal(execFileSync('unzip', ['-p', zipPath], { encoding: 'utf8' }), 'nested');
	assert.equal(await readFile(join(directory, 'files', 'seed.txt'), 'utf8'), 'seed');
	assert.equal(await readFile(join(directory, 'files', 'uploaded.txt'), 'utf8'), 'replacement');
	assert.equal((await stat(join(directory, 'files', 'uploaded-empty.txt'))).size, 0);
	assert.equal(await readFile(join(directory, 'files', 'upload-dir/nested/file.txt'), 'utf8'), 'directory');
	assert.equal(
		await stat(join(directory, 'files', 'created')).then(
			() => true,
			() => false,
		),
		false,
	);
	assert.equal(
		await stat(join(directory, 'files', 'too-large')).then(
			() => true,
			() => false,
		),
		false,
	);
	assert.equal(
		await stat(join(directory, 'files', 'late.txt')).then(
			() => true,
			() => false,
		),
		false,
	);
	console.log(
		'Formal Files / real Access, Backend-next, OpenSSH/SFTP: ' +
			results.checks.length +
			' browser + 14 disk/ZIP checks PASS',
	);
	console.log(results.checks.join('\n'));
} finally {
	const failures = [];
	// Close consumers before producers and their owned directories.
	for (const close of [() => browser?.close(), () => vite?.close(), () => app?.close(), () => ssh?.close()]) {
		try {
			await close();
		} catch (error) {
			failures.push(error);
		}
	}
	try {
		await rm(directory, { recursive: true, force: true });
	} catch (error) {
		failures.push(error);
	}
	if (failures.length) throw new AggregateError(failures, 'Workspace SSH fixture cleanup failed');
}
