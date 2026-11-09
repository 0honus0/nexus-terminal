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

test('marked attached workspace stays usable and another authorized socket can take over', async ({
	request,
	ssh,
	httpClients,
}) => {
	await loginAsAdmin(request);

	const connectionId = await createSshConnection(request, ssh);
	const original = await httpClients.openWorkspace(connectionId, `marked-attached-${crypto.randomUUID()}`);
	const other = await httpClients.openSocket();
	try {
		// Workspace connection acceptance precedes the independent SFTP
		// owner and shell integration probes. Prepare must only run once both
		// resources have actually entered their authorized ready states.
		await waitForFilesystemReady(original.socket);
		await expect(requestWorkspace(original.socket, 'terminal.currentDirectory')).resolves.toBe('/');
		// The raw WS fixture has no xterm consumer. Acknowledge exactly the PTY
		// bytes actually received before requiring suspend.prepare to drain its
		// terminal output window, as the production browser client does.
		await acknowledgeTerminalOutput(original.socket);
		await requestWorkspace(original.socket, 'suspend.prepare', {});
		const marked = await requestWorkspace<{ suspendedSessionId: string }>(original.socket, 'suspend.commit', {});
		await expect(requestWorkspace(original.socket, 'terminal.currentDirectory')).resolves.toEqual('/');
		await expect(requestWorkspace(original.socket, 'suspend.owner.renew')).resolves.toMatchObject({
			generation: 1,
		});
		const list = await requestWorkspace<
			Array<{ id: string; ownershipState: string; attachedWorkspaceId?: string }>
		>(other, 'suspend.list');
		expect(list.find((item) => item.id === marked.suspendedSessionId)).toMatchObject({
			ownershipState: 'attached',
			attachedWorkspaceId: original.workspaceId,
		});
		await expect(
			requestWorkspace(other, 'suspend.resume', {
				suspendedSessionId: marked.suspendedSessionId,
				workspaceId: `no-takeover-${crypto.randomUUID()}`,
			}),
		).rejects.toThrow();
		await resumeSuspendedWorkspace(other, {
			suspendedSessionId: marked.suspendedSessionId,
			workspaceId: `takeover-${crypto.randomUUID()}`,
			takeover: true,
		});
		await expect(requestWorkspace(other, 'terminal.currentDirectory')).resolves.toEqual('/');
		await expect(
			requestWorkspace(original.socket, 'terminal.input', { data: 'echo forbidden\r' }),
		).rejects.toThrow();
		await requestWorkspace(other, 'suspend.unmark');
	} finally {
		await closeWebSocket(original.socket);
		await closeWebSocket(other);
	}
});

test('a marked live SSH session survives WebSocket disconnect and resumes the same shell', async ({
	request,
	ssh,
	httpClients,
}) => {
	await loginAsAdmin(request);

	const connectionId = await createSshConnection(request, ssh);
	const original = await httpClients.openWorkspace(connectionId, `suspend-${crypto.randomUUID()}`);

	await requestWorkspace(original.socket, 'suspend.mark');
	await closeWebSocket(original.socket);

	const recoverySocket = await httpClients.openSocket();
	try {
		// The client close handshake can finish before the server flushes retained output
		// and returns ownership. An active session may still belong to the old socket.
		let suspended: SuspendedSession | undefined;
		for (let attempt = 0; attempt < 30 && !suspended; attempt += 1) {
			const list = readSuspendedSessionCatalog(await requestWorkspace(recoverySocket, 'suspend.list'));
			suspended = list.find(
				(session) =>
					session.originalWorkspaceId === original.workspaceId &&
					session.status === 'active' &&
					session.ownershipState === 'available',
			);
			if (!suspended) await new Promise((resolve) => setTimeout(resolve, 150));
		}
		expect(suspended).toBeTruthy();
		expect(suspended).toMatchObject({
			originalWorkspaceId: original.workspaceId,
			connectionId,
			status: 'active',
			ownershipState: 'available',
		});

		const resumedWorkspaceId = `resumed-${crypto.randomUUID()}`;
		const resumed = await resumeSuspendedWorkspace(recoverySocket, {
			suspendedSessionId: suspended!.id,
			workspaceId: resumedWorkspaceId,
		});
		expect(resumed).toMatchObject({
			workspaceId: resumedWorkspaceId,
			connectionId,
			resumedFrom: suspended!.id,
		});
		await waitForFilesystemReady(recoverySocket);

		const listAfter = readSuspendedSessionCatalog(await requestWorkspace(recoverySocket, 'suspend.list'));
		expect(listAfter.find((session) => session.id === suspended!.id)).toMatchObject({
			originalWorkspaceId: original.workspaceId,
			connectionId,
			status: 'active',
			ownershipState: 'attached',
			attachedWorkspaceId: resumedWorkspaceId,
		});

		// Resume does not cancel the suspend mark. Its originalWorkspaceId is
		// immutable across attachment generations; the replacement Workspace ID
		// belongs only to the temporary attachedWorkspaceId field. Closing that
		// socket must return the *same* suspended shell ID to available ownership.
		await closeWebSocket(recoverySocket);
		const verifier = await httpClients.openSocket();
		try {
			let resuspended: SuspendedSession | undefined;
			for (let attempt = 0; attempt < 30 && !resuspended; attempt += 1) {
				const list = readSuspendedSessionCatalog(await requestWorkspace(verifier, 'suspend.list'));
				resuspended = list.find(
					(session) =>
						session.id === suspended!.id &&
						session.originalWorkspaceId === original.workspaceId &&
						session.status === 'active' &&
						session.ownershipState === 'available',
				);
				if (!resuspended) await new Promise((resolve) => setTimeout(resolve, 100));
			}
			expect(resuspended).toBeTruthy();
			expect(resuspended).toMatchObject({
				id: suspended!.id,
				originalWorkspaceId: original.workspaceId,
				connectionId,
				status: 'active',
				ownershipState: 'available',
			});
			expect(resuspended!.attachedWorkspaceId).toBeUndefined();
			await requestWorkspace(verifier, 'suspend.terminate', { suspendedSessionId: resuspended!.id });
		} finally {
			await closeWebSocket(verifier);
		}
	} finally {
		await closeWebSocket(recoverySocket);
	}
});

