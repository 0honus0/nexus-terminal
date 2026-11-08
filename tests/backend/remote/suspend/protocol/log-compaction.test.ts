import fs from 'node:fs/promises';
import path from 'node:path';
import { readWorkspaceSuspendMarkResponse } from '../../../../../packages/shared/src/remote/suspend/workspace-result-codec';
import { readSuspendedSessionCatalog } from '../../../../../packages/shared/src/remote/suspend/http-codec';
import { expect, test } from '../../../../support/http/ssh-protocol-fixture.mjs';
import { loginAsAdmin } from '../../../../support/http/ssh-protocol-fixture.mjs';
import { createSshConnection } from '../../../../support/http/ssh-targets.ts';
import {
	closeWebSocket,
	consumeTerminalOutput,
	requestWorkspace,
	resumeSuspendedWorkspace,
	waitForBinaryText,
} from '../../../../support/protocols/workspace-client';

test('saturated suspended history compacts in batches and resumes the original live shell', async ({
	request,
	ssh,
	httpClients,
}) => {
	await loginAsAdmin(request);
	const connectionId = await createSshConnection(request, ssh);
	const original = await httpClients.openWorkspace(connectionId, `log-compaction-${crypto.randomUUID()}`);
	const recovery = await httpClients.openSocket();
	const gate = path.join(ssh.root, 'compaction-release');
	let logFile: string | null = null;
	const maxBytes = 100 * 1024 * 1024;
	try {
		await fs.rm(gate, { force: true });
		// Discover the interactive shell before foreground input. Restoring a busy
		// shell must reuse that identity rather than inject a new discovery command.
		await expect(requestWorkspace(original.socket, 'terminal.currentDirectory')).resolves.toBe('/');
		const ready = waitForBinaryText(original.socket, 'COMPACTION_GATE_READY');
		await requestWorkspace(original.socket, 'terminal.input', {
			data: "COMPACTION_SHELL=$$; printf 'COMPACTION_%s\\n' GATE_READY; while [ ! -f \"$NEXUS_E2E_ROOT/compaction-release\" ]; do sleep 0.05; done; i=0; while [ $i -lt 4096 ]; do printf '%0512d\\n' \"$i\"; i=$((i+1)); done; printf 'COMPACTION_%s\\n' OUTPUT_DONE; (while :; do printf 'CONTINUOUS_COMPACTION_OUTPUT\\n'; sleep 0.01; done) & COMPACTION_PRODUCER=$!\r",
		});
		await ready;
		const mark = readWorkspaceSuspendMarkResponse(await requestWorkspace(original.socket, 'suspend.mark'));
		logFile = path.join(
			httpClients.dataDirectory,
			'temp_backend_next_suspended_ssh_logs',
			mark.suspendedSessionId + '.log',
		);
		// Seed retained history through the fixture filesystem rather than replaying 131MB
		// through the terminal renderer. Subsequent output, handoff and history use real wire APIs.
		await fs.mkdir(path.dirname(logFile), { recursive: true });
		const handle = await fs.open(logFile, 'w', 0o600);
		try {
			await handle.truncate(131 * 1024 * 1024);
			const tail = Buffer.from('\nCOMPACTION_SEEDED_TAIL\n');
			await handle.write(tail, 0, tail.length, 131 * 1024 * 1024 - tail.length);
		} finally {
			await handle.close();
		}
		await consumeTerminalOutput(original.socket, async () => {
			const output = waitForBinaryText(original.socket, 'COMPACTION_OUTPUT_DONE', 20_000);
			await fs.writeFile(gate, 'release');
			await output;
		});
		await closeWebSocket(original.socket);
		let suspendedId = '';
		await expect
			.poll(async () => {
				const list = readSuspendedSessionCatalog(await requestWorkspace(recovery, 'suspend.list'));
				suspendedId =
					list.find(
						(entry) =>
							entry.originalWorkspaceId === original.workspaceId && entry.ownershipState === 'available',
					)?.id ?? '';
				return suspendedId;
			})
			.not.toBe('');
		await resumeSuspendedWorkspace(recovery, {
			suspendedSessionId: suspendedId,
			workspaceId: `log-resumed-${crypto.randomUUID()}`,
		});
		const physicalBytes = (await fs.stat(logFile)).size;
		expect(physicalBytes).toBeGreaterThanOrEqual(maxBytes);
		expect(physicalBytes).toBeLessThan(102 * 1024 * 1024);
		await expect(requestWorkspace(recovery, 'terminal.currentDirectory')).resolves.toBe('/');
		const roundtrip = waitForBinaryText(recovery, 'COMPACTION_RESUMED_OK', 15_000);
		await requestWorkspace(recovery, 'terminal.input', {
			data: 'kill "$COMPACTION_PRODUCER"; wait "$COMPACTION_PRODUCER" 2>/dev/null; if [ "$COMPACTION_SHELL" = "$$" ]; then printf \'COMPACTION_%s\\n\' RESUMED_OK; fi\r',
		});
		await roundtrip;
		await requestWorkspace(recovery, 'suspend.unmark');
	} finally {
		await closeWebSocket(original.socket);
		await closeWebSocket(recovery);
		await fs.rm(gate, { force: true });
		if (logFile) {
			await fs.rm(logFile, { force: true });
		}
	}
});
