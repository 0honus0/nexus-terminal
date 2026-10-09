import { expect, test } from '../../support/fixtures';
import { loginAsInitialAdmin, setUiLanguage } from '../../support/auth';
import { configureSshE2eSettings, ensureTestSshConnection } from '../../support/ssh';

test('server status keeps values aligned and contained in narrow, short and zoomed panes', async ({
	page,
	context,
}, testInfo) => {
	test.setTimeout(60_000);
	await loginAsInitialAdmin(context.request);
	await configureSshE2eSettings(context.request);
	await setUiLanguage(context.request, 'zh-CN');
	expect((await context.request.put('/api/v1/settings', { data: { statusMonitorScale: 1 } })).ok()).toBeTruthy();
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
	await expect(monitor.locator('.metric-memory .detail-total')).toHaveText('93.7');

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
			const layout = await monitor.evaluate((element) => {
				const rect = (target: Element) => {
					const { left, right, top, bottom } = target.getBoundingClientRect();
					return { left, right, top, bottom };
				};

				return {
					cards: [...element.querySelectorAll('.metric-card:not(.network-card)')].map((card) => ({
						card: rect(card),
						identity: rect(card.querySelector('.metric-identity')!),
						detail: rect(card.querySelector('.metric-detail')!),
						percent: rect(card.querySelector('.metric-percent')!),
						progress: rect(card.querySelector('.metric-progress')!),
						identityOverflow:
							card.querySelector('.metric-identity')!.scrollWidth -
							card.querySelector('.metric-identity')!.clientWidth,
						detailOverflow:
							card.querySelector('.metric-detail')!.scrollWidth -
							card.querySelector('.metric-detail')!.clientWidth,
					})),
				};
			});
			for (const metric of layout.cards) {
				for (const bounds of [metric.identity, metric.detail, metric.percent, metric.progress]) {
					expect(bounds.left, JSON.stringify({ scale, size, metric })).toBeGreaterThanOrEqual(
						metric.card.left - 1,
					);
					expect(bounds.right, JSON.stringify({ scale, size, metric })).toBeLessThanOrEqual(
						metric.card.right + 1,
					);
					expect(bounds.top).toBeGreaterThanOrEqual(metric.card.top - 1);
					expect(bounds.bottom).toBeLessThanOrEqual(metric.card.bottom + 1);
				}
				const progressCenter = (metric.progress.top + metric.progress.bottom) / 2;
				const percentCenter = (metric.percent.top + metric.percent.bottom) / 2;
				expect(Math.abs(progressCenter - percentCenter)).toBeLessThan(2);
				expect(metric.progress.right).toBeLessThan(metric.percent.left);
				expect(metric.progress.right - metric.progress.left).toBeGreaterThan(10);
				expect(metric.percent.top).toBeGreaterThanOrEqual(metric.detail.bottom - 1);
				const identityCenter = (metric.identity.top + metric.identity.bottom) / 2;
				const detailCenter = (metric.detail.top + metric.detail.bottom) / 2;
				expect(Math.abs(identityCenter - detailCenter)).toBeLessThan(2);
				expect(metric.identity.right).toBeLessThanOrEqual(metric.detail.left);
				expect(metric.identityOverflow).toBeLessThanOrEqual(1);
				expect(metric.detailOverflow).toBeLessThanOrEqual(1);
			}
			if (scale === 1.6 && size.width === 294)
				await monitor.screenshot({ path: testInfo.outputPath('status-narrow-zoomed.png') });
			await monitor.locator('.metric-cpu').click();
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
				const close = (await history.locator('.history-close').boundingBox())!;
				expect(Math.abs(box.y + box.height / 2 - close.y - close.height / 2)).toBeLessThan(1);
				expect(box.x + box.width).toBeLessThanOrEqual(close.x + 1);
				expect(box.x).toBeGreaterThanOrEqual(pane.x);
				expect(box.x + box.width).toBeLessThanOrEqual(pane.x + pane.width);
				expect(box.y + box.height).toBeLessThanOrEqual(pane.y + pane.height);
			}
			const controls = history.locator('.history-controls');
			expect((await controls.boundingBox())!.height).toBeLessThanOrEqual(24.1);
			expect(await controls.evaluate((element) => getComputedStyle(element).borderTopStyle)).toBe('solid');
			expect((await chart.locator('canvas').boundingBox())!.height).toBeGreaterThan(20);
			if (scale === 1.6 && size.width === 294)
				await monitor.screenshot({ path: testInfo.outputPath('status-history-narrow-zoomed.png') });
			await history.locator('.history-close').click();
			await expect(history).toHaveCount(0);
		}
	}
});