test('a second device explicitly takes over an attached suspended SSH owner without replacing the shell', async ({
	request,
	ssh,
	httpClients,
}) => {
	await loginAsAdmin(request);

	const connectionId = await createSshConnection(request, ssh);
	const original = await httpClients.openWorkspace(connectionId, `takeover-origin-${crypto.randomUUID()}`);
	const marker = `TAKEOVER_${crypto.randomUUID().replaceAll('-', '')}`;
	const originalMarkerOutput = waitForBinaryText(original.socket, marker);
	await requestWorkspace(original.socket, 'terminal.input', {
		data: `export NEXUS_TAKEOVER_MARKER=${marker}; cd folder-seed; printf '${marker}\n'\n`,
	});
	await originalMarkerOutput;
	await requestWorkspace(original.socket, 'suspend.mark');
	await closeWebSocket(original.socket);

	const ownerA = await httpClients.openSocket();
	const ownerB = await httpClients.openSocket();
	let suspended: SuspendedSession | undefined;
	try {
		for (let attempt = 0; attempt < 30 && !suspended; attempt += 1) {
			const list = readSuspendedSessionCatalog(await requestWorkspace(ownerA, 'suspend.list'));
			suspended = list.find(
				(session) =>
					session.originalWorkspaceId === original.workspaceId &&
					session.status === 'active' &&
					session.ownershipState === 'available',
			);
			if (!suspended) await new Promise((resolve) => setTimeout(resolve, 100));
		}
		expect(suspended).toBeTruthy();

		const workspaceA = `takeover-a-${crypto.randomUUID()}`;
		const resumedA = await resumeSuspendedWorkspace(ownerA, {
			suspendedSessionId: suspended!.id,
			workspaceId: workspaceA,
		});
		expect(resumedA).toMatchObject({ workspaceId: workspaceA, resumedFrom: suspended!.id });
		await waitForFilesystemReady(ownerA);

		const attached = readSuspendedSessionCatalog(await requestWorkspace(ownerB, 'suspend.list')).find(
			(session) => session.id === suspended!.id,
		);
		expect(attached).toMatchObject({
			status: 'active',
			ownershipState: 'attached',
			attachedWorkspaceId: workspaceA,
			ownershipGeneration: resumedA.ownershipGeneration,
		});

		await expect(
			requestWorkspace(ownerB, 'suspend.resume', {
				suspendedSessionId: suspended!.id,
				workspaceId: `takeover-denied-${crypto.randomUUID()}`,
			}),
		).rejects.toMatchObject({ code: 'conflict' });

		const revokedA = new Promise<{ reason?: string; generation?: number }>((resolve, reject) => {
			const timeout = setTimeout(
				() => reject(new Error('Timed out waiting for suspended ownership revoke')),
				10_000,
			);

			const onMessage = (raw: Buffer, isBinary: boolean) => {
				if (isBinary) return;
				let message: { type?: string; payload?: { reason?: string; generation?: number } };
				try {
					message = JSON.parse(Buffer.from(raw).toString('utf8')) as typeof message;
				} catch {
					return;
				}
				if (message.type !== 'suspend.revoked') return;
				clearTimeout(timeout);
				ownerA.off('message', onMessage);
				resolve(message.payload ?? {});
			};

			ownerA.on('message', onMessage);
		});
		const ownerAClosed = new Promise<{ code: number; reason: string }>((resolve, reject) => {
			const timeout = setTimeout(
				() => reject(new Error('Timed out waiting for revoked owner socket close')),
				10_000,
			);
			ownerA.once('close', (code: number, reason: Buffer) => {
				clearTimeout(timeout);
				resolve({ code, reason: reason.toString('utf8') });
			});
		});

		const workspaceB = `takeover-b-${crypto.randomUUID()}`;
		const resumedB = await resumeSuspendedWorkspace(ownerB, {
			suspendedSessionId: suspended!.id,
			workspaceId: workspaceB,
			takeover: true,
		});
		expect(resumedB).toMatchObject({ workspaceId: workspaceB, resumedFrom: suspended!.id });
		expect(resumedB.ownershipGeneration).toBeGreaterThan(resumedA.ownershipGeneration);
		await expect(revokedA).resolves.toMatchObject({ reason: 'takeover', generation: resumedA.ownershipGeneration });
		await expect(ownerAClosed).resolves.toMatchObject({
			code: 1008,
			reason: 'Suspended owner revoked',
		});

		const sameShellOutput = waitForBinaryText(ownerB, `TAKEOVER_STATE=${marker}`);
		await requestWorkspace(ownerB, 'terminal.input', {
			data: `printf 'TAKEOVER_STATE=%s CWD=%s\n' "$NEXUS_TAKEOVER_MARKER" "$PWD"\n`,
		});
		const terminalOutput = await sameShellOutput;
		expect(terminalOutput).toContain(`TAKEOVER_STATE=${marker}`);
		expect(terminalOutput).toContain('folder-seed');

		const afterTakeover = readSuspendedSessionCatalog(await requestWorkspace(ownerB, 'suspend.list')).find(
			(session) => session.id === suspended!.id,
		);
		expect(afterTakeover).toMatchObject({
			status: 'active',
			ownershipState: 'attached',
			attachedWorkspaceId: workspaceB,
			ownershipGeneration: resumedB.ownershipGeneration,
		});
		await requestWorkspace(ownerB, 'suspend.unmark');
	} finally {
		await closeWebSocket(ownerA);
		await closeWebSocket(ownerB);
		if (suspended)
			await request.delete(`/api/v1/ssh-suspend/terminate/${suspended.id}`, { headers }).catch(() => undefined);
	}
});

