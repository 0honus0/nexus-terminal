import { test, expect, loginAsAdmin, HTTP_TEST_ORIGIN } from '../../../../support/http/ssh-protocol-fixture.mjs';
import { createSshConnection } from '../../../../support/http/ssh-targets';
import type { SuspendedSessionView as SuspendedSession } from '../../../../../packages/shared/src/remote/suspend/http';
import { readSuspendedSessionCatalog } from '../../../../../packages/shared/src/remote/suspend/http-codec';
import { readWorkspaceSuspendViewport } from '../../../../../packages/shared/src/remote/suspend/workspace-result-codec';
import {
	acknowledgeTerminalOutput,
	closeWebSocket,
	decodeWorkspaceBinaryFrame,
	requestWorkspace,
	requestWorkspaceBinary,
	resumeSuspendedWorkspace,
	sendJson,
	waitForFilesystemReady,
	waitForBinaryText,
	waitForJson,
} from '../../../../support/protocols/workspace-client';
const headers = { Origin: HTTP_TEST_ORIGIN };

test('compare initial connection shell readiness with optional filesystem initialization blocked', async ({
	request,
	ssh,
	httpClients,
}) => {
	await loginAsAdmin(request);

	const connectionId = await createSshConnection(request, ssh);
	const samples = [];
	for (const blocked of [false, true]) {
		for (let sample = 0; sample < 3; sample++) {
			const socket = await httpClients.openSocket();
			try {
				expect(
					(
						await fetch(`${ssh.controlUrl}/sftp/realpath-gate?blocked=${blocked ? 1 : 0}`, {
							method: 'POST',
						})
					).ok,
				).toBe(true);
				const start = performance.now();
				await requestWorkspace(socket, 'workspace.connect', {
					connectionId,
					workspaceId: `init-profile-${crypto.randomUUID()}`,
					viewport: { columns: 100, rows: 30 },
				});
				const connectedMs = performance.now() - start;
				if (blocked)
					await expect
						.poll(async () => (await (await fetch(`${ssh.controlUrl}/sftp/realpath-gate`)).json()).pending)
						.toBe(1);
				const marker = `INIT_OK_${crypto.randomUUID()}`;
				const output = waitForBinaryText(socket, marker);
				const inputStart = performance.now();
				const split = Math.floor(marker.length / 2);
				await requestWorkspace(socket, 'terminal.input', {
					data: `printf '%s%s\\n' '${marker.slice(0, split)}' '${marker.slice(split)}'\r`,
				});
				await output;
				const shellMs = performance.now() - inputStart;
				expect((await fetch(`${ssh.controlUrl}/sftp/realpath-gate?blocked=0`, { method: 'POST' })).ok).toBe(
					true,
				);
				await waitForFilesystemReady(socket);
				expect(await requestWorkspace(socket, 'filesystem.list', { path: '/' })).toBeTruthy();
				samples.push({ blocked, sample, connectedMs, shellMs });
			} finally {
				try {
					expect((await fetch(`${ssh.controlUrl}/sftp/realpath-gate?blocked=0`, { method: 'POST' })).ok).toBe(
						true,
					);
				} finally {
					await closeWebSocket(socket);
				}
			}
		}
	}
	console.log('[initial capability profile]', JSON.stringify(samples));
});

for (const outcome of ['ready', 'error', 'closed'] as const) {
	test(`suspend resume keeps shell usable while filesystem initialization is gated: ${outcome}`, async ({
		request,
		ssh,
		httpClients,
	}) => {
		await loginAsAdmin(request);

		const original = await httpClients.openWorkspace(await createSshConnection(request, ssh));
		await waitForFilesystemReady(original.socket);
		// Shell discovery must finish before the first attachment is detached.
		// After user foreground input, the service deliberately refuses to
		// inject a new PID-discovery probe into an unverified PTY program.
		await expect(requestWorkspace(original.socket, 'terminal.currentDirectory')).resolves.toBe('/');
		const marked = await requestWorkspace<{ suspendedSessionId: string }>(original.socket, 'suspend.mark');
		await closeWebSocket(original.socket);
		const socket = await httpClients.openSocket();

		const gate = async (blocked: boolean) => {
			expect(
				(
					await fetch(
						`${ssh.controlUrl}/sftp/realpath-gate?blocked=${blocked ? 1 : 0}&deny=${outcome === 'error' ? 1 : 0}`,
						{ method: 'POST' },
					)
				).ok,
			).toBe(true);
		};

		try {
			await gate(true);
			const filesystemEvents: string[] = [];
			socket.on('message', (data: Buffer, binary: boolean) => {
				if (binary) return;
				const message = JSON.parse(data.toString());
				if (message.type === 'filesystem.ready' || message.type === 'filesystem.error')
					filesystemEvents.push(message.type);
			});
			const started = performance.now();
			const resumed = resumeSuspendedWorkspace(socket, {
				suspendedSessionId: marked.suspendedSessionId,
				workspaceId: `gated-${crypto.randomUUID()}`,
			});
			await expect
				.poll(async () => (await (await fetch(`${ssh.controlUrl}/sftp/realpath-gate`)).json()).pending)
				.toBe(1);
			await resumed;
			console.log('[gated resume profile]', JSON.stringify({ outcome, resumeMs: performance.now() - started }));
			expect(filesystemEvents).toEqual([]);
			const output = waitForBinaryText(socket, 'GATED_SHELL_OK');
			await requestWorkspace(socket, 'terminal.input', { data: "printf 'GATED_%s\\n' SHELL_OK\r" });
			await output;
			if (outcome === 'closed') {
				await closeWebSocket(socket);
				await gate(false);
				await expect
					.poll(async () => {
						const response = await request.get('/api/v1/ssh-suspend/suspended-sessions');
						expect(response.ok()).toBe(true);
						const sessions = await response.json();
						return sessions.find(
							(session: { id: string; ownershipState: string }) =>
								session.id === marked.suspendedSessionId,
						)?.ownershipState;
					})
					.toBe('available');
				const next = await httpClients.openSocket();
				try {
					const ready = waitForJson(next, (message) => message.type === 'filesystem.ready');
					await resumeSuspendedWorkspace(next, {
						suspendedSessionId: marked.suspendedSessionId,
						workspaceId: `after-gate-${crypto.randomUUID()}`,
					});
					await ready;
					await requestWorkspace(next, 'suspend.unmark');
				} finally {
					await closeWebSocket(next);
				}
			} else {
				const settled = waitForJson(socket, (message) => message.type === `filesystem.${outcome}`);
				await gate(false);
				await settled;
				await expect(requestWorkspace(socket, 'terminal.currentDirectory')).resolves.toEqual('/');
				await requestWorkspace(socket, 'suspend.unmark');
			}
		} finally {
			await fetch(`${ssh.controlUrl}/sftp/realpath-gate`, { method: 'POST' });
			await closeWebSocket(socket);
			await request.delete(`/api/v1/ssh-suspend/terminate/${marked.suspendedSessionId}`, {
				headers: { Origin: HTTP_TEST_ORIGIN },
			});
		}
	});
}
