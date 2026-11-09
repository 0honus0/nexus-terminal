import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { generateKeyPairSync } from 'node:crypto';
import { expect, test, HTTP_TEST_ORIGIN } from '../../../../support/http/ssh-protocol-fixture.mjs';
import { loginAsAdmin } from '../../../../support/http/ssh-protocol-fixture.mjs';
import { createSshConnection, trustSshHostKey } from '../../../../support/http/ssh-targets.ts';
import { readConnectionTestResponse } from '../../../../../packages/shared/src/targets/connections/test-codec';
import { readSshKeyView, readSshKeyMutation } from '../../../../../packages/shared/src/targets/ssh-keys/http-codec';
import {
	closeWebSocket,
	type E2eWebSocket,
	requestWorkspace,
	requestWorkspaceBinary,
	resumeWorkspaceSession,
	sendJson,
	waitForBinaryBytes,
	waitForBinaryText,
	waitForJson,
	waitForFilesystemReady,
	WorkspaceRequestFailure,
} from '../../../../support/protocols/workspace-client';
import { WORKSPACE_MAX_IN_FLIGHT_REQUESTS } from '../../../../../packages/shared/src/remote/workspace/values';
const headers = { Origin: HTTP_TEST_ORIGIN };
type ArchiveResult = {
	type: 'completed' | 'failed' | 'cancelled';
	requestId: string;
	code?: string;
	message?: string;
	path?: string;
};

const runArchive = async (
	socket: E2eWebSocket,
	operation: 'compress' | 'decompress',
	payload: Record<string, unknown>,
): Promise<ArchiveResult> => {
	const requestId = `archive-${crypto.randomUUID()}`;
	const eventPromise = waitForJson(
		socket,
		(message) =>
			message.type === 'transfer.archive' &&
			message.payload?.requestId === requestId &&
			['completed', 'failed', 'cancelled'].includes(String(message.payload?.type)),
		30000,
	);
	await requestWorkspace(socket, `transfer.${operation}`, payload, requestId, 30000);
	return (await eventPromise).payload as ArchiveResult;
};

const readRemoteText = async (socket: E2eWebSocket, path: string): Promise<string> =>
	(
		await requestWorkspaceBinary(socket, 'filesystem.readBinary', { path, maxBytes: 64 * 1024 * 1024 })
	).bytes.toString('utf8');

const rootFileNames = async (socket: E2eWebSocket): Promise<string[]> =>
	(
		await requestWorkspace<{
			entries: Array<{
				name: string;
			}>;
		}>(socket, 'filesystem.list', {
			path: '/',
		})
	).entries.map((item) => item.name);

