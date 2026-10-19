import { expect, test, type APIRequestContext } from '../../support/fixtures';
import { loginAsInitialAdmin } from '../../support/auth';
import { createTestSshConnection, trustTestSshHostKey, configureSshE2eSettings } from '../../support/ssh';
import { slowStep, step } from '../../support/steps';
import { E2E_URLS } from '../../support/test-env';
import { readConnectionList } from '../../../../packages/shared/src/targets/connections/http-codec';
const headers = { Origin: E2E_URLS.frontendOrigin };

const ORIGINAL_NAME = 'E2E SSH Lifecycle';
const EDITED_NAME = 'E2E SSH Lifecycle Edited';

async function cleanupConnections(request: APIRequestContext): Promise<void> {
	const response = await request.get('/api/v1/targets/connections');
	expect(response.ok()).toBeTruthy();
	const items = readConnectionList(await response.json());
	for (const item of items.filter(
		(connection) => connection.name === ORIGINAL_NAME || connection.name === EDITED_NAME,
	)) {
		const remove = await request.delete(`/api/v1/targets/connections/${item.id}`, { headers });
		expect(remove.ok()).toBeTruthy();
	}
}

test('saved SSH connection can be tested, renamed without re-entering password, retested, and deleted through UI', async ({
	page,
	context,
}) => {
	await loginAsInitialAdmin(context.request);
	await configureSshE2eSettings(context.request);
	await trustTestSshHostKey(context.request);
	await cleanupConnections(context.request);
	const connectionId = await createTestSshConnection(context.request, ORIGINAL_NAME);
	await page.goto('/connections');

	const row = page
		.getByRole('listitem')
		.filter({ has: page.getByText(/^(E2E SSH Lifecycle|E2E SSH Lifecycle Edited)$/) });
	await expect(row).toContainText(ORIGINAL_NAME);

	await slowStep('saved connection test reaches the real SSH server', async () => {
		const responsePromise = page.waitForResponse(
			(response) =>
				response.url().includes(`/api/v1/targets/connections/${connectionId}/test`) &&
				response.request().method() === 'POST',
		);
		await row.getByRole('button', { name: 'Test', exact: true }).click();
		const response = await responsePromise;
		expect(response.ok()).toBeTruthy();
		await expect(row.locator('.text-success')).toContainText('Connection test successful!');
	});

	await step('edit changes only the name and leaves the stored password untouched', async () => {
		await row.getByRole('button', { name: 'Edit', exact: true }).click();
		const form = page.locator('form.connection-form');
		await expect(form).toBeVisible();
		await expect(form.locator('#conn-name')).toHaveValue(ORIGINAL_NAME);
		await expect(form.locator('#conn-password')).toHaveValue('');
		await form.locator('#conn-name').fill(EDITED_NAME);

		const updatePromise = page.waitForResponse(
			(response) =>
				response.url().endsWith(`/api/v1/targets/connections/${connectionId}`) &&
				response.request().method() === 'PUT',
		);
		await form.getByRole('button', { name: 'Confirm Edit', exact: true }).click();
		const update = await updatePromise;
		expect(update.ok()).toBeTruthy();
		await expect(form).toBeHidden({ timeout: 15_000 });
		await expect(row).toContainText(EDITED_NAME);
	});

	await slowStep('connection still authenticates after the name-only edit', async () => {
		const responsePromise = page.waitForResponse(
			(response) =>
				response.url().includes(`/api/v1/targets/connections/${connectionId}/test`) &&
				response.request().method() === 'POST',
		);
		await row.getByRole('button', { name: 'Test', exact: true }).click();
		const response = await responsePromise;
		expect(response.ok()).toBeTruthy();
		await expect(row.locator('.text-success')).toContainText('Connection test successful!');
	});

	await step('delete from the edit form removes the connection from UI and persistence', async () => {
		await row.getByRole('button', { name: 'Edit', exact: true }).click();
		const form = page.locator('form.connection-form');
		await form.getByRole('button', { name: 'Delete', exact: true }).click();
		const confirm = page.getByRole('dialog').filter({ hasText: EDITED_NAME });
		await expect(confirm).toBeVisible();
		await confirm.getByRole('button', { name: 'Confirm', exact: true }).click();
		await expect(row).toHaveCount(0, { timeout: 15_000 });

		await expect
			.poll(async () => {
				const response = await context.request.get('/api/v1/targets/connections');
				expect(response.ok()).toBeTruthy();
				const items = readConnectionList(await response.json());
				return items.some((item) => item.id === connectionId);
			})
			.toBeFalsy();
	});
});
