import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { test, vi, afterEach } from 'vitest';
import { openWorkspaceApplication } from '../../../../support/protocols/frontend-workspace.mjs';
import { WorkspaceRuntimeSession } from '../../../../../packages/frontend/src/runtimes/workspace/session/workspaceRuntimeSession.ts';

afterEach(() => vi.unstubAllGlobals());

test('real SSH workspace preserves PTY state, directory, offline output, resize and acknowledged close', async () => {
	const fixture = await openWorkspaceApplication();
	const { target } = fixture;
	try {
		const session = new WorkspaceRuntimeSession(target);
		const result = [];
		let output = '';
		const decoder = new TextDecoder();
		const off = session.adapters.terminal.onOutput(({ data, consumed }) => {
			output += decoder.decode(data, { stream: true });
			consumed?.();
		});

		const expect = (condition, name) => {
			if (!condition) throw Error(name);
			result.push(name);
		};

		const until = (check) => vi.waitUntil(check, { timeout: 12000, interval: 20 });

		try {
			await session.adapters.terminal.resize({ columns: 100, rows: 30 });
			const first = await session.connect();
			expect(
				session.state.value === 'connected' && first.lastConnectedAt > 1700000000000,
				'formal connect with real SSH and seconds mapping',
			);
			// Confirm actual shell initialization before exercising the directory integration.
			await session.adapters.terminal.sendInput("printf '\\n%s%s\\n' 'C2_' 'SHELL_READY'\n");
			await until(() => output.includes('C2_SHELL_READY'));
			const previousDirectory = await session.adapters.terminalDirectory.readCurrentDirectory();
			expect(previousDirectory.startsWith('/'), 'formal current directory reads real interactive shell');
			let directoryTimer;
			try {
				const changed = await Promise.race([
					session.adapters.terminalDirectory.changeDirectory('/tmp'),
					new Promise((_, reject) => {
						directoryTimer = setTimeout(() => reject(Error('Real directory change deadline')), 12000);
					}),
				]);
				expect(changed.path === '/tmp', 'formal directory change confirms actual shell event');
			} finally {
				clearTimeout(directoryTimer);
			}
			expect(
				(await session.adapters.terminalDirectory.readCurrentDirectory()) === '/tmp',
				'real directory reread confirms shell effect',
			);
			await session.adapters.terminal.sendInput(
				'C2_OWNER_PID=$$; printf \'\\nC2_INITIAL_%s\\n\' "$C2_OWNER_PID"\n',
			);
			await until(() => /C2_INITIAL_[0-9]+/.test(output), 'initial shell marker');
			const pid = output.match(/C2_INITIAL_([0-9]+)/)[1];
			const before = output.length;
			await session.adapters.terminal.sendInput(
				"(sleep 1; printf '\\nC2_OFFLINE_%s\\n' \"$C2_OWNER_PID\"; printf '%s' \"$C2_OWNER_PID\" > '" +
					join(fixture.root, 'offline-complete') +
					"') & printf '\\n%s%s\\n' 'C2_' 'BACKGROUND_READY'\n",
			);
			await until(
				() => output.slice(before).includes('C2_BACKGROUND_READY'),
				'background command accepted before detach',
			);
			session.socket.close('controlled browser transport detach');
			await vi.waitUntil(
				async () => {
					try {
						return (await readFile(join(fixture.root, 'offline-complete'), 'utf8')).trim() === pid;
					} catch (cause) {
						if (cause.code !== 'ENOENT') throw cause;
						return false;
					}
				},
				{ timeout: 12000, interval: 20 },
			);
			const resumed = await session.connect();
			expect(
				resumed.attachmentGeneration === first.attachmentGeneration + 1 &&
					resumed.resumeToken !== first.resumeToken,
				'formal resume commits next ownership generation',
			);
			await until(
				() => output.slice(before).includes('C2_OFFLINE_' + pid),
				'offline/live output preserved on same shell',
			);
			await session.adapters.terminal.sendInput('printf \'\\nC2_RESUMED_%s_%s\\n\' "$C2_OWNER_PID" "$$"\n');
			await until(
				() => output.includes('C2_RESUMED_' + pid + '_' + pid),
				'same shell remains writable after explicit ACK',
			);
			expect(
				output.includes('C2_RESUMED_' + pid + '_' + pid),
				'same remote PID and shell variable survive formal resume',
			);
			await session.adapters.terminal.resize({ columns: 111, rows: 35 });
			await session.adapters.terminal.sendInput("printf '\\nC2_SIZE_'; stty size\n");
			await until(() => /C2_SIZE_35 111/.test(output), 'remote viewport applied');
			expect(/C2_SIZE_35 111/.test(output), 'formal resize changes actual remote PTY dimensions');
			expect(
				(await session.adapters.terminalDirectory.readCurrentDirectory()) === '/tmp',
				'directory integration survives normal resume',
			);
			expect(
				(await session.close()) === 'closed',
				'formal close is acknowledged on attached real backend socket',
			);
			expect(!session.socket.connected, 'formal close detaches transport');
			assert.equal(result.length, 10);
		} finally {
			off();
			await session.dispose();
		}
	} finally {
		await fixture.close();
	}
});
