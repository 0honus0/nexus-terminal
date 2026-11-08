import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import assert from 'node:assert/strict';
import { test, vi, afterEach } from 'vitest';
import { openWorkspaceApplication } from '../../../../support/protocols/frontend-workspace.mjs';
import { WorkspaceRuntimeSession } from '../../../../../packages/frontend/src/runtimes/workspace/session/workspaceRuntimeSession.ts';

afterEach(() => vi.unstubAllGlobals());

test('real suspended SSH preserves its PID and history across detach, resume, takeover and release', async () => {
	const fixture = await openWorkspaceApplication();
	const { target, root, directory } = fixture;
	try {
		const sessions = [],
			checks = [];

		const expect = (condition, name) => {
			if (!condition) throw Error(name);
			checks.push(name);
		};

		const wait = async (check) => {
			const end = performance.now() + 20000;
			while (!(await check())) {
				if (performance.now() > end) throw Error('SSH condition timed out');
				await new Promise((resolve) => setTimeout(resolve, 30));
			}
		};

		const make = () => {
			const session = new WorkspaceRuntimeSession(target);
			session.adapters.terminal.onOutput(({ consumed }) => consumed?.());
			sessions.push(session);
			return session;
		};

		const read = async (session, path) => {
			try {
				return (await session.adapters.documents.load(path, 'utf8')).content;
			} catch {
				return undefined;
			}
		};

		try {
			const original = make();
			await original.connect();
			await wait(async () => {
				try {
					await original.adapters.filesystem.stat(root);
					return true;
				} catch {
					return false;
				}
			});
			const id = await original.markForSuspend(async () => 'saved terminal snapshot');
			await wait(() => original.ownershipGeneration !== undefined);
			expect(original.markedForSuspend.value, 'real prepare/commit marks existing PTY');
			original.adapters.terminal.sendInput(
				"echo $$ > '" +
					root +
					"/before.pid'; head -c 786432 /dev/zero | tr '\\000' 'H'; echo done > '" +
					root +
					"/output.done'\n",
			);
			await wait(async () => (await read(original, root + '/output.done')) === 'done\n');
			const before = await read(original, root + '/before.pid');
			expect((await original.close()) === 'detached', 'closing marked tab detaches instead of terminating PTY');
			await original.dispose();
			const restored = make();
			const result = await restored.resume(id);
			expect(
				restored.state.value === 'connected' && result.suspendedSessionId === id,
				'formal Session restores through explicit ACK against real Backend',
			);
			await wait(async () => {
				try {
					await restored.adapters.filesystem.stat(root);
					return true;
				} catch {
					return false;
				}
			});
			restored.adapters.terminal.sendInput("echo $$ > '" + root + "/after.pid'\n");
			await wait(async () => Boolean(await read(restored, root + '/after.pid')));
			expect(
				(await read(restored, root + '/after.pid')) === before,
				'restored terminal preserves original SSH shell PID',
			);
			const reset = await restored.adapters.terminal.resetPreviousOutput();
			expect(reset, 'real history reset reports retained previous bytes');
			const history = await restored.adapters.terminal.loadPreviousOutput(4096);
			expect(
				history !== null && history.data.length > 0 && history.data.length <= 4096,
				'formal terminal consumes bounded NXW1 history page',
			);
			const takeover = make();
			await takeover.resume(id, undefined, { takeover: true });
			await wait(() => !restored.socket.connected);
			expect(
				restored.recoveryRequired.value && takeover.state.value === 'connected',
				'real takeover revokes original attachment and activates only new owner',
			);
			await wait(() => takeover.ownershipGeneration !== undefined);
			await takeover.unmarkSuspend();
			expect(!takeover.markedForSuspend.value, 'real unmark clears retained ownership');
			expect((await takeover.close()) === 'closed', 'unmarked close confirms remote workspace termination');
			assert.equal(checks.length, 9);
		} finally {
			await Promise.all(sessions.map((session) => session.dispose()));
		}
		assert.equal(
			await readFile(join(directory, 'files', 'before.pid'), 'utf8'),
			await readFile(join(directory, 'files', 'after.pid'), 'utf8'),
		);
	} finally {
		await fixture.close();
	}
});
