import { expect, test } from '../../support/fixtures';
import { loginAsInitialAdmin, setUiLanguage } from '../../support/auth';
import { updateTestAppearance } from '../../support/appearance';
import { createTestSshConnection } from '../../support/ssh';
import { createTestNotification } from '../../support/notifications';
import { expectReadableCatalogText } from '../../support/catalog-colors';
import { E2E_URLS } from '../../support/test-env';
import { readTagView } from '../../../../packages/shared/src/targets/tags/http-codec';
import {
	defaultUiTheme,
	darkUiTheme,
} from '../../../../packages/frontend/src/features/appearance/config/default-theme';

for (const theme of ['light', 'dark'] as const) {
	for (const width of [1440, 390, 320]) {
		test(`${theme} management catalogs distinguish names, types, tags and status at ${width}px`, async ({
			page,
			context,
		}, testInfo) => {
			await loginAsInitialAdmin(context.request);
			await setUiLanguage(context.request);
			await updateTestAppearance(context.request, (input) => {
				input.customUiTheme = JSON.stringify(theme === 'dark' ? darkUiTheme : defaultUiTheme);
			});
			await page.setViewportSize({ width, height: 900 });
			const headers = { Origin: E2E_URLS.frontendOrigin };
			const connectionId = await createTestSshConnection(context.request, 'Production server');
			const tagResponse = await context.request.post('/api/v1/targets/tags', {
				headers,
				data: { name: 'Production group' },
			});
			expect(tagResponse.status()).toBe(201);
			const tag = readTagView(await tagResponse.json());
			expect(
				(
					await context.request.post('/api/v1/targets/connections/add-tag', {
						headers,
						data: { connectionIds: [connectionId], tagId: tag.id },
					})
				).status(),
			).toBe(200);
			expect(
				(
					await context.request.post('/api/v1/targets/proxies', {
						headers,
						data: {
							name: 'Authenticated proxy',
							type: 'HTTP',
							host: 'proxy.example.test',
							port: 8080,
							username: 'proxy-user',
							password: 'fixture-password',
						},
					})
				).status(),
			).toBe(201);
			await createTestNotification(context.request, {
				name: 'Disabled notification',
				enabled: false,
				events: [],
				config: {
					kind: 'webhook',
					url: 'https://example.test/hook',
					method: 'POST',
					headers: [],
					bodyTemplate: null,
				},
			});

			const screenshot = async (name: string) => {
				// Capture the actual Chromium surface through CDP for visual review.
				const session = await context.newCDPSession(page);
				try {
					const { data } = await session.send('Page.captureScreenshot', {
						format: 'png',
						captureBeyondViewport: false,
					});
					await testInfo.attach(`${name}-${theme}-${width}`, {
						body: Buffer.from(data, 'base64'),
						contentType: 'image/png',
					});
				} finally {
					await session.detach();
				}
			};

			const noOverflow = async () => {
				expect(
					await page.evaluate(
						() => document.documentElement.scrollWidth - document.documentElement.clientWidth,
					),
				).toBeLessThanOrEqual(1);
			};

			await page.goto('/connections');
			const row = page.locator('.connection-card').filter({ hasText: 'Production server' });
			const nameColor = await expectReadableCatalogText(row.locator('.connection-name'));
			const typeColor = await expectReadableCatalogText(
				row.locator('.connection-protocol').filter({ visible: true }),
			);
			const tagColor = await expectReadableCatalogText(row.locator('.connection-tag').filter({ visible: true }));
			expect(new Set([nameColor, typeColor, tagColor]).size).toBe(3);
			await noOverflow();
			await screenshot('connections');
			const key = page.getByRole('button', { name: 'SSH Key Management', exact: true }).filter({ visible: true });
			if (width > 760) {
				const boxes = await Promise.all(
					[
						key,
						page.getByRole('button', { name: 'Test All', exact: true }),
						page.getByRole('button', { name: 'Connect All', exact: true }),
					].map((button) => button.boundingBox()),
				);
				const [first, second, third] = boxes;
				if (!first || !second || !third) throw new Error('Missing catalog toolbar geometry');
				expect(first.x + first.width).toBeLessThanOrEqual(second.x);
				expect(second.x + second.width).toBeLessThanOrEqual(third.x);
				expect(Math.abs(first.y - third.y)).toBeLessThanOrEqual(1);
			} else {
				await expect(key).toHaveCount(0);
				await page.getByRole('button', { name: 'More actions', exact: true }).click();
			}
			await key.click();
			await expect(
				page
					.getByRole('dialog')
					.filter({ has: page.getByRole('heading', { name: 'SSH Key Management', exact: true }) }),
			).toBeVisible();
			await page
				.getByRole('dialog')
				.filter({ has: page.getByRole('heading', { name: 'SSH Key Management', exact: true }) })
				.getByRole('button', { name: 'Close', exact: true })
				.click();
			await expect(
				page
					.getByRole('dialog')
					.filter({ has: page.getByRole('heading', { name: 'SSH Key Management', exact: true }) }),
			).toBeHidden();
			await row.getByRole('button', { name: 'Edit', exact: true }).click();
			await expectReadableCatalogText(
				page.locator('.ui-token-input__token').filter({ hasText: 'Production group' }),
			);
			await page.locator('form.connection-form').getByRole('button', { name: 'Cancel', exact: true }).click();
			await page.goto('/proxies');
			const proxy = page.getByRole('article').filter({ hasText: 'Authenticated proxy' });
			expect(await expectReadableCatalogText(proxy.locator('.ui-catalog-type-badge'))).not.toBe(
				await expectReadableCatalogText(proxy.locator('.ui-catalog-tag-badge')),
			);
			await expectReadableCatalogText(proxy.locator('.ui-catalog-card__name'));
			await noOverflow();
			await screenshot('proxies');
			await page.goto('/notifications');
			const channel = page.getByRole('article').filter({ hasText: 'Disabled notification' });
			expect(await expectReadableCatalogText(channel.locator('.ui-catalog-type-badge'))).not.toBe(
				await expectReadableCatalogText(channel.locator('.ui-catalog-status-badge')),
			);
			await expectReadableCatalogText(channel.locator('.ui-catalog-card__name'));
			await noOverflow();
			await screenshot('notifications');
		});
	}
}
