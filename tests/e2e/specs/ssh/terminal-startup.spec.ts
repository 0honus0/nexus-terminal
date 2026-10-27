import { expect, test } from '../../support/fixtures';
import { loginAsInitialAdmin } from '../../support/auth';
import {
	E2E_SSH,
	configureSshE2eSettings,
	connectTestSshFromConnectionsPage,
	ensureTestSshConnection,
} from '../../support/ssh';

for (const echo of ['on', 'off']) {
	test(`real PTY startup preserves login output with one prompt when echo starts ${echo}`, async ({
		page,
		context,
	}) => {
		await loginAsInitialAdmin(context.request);
		await configureSshE2eSettings(context.request);
		const configured = await fetch(E2E_SSH.controlUrl + '/shell/startup-pty?echo=' + echo, { method: 'POST' });
		expect(configured.status).toBe(204);
		const connectionId = await ensureTestSshConnection(context.request);
		await connectTestSshFromConnectionsPage(page, connectionId);
		const terminal = page.locator('.terminal-inner-container:visible .xterm-rows');

		const readLines = () =>
			terminal.locator(':scope > div').evaluateAll((rows) => {
				const lines = rows.map((row) => (row.textContent ?? '').trimEnd());
				while (lines.at(-1) === '') {
					lines.pop();
				}
				return lines;
			});

		// A real PTY exposes the setup's newline/prompt regressions that the
		// default pipe-backed shell cannot. Keep deliberate login blank lines.
		await expect.poll(readLines).toEqual(['NEXUS_PTY_LOGIN', '', 'NEXUS_PTY_LAST_LOGIN', 'nexus-e2e$']);
		const input = page.locator('input.command-bar-input:visible');
		const command = "printf 'NEXUS_PTY_LINE_A\\n\\nNEXUS_PTY_LINE_B\\n'";
		await input.fill(command);
		await input.press('Enter');
		await expect
			.poll(readLines)
			.toEqual([
				'NEXUS_PTY_LOGIN',
				'',
				'NEXUS_PTY_LAST_LOGIN',
				'nexus-e2e$ ' + command,
				'NEXUS_PTY_LINE_A',
				'',
				'NEXUS_PTY_LINE_B',
				'nexus-e2e$',
			]);
	});
}
