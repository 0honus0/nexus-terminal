import { test, expect } from '../../support/fixtures';
import { loginAsInitialAdmin, setUiLanguage } from '../../support/auth';
import { E2E_URLS } from '../../../support/protocols/test-environment';
import { readMutationClaim } from '../../../../packages/shared/src/remote/mutations/http-codec';

test.use({ e2eDatabaseMode: 'mutation-recovery' });

test('recovery records explicit evidence and separately confirms release, preserved after actual application restart', async ({
	page,
	context,
}) => {
	const errors: string[] = [];
	page.on('pageerror', (cause) => errors.push(cause.message));
	await loginAsInitialAdmin(context.request);
	await setUiLanguage(context.request);
	await page.goto('/settings');
	await page.getByRole('tab', { name: /Data/i }).click();
	await page.getByText('Diagnostics and recovery (advanced)', { exact: true }).click();
	const panel = page.locator('[data-mutation-recovery]');
	await panel.getByRole('button', { name: /^fixture-04/ }).click();
	await expect(panel.locator('[data-mutation-detail]')).toBeVisible();
	await panel.getByRole('checkbox', { name: 'I have independently verified the producer has stopped' }).check();
	await panel
		.getByRole('checkbox', { name: 'I have independently verified the related resources have stopped' })
		.check();
	await panel.locator('#mutation-outcome').click();
	await page.getByRole('option', { name: 'Partially applied', exact: true }).click();
	const observed = new Date(Date.now() - 2000);
	const local = new Date(observed.getTime() - observed.getTimezoneOffset() * 60000).toISOString().slice(0, 19);
	await panel.getByLabel('Observation time', { exact: true }).fill(local);
	await panel
		.getByLabel('Evidence note', { exact: true })
		.fill('Formal panel: fixture resources are stopped; no remote effect was executed.');
	await panel.getByRole('button', { name: 'Record evidence', exact: true }).click();

	const read = async () =>
		readMutationClaim(await (await context.request.get('/api/v1/remote/mutations/fixture-04')).json());

	await expect.poll(async () => (await read()).revision).toBe(3);
	const selected = panel.locator('#mutation-evidence');
	await selected.click();
	const option = page.getByRole('option').first();
	await expect(option).toBeVisible();
	await expect(selected).toHaveAttribute('data-value', '');
	await option.click();
	await panel.getByRole('button', { name: 'Release execution fence', exact: true }).click();
	const dialog = page.getByRole('dialog').filter({ hasText: 'Release this execution fence' });
	await expect(dialog).toBeVisible();
	await dialog.getByRole('button', { name: /Confirm/i }).click();
	await expect.poll(async () => (await read()).state).toBe('released');
	expect(errors).toEqual([]);
	await page.close();
	const token = process.env.NEXUS_E2E_CONTROL_TOKEN;
	if (!token) throw Error('E2E control token missing');
	const restarted = await context.request.post(E2E_URLS.backendControlOrigin + '/restart', {
		headers: { 'X-Nexus-E2E-Control': token },
		data: { mode: 'restart' },
	});
	expect(restarted.status()).toBe(200);
	expect(await restarted.json()).toEqual({ reset: true, mode: 'restart' });
	const persisted = await read();
	expect(persisted.state).toBe('released');
	expect(persisted.revision).toBe(4);
	expect(persisted.evidence).toHaveLength(1);
	expect(persisted.evidence[0].outcome).toBe('partially_applied');
});