test('closing a resume request rolls the handoff back to the original suspended shell', async ({
	request,
	ssh,
	httpClients,
}) => {
	await loginAsAdmin(request);

	const connectionId = await createSshConnection(request, ssh);
	const original = await httpClients.openWorkspace(connectionId, `resume-rollback-${crypto.randomUUID()}`);
	await requestWorkspace(original.socket, 'suspend.mark', { terminalSnapshot: 'ROLLBACK_HISTORY\r\n' });
	await closeWebSocket(original.socket);

	const recoverySocket = await httpClients.openSocket();
	let suspended: SuspendedSession | undefined;
	for (let attempt = 0; attempt < 30 && !suspended; attempt += 1) {
		const list = readSuspendedSessionCatalog(await requestWorkspace(recoverySocket, 'suspend.list'));
		suspended = list.find(
			(session) =>
				session.originalWorkspaceId === original.workspaceId &&
				session.status === 'active' &&
				session.ownershipState === 'available',
		);
		if (!suspended) await new Promise((resolve) => setTimeout(resolve, 100));
	}
	expect(suspended).toBeTruthy();

	const interruptedWorkspaceId = `interrupted-resume-${crypto.randomUUID()}`;
	sendJson(recoverySocket, {
		type: 'suspend.resume',
		requestId: crypto.randomUUID(),
		payload: {
			suspendedSessionId: suspended!.id,
			workspaceId: interruptedWorkspaceId,
		},
	});
	await closeWebSocket(recoverySocket);

	const verifier = await httpClients.openSocket();
	try {
		let recoverable: SuspendedSession | undefined;
		for (let attempt = 0; attempt < 40 && !recoverable; attempt += 1) {
			const list = readSuspendedSessionCatalog(await requestWorkspace(verifier, 'suspend.list'));
			// If close wins before commit, rollback preserves the original suspended id. If commit wins
			// first, the still-marked replacement is immediately suspended on socket close. Either way
			// the same shell must remain recoverable instead of being terminated.
			recoverable = list.find(
				(session) =>
					session.status === 'active' &&
					session.ownershipState === 'available' &&
					(session.id === suspended!.id || session.originalWorkspaceId === interruptedWorkspaceId),
			);
			if (!recoverable) await new Promise((resolve) => setTimeout(resolve, 100));
		}
		expect(recoverable).toBeTruthy();

		const retryWorkspaceId = `resume-retry-${crypto.randomUUID()}`;
		const retried = await resumeSuspendedWorkspace(verifier, {
			suspendedSessionId: recoverable!.id,
			workspaceId: retryWorkspaceId,
		});
		expect(retried).toMatchObject({ workspaceId: retryWorkspaceId, resumedFrom: recoverable!.id });
		await requestWorkspace(verifier, 'suspend.unmark');
	} finally {
		await closeWebSocket(verifier);
	}
});
