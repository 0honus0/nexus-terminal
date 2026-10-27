import { expect, test } from '../../support/fixtures';
import { loginAsInitialAdmin, setUiLanguage, updateUiPreferences } from '../../support/auth';
import { configureSshE2eSettings, ensureTestSshConnection } from '../../support/ssh';

test('server status keeps values aligned and contained in narrow, short and zoomed panes', async ({
	page,
	context,
}, testInfo) => {
	test.setTimeout(60_000);
	await loginAsInitialAdmin(context.request);
	await configureSshE2eSettings(context.request);
	await setUiLanguage(context.request, 'zh-CN');
	await updateUiPreferences(context.request, (preferences) => {
		preferences.statusMonitorScale = 1;
	});
	// Use the screenshot's longer capacity values while preserving the real SSH status transport.
	await page.routeWebSocket('**/ws/workspace', (socket) => {
		const server = socket.connectToServer();
		server.onMessage((message) => {
			if (typeof message === 'string') {
				const frame = JSON.parse(message);
				if (frame.type === 'status.sample') {
					Object.assign(frame.payload, {
						cpuPercent: 4.2,
						loadAvg: [1.57, 1.57, 1.57],
						memUsed: 12.1 * 1024,
						memTotal: 93.7 * 1024,
						memPercent: 12.9,
						swapUsed: 0,
						swapTotal: 0,
						swapPercent: 0,
						diskUsed: 127.8 * 1024 * 1024,
						diskTotal: 915.7 * 1024 * 1024,
						diskPercent: 15,
						netInterface: 'enp35s0',
						netRxRate: 197.9 * 1024,
						netTxRate: 30.1 * 1024,
					});
					socket.send(JSON.stringify(frame));
					return;
				}
			}
			socket.send(message);
		});
	});
	await ensureTestSshConnection(context.request);
	await page.goto('/connections');
	await page
		.locator('.connection-card')
		.filter({ hasText: 'E2E SSH' })
		.getByRole('button', { name: '连接', exact: true })
		.click();
	await expect(page.getByRole('tab', { selected: true })).toHaveAttribute('data-session-state', 'connected', {
		timeout: 35_000,
	});
	const monitor = page.locator('.status-monitor:visible').first();
	const resources = monitor.locator('.metric-row:not(.network-row)');
	const labels = [
		'CPU 4.2% 负载 1.57',
		'内存 12.9% 12.1 / 93.7 GB',
		'Swap 0.0% 0 / 0 GB',
		'磁盘 15.0% 127.8 / 915.7 GB',
	];
	await expect(resources).toHaveCount(4);
	await expect(monitor.locator('.network-interface')).toHaveText('enp35s0');
	await expect(monitor.locator('.network-row')).toHaveAttribute('aria-label', /↓ .*197\.9.* ↑ .*30\.1/);
	await expect(monitor.locator('.rate-down .fa-arrow-down')).toBeVisible();
	await expect(monitor.locator('.rate-up .fa-arrow-up')).toBeVisible();
	await expect(monitor.locator('.rate-down b')).toHaveText('197.9K/s');
	await expect(monitor.locator('.rate-up b')).toHaveText('30.1K/s');

	for (const scale of [1, 1.6]) {
		if (scale === 1.6) {
			for (let step = 0; step < 10; step++)
				await monitor.dispatchEvent('wheel', { ctrlKey: true, deltaY: -100, deltaMode: 0 });
		}
		await expect(monitor).toHaveAttribute('data-status-scale', scale.toFixed(2));
		for (const size of [
			{ width: 294, height: 416 },
			{ width: 180, height: 240 },
			{ width: 220, height: 300 },
			{ width: 320, height: 420 },
			{ width: 480, height: 220 },
			{ width: 800, height: 180 },
			{ width: 1000, height: 220 },
		]) {
			await monitor.evaluate((element, size) => {
				Object.assign((element as HTMLElement).style, {
					position: 'fixed',
					top: '40px',
					left: '40px',
					width: `${size.width}px`,
					height: `${size.height}px`,
					zIndex: '1000',
				});
			}, size);
			await expect(resources).toHaveCount(4);
			for (let index = 0; index < labels.length; index++) {
				await expect(resources.nth(index)).toHaveAttribute('aria-label', labels[index]);
			}
			const layout = await monitor.evaluate((element) => {
				const rect = (target: Element) => {
					const { left, right, top, bottom, width, height } = target.getBoundingClientRect();
					return { left, right, top, bottom, width, height };
				};

				return {
					pane: rect(element),
					cards: [...element.querySelectorAll('.metric-row:not(.network-row)')].map((card) => ({
						card: rect(card),
						nameVisible: Boolean(card.querySelector('.metric-name')?.getClientRects().length),
						percentageVisible: [...card.querySelectorAll('.metric-reading, .metric-track-label')].some(
							(part) => part.getClientRects().length > 0,
						),
						parts: [
							...card.querySelectorAll(
								'.metric-icon, .metric-name, .metric-value, .metric-reading, .metric-track, .metric-track-label',
							),
						]
							.filter((part) => part.getClientRects().length > 0)
							.map(rect),
						valueOverflow: (() => {
							const value = card.querySelector('.metric-value');
							return value ? value.scrollWidth - value.clientWidth : 0;
						})(),
					})),
				};
			});
			for (const metric of layout.cards) {
				const diagnostic = JSON.stringify({ scale, size, metric });
				expect(metric.card.width, diagnostic).toBeGreaterThan(0);
				expect(metric.card.height, diagnostic).toBeGreaterThan(0);
				expect(metric.card.left, diagnostic).toBeGreaterThanOrEqual(layout.pane.left - 1);
				expect(metric.card.right, diagnostic).toBeLessThanOrEqual(layout.pane.right + 1);
				expect(metric.card.bottom, diagnostic).toBeLessThanOrEqual(layout.pane.bottom + 1);
				// Compact panes intentionally hide decorative icons; label and percentage must remain visible.
				expect(metric.nameVisible, diagnostic).toBe(true);
				expect(metric.percentageVisible, diagnostic).toBe(true);
				// Bounds are transformed screen pixels; preserve the same one-CSS-pixel tolerance at every scale.
				const roundingTolerance = scale;
				for (const bounds of metric.parts) {
					expect(bounds.left, diagnostic).toBeGreaterThanOrEqual(metric.card.left - roundingTolerance);
					expect(bounds.right, diagnostic).toBeLessThanOrEqual(metric.card.right + roundingTolerance);
					expect(bounds.top, diagnostic).toBeGreaterThanOrEqual(metric.card.top - roundingTolerance);
					expect(bounds.bottom, diagnostic).toBeLessThanOrEqual(metric.card.bottom + roundingTolerance);
				}
				expect(metric.valueOverflow, diagnostic).toBeLessThanOrEqual(1);
			}

			if (scale === 1.6 && size.width === 294)
				await monitor.screenshot({ path: testInfo.outputPath('status-narrow-zoomed.png') });
			await monitor.getByRole('button', { name: /^CPU / }).click();
			const history = monitor.locator('.history-card');
			const chart = history.locator('.status-history-chart');
			await expect(history).toBeVisible();
			for (const range of [1, 5, 10, 30]) {
				const button = history.getByRole('button', { name: `${range}分`, exact: true });
				await expect(button).toBeVisible();
				await button.click();
				await expect(button).toHaveAttribute('aria-pressed', 'true');
				await expect(chart).toHaveAttribute('data-range-minutes', String(range));
				const box = (await button.boundingBox())!;
				const pane = (await monitor.boundingBox())!;
				const controls = (await history.locator('.range-tabs').boundingBox())!;
				expect(box.y).toBeGreaterThanOrEqual(controls.y);
				expect(box.y + box.height).toBeLessThanOrEqual(controls.y + controls.height);
				expect(box.x).toBeGreaterThanOrEqual(pane.x);
				expect(box.x + box.width).toBeLessThanOrEqual(pane.x + pane.width);
				expect(box.y + box.height).toBeLessThanOrEqual(pane.y + pane.height);
			}
			const close = history.getByRole('button', { name: '关闭趋势图', exact: true });
			await expect(close).toBeVisible();
			// Global button minimums must not stretch the compact title/close row.
			const headingBox = (await history.locator('.history-heading').boundingBox())!;
			expect(headingBox.height).toBeLessThanOrEqual(17);
			await expect(history.locator('.history-current')).toHaveText('4.2%');

			const canvas = chart.locator('canvas');
			await expect(canvas).toBeVisible();
			const geometry = await canvas.evaluate((element: HTMLCanvasElement) => {
				const rect = element.getBoundingClientRect();
				return {
					width: rect.width,
					height: rect.height,
					pixelsWide: element.width,
					pixelsHigh: element.height,
				};
			});
			expect(geometry.height).toBeGreaterThan(0);
			expect(geometry.width).toBeGreaterThan(0);
			expect(geometry.pixelsHigh).toBeGreaterThanOrEqual(Math.floor(geometry.height));
			expect(geometry.pixelsWide).toBeGreaterThanOrEqual(Math.floor(geometry.width));
			if (scale === 1.6 && size.width === 294)
				await monitor.screenshot({ path: testInfo.outputPath('status-history-narrow-zoomed.png') });
			await close.click();
			await expect(history).toHaveCount(0);
		}
	}
});
