import fs from 'node:fs/promises';
import path from 'node:path';
import { expect, test } from '../../support/fixtures';
import { loginAsInitialAdmin } from '../../support/auth';
import { ensureTestSshConnection } from '../../support/ssh';
import {
	closeWebSocket,
	openAuthenticatedWebSocket,
	openWorkspaceSession,
	requestWorkspace,
	waitForBinaryText,
} from '../../support/ws';

test('saturated suspended history compacts in batches and resumes the original live shell', async ({ request }) => {
	await loginAsInitialAdmin(request);
	const connectionId = await ensureTestSshConnection(request);
	const original = await openWorkspaceSession(request, connectionId, `log-compaction-${crypto.randomUUID()}`);
	const recovery = await openAuthenticatedWebSocket(request);
	const logFile = path.resolve(
		__dirname,
		'../../.tmp/backend-data/temp_suspended_ssh_logs',
		`${original.workspaceId}.log`,
	);
	const maxBytes = 100 * 1024 * 1024;
	try {
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
		await requestWorkspace(original.socket, 'suspend.mark');
		const output = waitForBinaryText(original.socket, 'COMPACTION_OUTPUT_DONE', 20_000);
		await requestWorkspace(original.socket, 'terminal.input', {
			data: "COMPACTION_SHELL=$$; i=0; while [ $i -lt 4096 ]; do printf '%0512d\\n' \"$i\"; i=$((i+1)); done; printf 'COMPACTION_%s\\n' OUTPUT_DONE; (while :; do printf 'CONTINUOUS_COMPACTION_OUTPUT\\n'; sleep 0.01; done) & COMPACTION_PRODUCER=$!\r",
		});
		await output;
		await closeWebSocket(original.socket);
		let suspendedId = '';
		await expect
			.poll(async () => {
				const list = await requestWorkspace<
					Array<{ id: string; originalWorkspaceId: string; ownershipState: string }>
				>(recovery, 'suspend.list');
				suspendedId =
					list.find(
						(entry) =>
							entry.originalWorkspaceId === original.workspaceId && entry.ownershipState === 'available',
					)?.id ?? '';
				return suspendedId;
			})
			.not.toBe('');
		await requestWorkspace(recovery, 'suspend.resume', {
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
		await fs.unlink(logFile).catch(() => undefined);
	}
});
