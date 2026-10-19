import { expect, test, type APIRequestContext, type BrowserContext, type Page } from '../../support/fixtures';
import { loginAsInitialAdmin } from '../../support/auth';
import { createTestSshConnection } from '../../support/ssh';
import { step } from '../../support/steps';
import { E2E_URLS } from '../../support/test-env';
import { readConnectionList, readConnectionView } from '../../../../packages/shared/src/targets/connections/http-codec';
const headers = { Origin: E2E_URLS.frontendOrigin };

const NAMES = ['E2E Batch SSH A', 'E2E Batch SSH B'];
const NOTES = 'updated-by-batch-e2e';

const connectionCard = (page: Page, name: string) =>
	page.getByRole('listitem').filter({ has: page.getByText(name, { exact: true }) });

const batchModal = (page: Page) =>
	page.getByRole('dialog').filter({ has: page.getByRole('heading', { name: /^Batch Edit Connections/ }) });

async function editNotes(page: Page, notes: string): Promise<void> {
	const modal = batchModal(page);
	await modal.getByRole('checkbox', { name: /^Notes:?$/ }).check();
	await modal.locator('textarea').fill(notes);
	await modal.getByRole('button', { name: 'Save', exact: true }).click();
}

async function cleanup(request: APIRequestContext): Promise<void> {
	const response = await request.get('/api/v1/targets/connections');
	expect(response.ok()).toBeTruthy();
	const items = readConnectionList(await response.json());
	for (const item of items.filter((connection) => NAMES.includes(connection.name ?? ''))) {
		expect((await request.delete(`/api/v1/targets/connections/${item.id}`, { headers })).ok()).toBeTruthy();
	}
}

async function runBatchConnectionEdit(page: Page, context: BrowserContext): Promise<void> {
	await loginAsInitialAdmin(context.request);
	await cleanup(context.request);
	const ids = [
		await createTestSshConnection(context.request, NAMES[0]),
		await createTestSshConnection(context.request, NAMES[1]),
	];

	try {
		await page.goto('/connections');

		await step('select two connections in batch mode', async () => {
			await page.getByRole('switch', { name: 'Batch Edit', exact: true }).click();
			await expect(page.getByRole('switch', { name: 'Batch Edit', exact: true })).toHaveAttribute(
				'aria-checked',
				'true',
			);
			for (const name of NAMES) await connectionCard(page, name).click();
			await expect(page.getByRole('button', { name: 'Edit Selected', exact: true })).toBeEnabled();
		});

		await step('batch edit writes the same notes to both connections', async () => {
			await page.getByRole('button', { name: 'Edit Selected', exact: true }).click();
			const modal = batchModal(page);
			await expect(modal).toBeVisible();
			await editNotes(page, NOTES);
			await expect(modal).toBeHidden({ timeout: 15_000 });

			for (const id of ids) {
				await expect
					.poll(async () => {
						const response = await context.request.get(`/api/v1/targets/connections/${id}`);
						if (!response.ok()) return '';
						return readConnectionView(await response.json()).notes ?? '';
					})
					.toBe(NOTES);
			}
		});
	} finally {
		await cleanup(context.request);
	}
}

test('batch connection edit applies one advanced change to multiple saved connections', async ({ page, context }) => {
	await runBatchConnectionEdit(page, context);
});

test('batch edit reports partial failure and keeps only the failed item selected', async ({ page, context }) => {
	await loginAsInitialAdmin(context.request);
	await cleanup(context.request);
	const ids = [
		await createTestSshConnection(context.request, NAMES[0]),
		await createTestSshConnection(context.request, NAMES[1]),
	];

	try {
		await page.goto('/connections');
		await page.getByRole('switch', { name: 'Batch Edit', exact: true }).click();
		for (const name of NAMES) await connectionCard(page, name).click();
		await expect(page.getByRole('button', { name: 'Edit Selected', exact: true })).toBeEnabled();

		expect((await context.request.delete(`/api/v1/targets/connections/${ids[1]}`, { headers })).ok()).toBeTruthy();

		await page.getByRole('button', { name: 'Edit Selected', exact: true }).click();
		const modal = batchModal(page);
		await expect(modal).toBeVisible();
		await editNotes(page, 'partial-update-survivor');

		await expect(
			page.getByText(
				'Confirmed 1 changes; remaining operations stopped. The record no longer exists. Refresh the list.',
			),
		).toBeVisible();
		await expect(modal).toBeVisible();
		await expect(connectionCard(page, NAMES[0])).not.toHaveClass(/ring-2/);
		await expect(connectionCard(page, NAMES[1])).toHaveClass(/ring-2/);

		const survivor = await context.request.get(`/api/v1/targets/connections/${ids[0]}`);
		expect(survivor.ok()).toBeTruthy();
		expect(readConnectionView(await survivor.json())).toMatchObject({ notes: 'partial-update-survivor' });
		expect((await context.request.get(`/api/v1/targets/connections/${ids[1]}`)).status()).toBe(404);
	} finally {
		await cleanup(context.request);
	}
});

test('batch edit loads auxiliary catalogs only when opened and remains usable when they fail', async ({
	page,
	context,
}) => {
	await loginAsInitialAdmin(context.request);
	await cleanup(context.request);
	const id = await createTestSshConnection(context.request, NAMES[0]);
	let proxyRequests = 0;
	let keyRequests = 0;
	await page.route('**/api/v1/targets/proxies', (route) => {
		proxyRequests += 1;
		void route.abort('failed');
	});
	await page.route('**/api/v1/targets/ssh-keys', (route) => {
		keyRequests += 1;
		void route.abort('failed');
	});

	try {
		await page.goto('/connections');
		expect(proxyRequests).toBe(0);
		expect(keyRequests).toBe(0);

		await page.getByRole('switch', { name: 'Batch Edit', exact: true }).click();
		await connectionCard(page, NAMES[0]).click();
		await page.getByRole('button', { name: 'Edit Selected', exact: true }).click();
		const modal = batchModal(page);
		await expect(modal).toBeVisible();
		await expect.poll(() => proxyRequests).toBeGreaterThan(0);
		await expect.poll(() => keyRequests).toBeGreaterThan(0);
		await expect(
			modal.getByText('Options could not be loaded. Refresh and review.', { exact: true }),
		).toBeVisible();

		await editNotes(page, 'aux-catalog-failure-still-usable');
		await expect(modal).toBeHidden({ timeout: 15_000 });
		const persisted = await context.request.get(`/api/v1/targets/connections/${id}`);
		expect(persisted.ok()).toBeTruthy();
		expect(readConnectionView(await persisted.json())).toMatchObject({ notes: 'aux-catalog-failure-still-usable' });
	} finally {
		await cleanup(context.request);
	}
});

test.describe('narrow connections viewport', () => {
	test.use({
		viewport: { width: 375, height: 812 },
		contextOptions: { screen: { width: 375, height: 812 } },
		hasTouch: true,
		isMobile: true,
	});

	test('batch connection edit remains reachable from row-center selection', async ({ page, context }) => {
		await runBatchConnectionEdit(page, context);
	});
});