test('backend can authenticate to the real SSH test server', async ({ request, ssh, httpClients }) => {
	await loginAsAdmin(request);
	await trustSshHostKey(request, ssh);
	const response = await request.post('/api/v1/targets/connections/test-unsaved', {
		headers,
		data: {
			host: ssh.host,
			port: ssh.port,
			username: ssh.username,
			authentication: { kind: 'password', password: ssh.password },
			route: 'direct',
			proxyId: null,
			jumpIds: [],
		},
	});
	expect(response.ok()).toBeTruthy();
	expect(readConnectionTestResponse(await response.json()).status).toBe('ok');
});
test('saved SSH key survives a name-only update without exposing decrypted material', async ({
	request,
	ssh,
	httpClients,
}) => {
	await loginAsAdmin(request);
	const suffix = crypto.randomUUID();
	const privateKey = generateKeyPairSync('rsa', { modulusLength: 2048 })
		.privateKey.export({
			type: 'pkcs1',
			format: 'pem',
		})
		.toString();
	const createKey = await request.post('/api/v1/targets/ssh-keys', {
		headers,
		data: { name: `E2E protocol key ${suffix}`, privateKey },
	});
	expect(createKey.status()).toBe(201);
	const key = readSshKeyView(await createKey.json());
	const keyId = key.id;
	let connectionId = 0;
	try {
		const renamedName = `E2E protocol key renamed ${suffix}`;
		const rename = await request.put(`/api/v1/targets/ssh-keys/${keyId}`, {
			headers,
			data: { version: key.version, changes: { name: renamedName } },
		});
		expect(rename.ok()).toBeTruthy();
		expect(await rename.text()).not.toContain(privateKey.toString());
		const mutation = readSshKeyMutation(await rename.json());
		expect(mutation).toMatchObject({ status: 'updated', value: { name: renamedName } });
		expect((await request.get(`/api/v1/targets/ssh-keys/${keyId}/details`)).status()).toBe(404);
		await trustSshHostKey(request, ssh);
		connectionId = await createSshConnection(request, ssh, `E2E key connection ${suffix}`, ssh.port, {
			kind: 'ssh_key',
			sshKeyId: keyId,
		});
		const connectionTest = await request.post(`/api/v1/targets/connections/${connectionId}/test`, { headers });
		expect(connectionTest.ok()).toBeTruthy();
		expect(readConnectionTestResponse(await connectionTest.json()).status).toBe('ok');
	} finally {
		if (connectionId)
			expect((await request.delete(`/api/v1/targets/connections/${connectionId}`, { headers })).ok()).toBe(true);
		expect((await request.delete(`/api/v1/targets/ssh-keys/${keyId}`, { headers })).ok()).toBe(true);
	}
});
test('duplicate workspace.connect is rejected without breaking filesystem access', async ({
	request,
	ssh,
	httpClients,
}) => {
	await loginAsAdmin(request);
	const connectionId = await createSshConnection(request, ssh);
	const workspace = await httpClients.openWorkspace(connectionId, `duplicate-${crypto.randomUUID()}`);
	try {
		await waitForFilesystemReady(workspace.socket);
		// repeat workspace.connect on the same live websocket
		{
			await expect(
				requestWorkspace(workspace.socket, 'workspace.connect', {
					connectionId,
					workspaceId: `duplicate-second-${crypto.randomUUID()}`,
				}),
			).rejects.toThrow(/conflict/);
		}
		// filesystem operations still work after the rejected duplicate request
		{
			const root = await requestWorkspace<{
				entries: Array<{
					name: string;
				}>;
			}>(workspace.socket, 'filesystem.list', {
				path: '/',
			});
			expect(root.entries.map((item) => item.name)).toContain('seed.txt');
		}
	} finally {
		await closeWebSocket(workspace.socket);
	}
});
test('detached workspace resumes only with its credential and replays missed terminal output', async ({
	request,
	ssh,
	httpClients,
}) => {
	await loginAsAdmin(request);
	const connectionId = await createSshConnection(request, ssh);
	const workspace = await httpClients.openWorkspace(connectionId, `resume-${crypto.randomUUID()}`);
	const completedPath = join(ssh.root, `detached-replay-${crypto.randomUUID()}`);
	await requestWorkspace(workspace.socket, 'terminal.input', {
		data: `sleep 1; printf '%s%s\\n' 'NEXUS_DETACHED_' 'REPLAY'; printf done > '${completedPath}'\n`,
	});
	workspace.socket.terminate();
	const replacement = await httpClients.openSocket();
	try {
		await expect(
			requestWorkspace(replacement, 'workspace.connect', {
				workspaceId: workspace.workspaceId,
				connectionId,
				viewport: { columns: 100, rows: 30 },
			}),
		).rejects.toThrow(/conflict/);
	} finally {
		await closeWebSocket(replacement);
	}
	const rejected = await httpClients.openSocket();
	try {
		await expect(
			requestWorkspace(rejected, 'workspace.resume', {
				workspaceId: workspace.workspaceId,
				connectionId,
				resumeToken: workspace.resumeToken.slice(0, -1) + (workspace.resumeToken.endsWith('A') ? 'B' : 'A'),
				attachmentGeneration: workspace.attachmentGeneration,
				terminalOffset: workspace.terminalOffset,
			}),
		).rejects.toThrow(/not_found/);
	} finally {
		await closeWebSocket(rejected);
	}
	await expect
		.poll(async () => {
			try {
				return await readFile(completedPath, 'utf8');
			} catch (cause) {
				if (!(cause instanceof Error) || !('code' in cause) || cause.code !== 'ENOENT') throw cause;
				return '';
			}
		})
		.toBe('done');
	const resumed = await httpClients.openSocket();
	try {
		const replay = waitForBinaryText(resumed, 'NEXUS_DETACHED_REPLAY', 10000);
		const result = await resumeWorkspaceSession(resumed, {
			workspaceId: workspace.workspaceId,
			connectionId,
			resumeToken: workspace.resumeToken,
			attachmentGeneration: workspace.attachmentGeneration,
			terminalOffset: workspace.terminalOffset,
			viewport: { columns: 100, rows: 30 },
		});
		await expect(replay).resolves.toContain('NEXUS_DETACHED_REPLAY');
		expect(result.replayedBytes).toBeGreaterThan(0);
		expect(result.resumeToken).not.toBe(workspace.resumeToken);
		expect(result.attachmentGeneration).toBe(workspace.attachmentGeneration + 1);
		const stale = await httpClients.openSocket();
		try {
			await expect(
				requestWorkspace(stale, 'workspace.resume', {
					workspaceId: workspace.workspaceId,
					connectionId,
					resumeToken: workspace.resumeToken,
					attachmentGeneration: workspace.attachmentGeneration,
					terminalOffset: workspace.terminalOffset,
				}),
			).rejects.toThrow(/not_found/);
		} finally {
			await closeWebSocket(stale);
		}
		await requestWorkspace(resumed, 'workspace.close', {
			workspaceId: workspace.workspaceId,
			connectionId,
			resumeToken: result.resumeToken,
			attachmentGeneration: result.attachmentGeneration,
		});
	} finally {
		await closeWebSocket(resumed);
	}
});
test('detached workspace keeps archive work running and publishes its verified result on resume', async ({
	request,
	ssh,
	httpClients,
}) => {
	await loginAsAdmin(request);
	const connectionId = await createSshConnection(request, ssh);
	const workspace = await httpClients.openWorkspace(connectionId, `resume-archive-${crypto.randomUUID()}`);
	const requestId = `archive-${crypto.randomUUID()}`;
	const destination = `/detached-${crypto.randomUUID()}.zip`;
	await fetch(`${ssh.controlUrl}/archive/exec-delay?ms=1000`, { method: 'POST' });
	try {
		// A connected terminal does not imply that its independently acquired
		// FileResource has finished initialization. Archive admission requires
		// the actual filesystem.ready event, not a timing assumption.
		await waitForFilesystemReady(workspace.socket);
		await requestWorkspace(
			workspace.socket,
			'transfer.compress',
			{ sources: ['/archive-source.txt'], destination, format: 'zip' },
			requestId,
		);
		workspace.socket.terminate();
		await expect
			.poll(async () => {
				try {
					return (await readFile(join(ssh.root, destination))).length;
				} catch (cause) {
					if (!(cause instanceof Error) || !('code' in cause) || cause.code !== 'ENOENT') throw cause;
					return 0;
				}
			})
			.toBeGreaterThan(0);
		const resumed = await httpClients.openSocket();
		try {
			const result = await resumeWorkspaceSession(resumed, {
				workspaceId: workspace.workspaceId,
				connectionId,
				resumeToken: workspace.resumeToken,
				attachmentGeneration: workspace.attachmentGeneration,
				terminalOffset: workspace.terminalOffset,
			});
			// Terminal PTY output is replayable, but transfer event listeners are
			// attached to an exact WebSocket and must not deliver onto its successor.
			// Confirm the detached archive by its actual published ZIP bytes instead
			// of waiting for a stale socket's non-replayable completion event.
			await expect
				.poll(
					async () => {
						try {
							const archive = await requestWorkspaceBinary(resumed, 'filesystem.readBinary', {
								path: destination,
								maxBytes: 64 * 1024 * 1024,
							});
							expect(archive.bytes.subarray(0, 4)).toEqual(Buffer.from([0x50, 0x4b, 0x03, 0x04]));
							return archive.bytes.includes(Buffer.from('archive-source.txt'));
						} catch (error) {
							if (error instanceof WorkspaceRequestFailure && error.code === 'not_found') return false;
							throw error;
						}
					},
					{ timeout: 30000 },
				)
				.toBe(true);
			await requestWorkspace(resumed, 'workspace.close', {
				workspaceId: workspace.workspaceId,
				connectionId,
				resumeToken: result.resumeToken,
				attachmentGeneration: result.attachmentGeneration,
			});
		} finally {
			await closeWebSocket(resumed);
		}
	} finally {
		await fetch(`${ssh.controlUrl}/archive/exec-delay?ms=0`, { method: 'POST' });
		await closeWebSocket(workspace.socket).catch(() => undefined);
	}
});
test('credentialed close releases a detached workspace immediately', async ({ request, ssh, httpClients }) => {
	await loginAsAdmin(request);
	const connectionId = await createSshConnection(request, ssh);
	const workspace = await httpClients.openWorkspace(connectionId, `close-detached-${crypto.randomUUID()}`);
	workspace.socket.terminate();
	const closer = await httpClients.openSocket();
	try {
		await requestWorkspace(closer, 'workspace.close', {
			workspaceId: workspace.workspaceId,
			connectionId,
			resumeToken: workspace.resumeToken,
			attachmentGeneration: workspace.attachmentGeneration,
		});
	} finally {
		await closeWebSocket(closer);
	}
	const stale = await httpClients.openSocket();
	try {
		await expect(
			requestWorkspace(stale, 'workspace.resume', {
				workspaceId: workspace.workspaceId,
				connectionId,
				resumeToken: workspace.resumeToken,
				attachmentGeneration: workspace.attachmentGeneration,
				terminalOffset: workspace.terminalOffset,
			}),
		).rejects.toThrow(/not_found/);
	} finally {
		await closeWebSocket(stale);
	}
	const replacement = await httpClients.openWorkspace(connectionId, workspace.workspaceId);
	try {
		await expect(requestWorkspace(replacement.socket, 'terminal.currentDirectory')).resolves.toEqual('/');
	} finally {
		await closeWebSocket(replacement.socket);
	}
});
test('workspace rejects request ids that cannot be represented by the binary correlation contract', async ({
	request,
	ssh,
	httpClients,
}) => {
	await loginAsAdmin(request);
	const connectionId = await createSshConnection(request, ssh);
	const workspace = await httpClients.openWorkspace(connectionId, `request-id-${crypto.randomUUID()}`);
	try {
		const closed = new Promise<{
			code: number;
			reason: string;
		}>((resolve) => {
			workspace.socket.once('close', (code: number, reason: Buffer) => {
				resolve({ code, reason: reason.toString('utf8') });
			});
		});
		sendJson(workspace.socket, {
			type: 'filesystem.list',
			requestId: 'x'.repeat(129),
			payload: { path: '/' },
		});
		await expect(closed).resolves.toEqual({ code: 1003, reason: 'Invalid Workspace protocol request' });
	} finally {
		await closeWebSocket(workspace.socket);
	}
});
test('filesystem.createFile rejects an existing path without truncating its contents', async ({
	request,
	ssh,
	httpClients,
}) => {
	await loginAsAdmin(request);
	const connectionId = await createSshConnection(request, ssh);
	const workspace = await httpClients.openWorkspace(connectionId, `create-file-${crypto.randomUUID()}`);
	try {
		await waitForFilesystemReady(workspace.socket);
		const before = await readRemoteText(workspace.socket, '/seed.txt');
		await expect(
			requestWorkspace(workspace.socket, 'filesystem.createFile', {
				path: '/seed.txt',
				content: '',
				encoding: 'utf-8',
			}),
		).rejects.toThrow();
		await expect.poll(() => readRemoteText(workspace.socket, '/seed.txt')).toBe(before);
	} finally {
		await closeWebSocket(workspace.socket);
	}
});
test('recursive filesystem search stays scoped to the requested path and returns nested paths', async ({
	request,
	ssh,
	httpClients,
}) => {
	await loginAsAdmin(request);
	const connectionId = await createSshConnection(request, ssh);
	const workspace = await httpClients.openWorkspace(connectionId, `search-${crypto.randomUUID()}`);
	try {
		await waitForFilesystemReady(workspace.socket);
		const rootSearch = await requestWorkspace<{
			truncated: boolean;
			entries: Array<{
				name: string;
				relativePath: string;
				path: string;
			}>;
		}>(workspace.socket, 'filesystem.search', { path: '/', query: 'nested' });
		expect(rootSearch).toMatchObject({
			truncated: false,
			entries: expect.arrayContaining([
				expect.objectContaining({
					name: 'nested.txt',
					relativePath: 'folder-seed/nested.txt',
					path: '/folder-seed/nested.txt',
				}),
			]),
		});
		const scopedSearch = await requestWorkspace<{
			entries: unknown[];
		}>(workspace.socket, 'filesystem.search', {
			path: '/folder-seed',
			query: 'seed.txt',
		});
		expect(scopedSearch.entries).toEqual([]);
	} finally {
		await closeWebSocket(workspace.socket);
	}
});
test('raw terminal output needs no acknowledgement and clean requests remain usable', async ({
	request,
	ssh,
	httpClients,
}) => {
	await loginAsAdmin(request);
	const connectionId = await createSshConnection(request, ssh);
	const workspace = await httpClients.openWorkspace(connectionId, `raw-terminal-${crypto.randomUUID()}`);
	try {
		const outputPromise = waitForBinaryText(workspace.socket, 'RAW_TERMINAL_E2E', 15000);
		await requestWorkspace(workspace.socket, 'terminal.input', { data: "printf 'RAW_TERMINAL_E2E\\n'\r" });
		await expect(outputPromise).resolves.toContain('RAW_TERMINAL_E2E');
		await expect(requestWorkspace(workspace.socket, 'suspend.list')).resolves.toEqual(expect.any(Array));
	} finally {
		await closeWebSocket(workspace.socket);
	}
});
test('one-way terminal input bursts preserve every character beyond the RPC concurrency count', async ({
	request,
	ssh,
	httpClients,
}) => {
	await loginAsAdmin(request);
	// CRLF assertions require the fixture's real PTY, rather than pipe-backed Bash.
	const configured = await fetch(ssh.controlUrl + '/shell/startup-pty?echo=off', { method: 'POST' });
	expect(configured.ok).toBeTruthy();
	const connectionId = await createSshConnection(request, ssh);
	const workspace = await httpClients.openWorkspace(connectionId, `input-burst-${crypto.randomUUID()}`);
	const failures: string[] = [];

	const observe = (data: Buffer, isBinary: boolean) => {
		if (isBinary) return;
		const message = JSON.parse(data.toString('utf8'));
		if (message.type === 'protocol.error') failures.push(message.payload.message);
	};

	workspace.socket.on('message', observe);
	try {
		const marker = 'INPUT_BURST_' + 'x'.repeat(WORKSPACE_MAX_IN_FLIGHT_REQUESTS * 2);
		const command = `printf '\\n%s\\n' '${marker}'\r`;
		const output = waitForBinaryText(workspace.socket, `\r\n${marker}\r\n`);
		for (const data of command) sendJson(workspace.socket, { type: 'terminal.input', payload: { data } });
		await expect(output).resolves.toContain(`\r\n${marker}\r\n`);
		expect(failures).toEqual([]);
		await expect(requestWorkspace(workspace.socket, 'suspend.list')).resolves.toEqual(expect.any(Array));
	} finally {
		workspace.socket.off('message', observe);
		await closeWebSocket(workspace.socket);
	}
});
test('terminal preserves raw UTF-8 bytes over SSH to binary WebSocket frames', async ({
	request,
	ssh,
	httpClients,
}) => {
	await loginAsAdmin(request);
	const connectionId = await createSshConnection(request, ssh);
	const workspace = await httpClients.openWorkspace(connectionId, `binary-terminal-${crypto.randomUUID()}`);
	try {
		const expected = Buffer.from('NEXUS_BINARY_UTF8_中文🙂_END\n', 'utf8');
		const octal = [...expected].map((byte) => `\\${byte.toString(8).padStart(3, '0')}`).join('');
		const outputPromise = waitForBinaryBytes(workspace.socket, expected, 15000);
		await requestWorkspace(workspace.socket, 'terminal.input', { data: `printf '${octal}'\r` });
		const output = await outputPromise;
		expect(output.indexOf(expected)).toBeGreaterThanOrEqual(0);
	} finally {
		await closeWebSocket(workspace.socket);
	}
});
test('same-workspace move treats a missing destination path as available', async ({ request, ssh, httpClients }) => {
	await loginAsAdmin(request);
	const connectionId = await createSshConnection(request, ssh);
	const workspace = await httpClients.openWorkspace(connectionId, `move-${crypto.randomUUID()}`);
	try {
		await waitForFilesystemReady(workspace.socket);
		// move a file into an existing directory
		{
			const requestId = `move-${crypto.randomUUID()}`;
			const completed = waitForJson(
				workspace.socket,
				(message) =>
					message.type === 'transfer.copyMove' &&
					message.payload?.requestId === requestId &&
					message.payload?.type === 'completed',
				20000,
			);
			await requestWorkspace(
				workspace.socket,
				'transfer.copyMove',
				{ mode: 'move', sources: ['/move-source.txt'], destination: '/folder-seed' },
				requestId,
			);
			await completed;
			const destination = await requestWorkspaceBinary(workspace.socket, 'filesystem.readBinary', {
				maxBytes: 64 * 1024 * 1024,
				path: '/folder-seed/move-source.txt',
			});
			expect(destination.bytes.toString('utf8')).toContain('move-me');
			const root = await requestWorkspace<{
				entries: Array<{
					name: string;
				}>;
			}>(workspace.socket, 'filesystem.list', {
				path: '/',
			});
			expect(root.entries.map((item) => item.name)).not.toContain('move-source.txt');
		}
	} finally {
		await closeWebSocket(workspace.socket);
	}
});
test('filesystem operations preserve POSIX filenames with backslashes quotes and line breaks', async ({
	request,
	ssh,
	httpClients,
}) => {
	await loginAsAdmin(request);
	const connectionId = await createSshConnection(request, ssh);
	const workspace = await httpClients.openWorkspace(connectionId, `special-paths-${crypto.randomUUID()}`);
	const literalBackslashName = '{{.Destination}}\\n{{end}}"';
	const literalBackslashPath = `/${literalBackslashName}`;
	const actualNewlineName = 'line\nbreak\'"$;[]{}.txt';
	const actualNewlinePath = `/${actualNewlineName}`;
	try {
		await waitForFilesystemReady(workspace.socket);
		const before = await rootFileNames(workspace.socket);
		expect(before).toContain(literalBackslashName);
		expect(before).toContain(actualNewlineName);
		await expect(readRemoteText(workspace.socket, literalBackslashPath)).resolves.toContain('backslash-delete-e2e');
		await expect(readRemoteText(workspace.socket, actualNewlinePath)).resolves.toContain('newline-delete-e2e');
		await expect(
			requestWorkspace(workspace.socket, 'filesystem.stat', { path: literalBackslashPath }),
		).resolves.toMatchObject({ name: literalBackslashName, path: literalBackslashPath });
		await requestWorkspace(workspace.socket, 'filesystem.remove', {
			paths: [literalBackslashPath, actualNewlinePath],
		});
		const after = await rootFileNames(workspace.socket);
		expect(after).not.toContain(literalBackslashName);
		expect(after).not.toContain(actualNewlineName);
	} finally {
		await closeWebSocket(workspace.socket);
	}
});
test('archive commands use the same remote root as filesystem operations', async ({ request, ssh, httpClients }) => {
	await loginAsAdmin(request);
	const connectionId = await createSshConnection(request, ssh);
	const workspace = await httpClients.openWorkspace(connectionId, `archive-${crypto.randomUUID()}`);
	try {
		await waitForFilesystemReady(workspace.socket);
		// compress and decompress a file in the filesystem root
		{
			const compressed = await runArchive(workspace.socket, 'compress', {
				sources: ['/archive-source.txt'],
				destination: '/archive-source.zip',
				format: 'zip',
			});
			expect(compressed.code === 'COMMAND_NOT_FOUND', 'zip is not installed in this test environment').toBe(
				false,
			);
			expect(compressed.type, JSON.stringify(compressed)).toBe('completed');
			await requestWorkspace(workspace.socket, 'filesystem.remove', { paths: ['/archive-source.txt'] });
			const decompressed = await runArchive(workspace.socket, 'decompress', { source: '/archive-source.zip' });
			expect(decompressed.code === 'COMMAND_NOT_FOUND', 'unzip is not installed in this test environment').toBe(
				false,
			);
			expect(decompressed.type).toBe('completed');
			await expect(readRemoteText(workspace.socket, '/archive-source.txt')).resolves.toContain('archive-me');
		}
	} finally {
		await closeWebSocket(workspace.socket);
	}
});
test('distinct archive destinations can run concurrently in one Workspace', async ({ request, ssh, httpClients }) => {
	await loginAsAdmin(request);
	const fixture = await fetch(`${ssh.controlUrl}/fixture?name=archive-second.txt&size=64`, { method: 'POST' });
	expect(fixture.ok).toBeTruthy();
	const connectionId = await createSshConnection(request, ssh);
	const workspace = await httpClients.openWorkspace(connectionId, `archive-concurrent-${crypto.randomUUID()}`);
	await fetch(`${ssh.controlUrl}/archive/exec-delay?ms=1200`, { method: 'POST' });
	try {
		await waitForFilesystemReady(workspace.socket);
		const [first, second] = await Promise.all([
			runArchive(workspace.socket, 'compress', {
				sources: ['/archive-source.txt'],
				destination: '/archive-source.zip',
				format: 'zip',
			}),
			runArchive(workspace.socket, 'compress', {
				sources: ['/archive-second.txt'],
				destination: '/archive-second.zip',
				format: 'zip',
			}),
		]);
		expect(
			first.code === 'COMMAND_NOT_FOUND' || second.code === 'COMMAND_NOT_FOUND',
			'zip is not installed in this test environment',
		).toBe(false);
		expect(first.type, JSON.stringify(first)).toBe('completed');
		expect(second.type, JSON.stringify(second)).toBe('completed');
		expect(await rootFileNames(workspace.socket)).toEqual(
			expect.arrayContaining(['archive-source.zip', 'archive-second.zip']),
		);
	} finally {
		await fetch(`${ssh.controlUrl}/archive/exec-delay?ms=0`, { method: 'POST' });
		await closeWebSocket(workspace.socket);
	}
});
test('ZIP Unicode Path entries extract Chinese filenames instead of escaped placeholders', async ({
	request,
	ssh,
	httpClients,
}) => {
	await loginAsAdmin(request);
	const connectionId = await createSshConnection(request, ssh);
	const workspace = await httpClients.openWorkspace(connectionId, `archive-unicode-${crypto.randomUUID()}`);
	try {
		await waitForFilesystemReady(workspace.socket);
		const response = await runArchive(workspace.socket, 'decompress', { source: '/中文解压测试.zip' });
		expect(response.code === 'COMMAND_NOT_FOUND', 'unzip is not installed in this test environment').toBe(false);
		expect(response.type).toBe('completed');
		await expect(readRemoteText(workspace.socket, '/中文解压测试')).resolves.toContain('unicode-path-e2e');
		const filenames = await rootFileNames(workspace.socket);
		expect(filenames).toContain('中文解压测试');
		expect(filenames).not.toContain('#U4e2d#U6587#U89e3#U538b#U6d4b#U8bd5');
	} finally {
		await closeWebSocket(workspace.socket);
	}
});
test('password-protected ZIP validates passwords and preserves the normal decompress flow', async ({
	request,
	ssh,
	httpClients,
}) => {
	await loginAsAdmin(request);
	const connectionId = await createSshConnection(request, ssh);
	const workspace = await httpClients.openWorkspace(connectionId, `archive-password-${crypto.randomUUID()}`);
	const specialPassword = 'Nexus !@#$%^&*()_+-=[]{};:\'",.<>/?\\|`~';
	const maxPassword = 'x'.repeat(128);
	try {
		await waitForFilesystemReady(workspace.socket);
		// create a password-protected ZIP with shell-special characters
		{
			const response = await runArchive(workspace.socket, 'compress', {
				sources: ['/archive-source.txt'],
				destination: '/archive-special.zip',
				format: 'zip',
				password: specialPassword,
			});
			expect(response.code === 'COMMAND_NOT_FOUND', 'zip is not installed in this test environment').toBe(false);
			expect(response.type).toBe('completed');
			await requestWorkspace(workspace.socket, 'filesystem.remove', { paths: ['/archive-source.txt'] });
		}
		// decompress without a password reports PASSWORD_REQUIRED without extracting files
		{
			const response = await runArchive(workspace.socket, 'decompress', { source: '/archive-special.zip' });
			expect(response.code === 'COMMAND_NOT_FOUND', 'unzip is not installed in this test environment').toBe(
				false,
			);
			expect(response).toMatchObject({ type: 'failed', code: 'PASSWORD_REQUIRED' });
			expect(await rootFileNames(workspace.socket)).not.toContain('archive-source.txt');
		}
		// wrong password reports INVALID_PASSWORD and correct special-character password succeeds
		{
			await expect(
				runArchive(workspace.socket, 'decompress', {
					source: '/archive-special.zip',
					password: 'definitely-wrong',
				}),
			).resolves.toMatchObject({ type: 'failed', code: 'INVALID_PASSWORD' });
			const correctResponse = await runArchive(workspace.socket, 'decompress', {
				source: '/archive-special.zip',
				password: specialPassword,
			});
			expect(correctResponse.type).toBe('completed');
			await expect(readRemoteText(workspace.socket, '/archive-source.txt')).resolves.toContain('archive-me');
		}
		// 128-character password is accepted and round-trips
		{
			const compressed = await runArchive(workspace.socket, 'compress', {
				sources: ['/archive-source.txt'],
				destination: '/archive-max-password.zip',
				format: 'zip',
				password: maxPassword,
			});
			expect(compressed.type, JSON.stringify(compressed)).toBe('completed');
			await requestWorkspace(workspace.socket, 'filesystem.remove', { paths: ['/archive-source.txt'] });
			const decompressed = await runArchive(workspace.socket, 'decompress', {
				source: '/archive-max-password.zip',
				password: maxPassword,
			});
			expect(decompressed.type).toBe('completed');
		}
		// 129-character and line-break passwords are rejected before shell execution
		{
			await expect(
				runArchive(workspace.socket, 'compress', {
					sources: ['/archive-source.txt'],
					destination: '/archive-too-long.zip',
					format: 'zip',
					password: 'x'.repeat(129),
				}),
			).resolves.toMatchObject({ type: 'failed', code: 'PASSWORD_TOO_LONG' });
			await expect(
				runArchive(workspace.socket, 'compress', {
					sources: ['/archive-source.txt'],
					destination: '/archive-invalid-password.zip',
					format: 'zip',
					password: 'line-one\nline-two',
				}),
			).resolves.toMatchObject({ type: 'failed', code: 'INVALID_PASSWORD_FORMAT' });
			await expect(
				runArchive(workspace.socket, 'compress', {
					sources: ['/archive-source.txt'],
					destination: '/archive-null-password.zip',
					format: 'zip',
					password: `before${String.fromCharCode(0)}after`,
				}),
			).resolves.toMatchObject({ type: 'failed', code: 'INVALID_PASSWORD_FORMAT' });
		}
	} finally {
		await closeWebSocket(workspace.socket);
	}
});
