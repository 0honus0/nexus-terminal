import { readWorkspaceMessage } from '../../../../packages/shared/src/remote/workspace/workspace-codec';
import { readRemoteStatusSample } from '../../../../packages/shared/src/remote/monitoring/http-codec';
import { expect, test } from '../../support/fixtures';
import { loginAsInitialAdmin, updateUiPreferences } from '../../support/auth';
import {
	configureSshE2eSettings,
	connectTestSshFromConnectionsPage,
	ensureTestSshConnection,
	resetTestSshFilesystem,
} from '../../support/ssh';

test('status history fits fresh samples within the selected time limit and keeps controls sharp while zooming', async ({
	page,
	context,
}) => {
	test.setTimeout(60_000);
	await page.setViewportSize({ width: 1280, height: 900 });
	await loginAsInitialAdmin(context.request);
	await configureSshE2eSettings(context.request);
	await updateUiPreferences(context.request, (preferences) => {
		preferences.statusMonitorScale = 1;
		preferences.showStatusMonitorIpAddress = true;
	});

	await resetTestSshFilesystem();
	const connectionId = await ensureTestSshConnection(context.request);
	const sampleTimestamps = new Set<number>();
	page.on('websocket', (socket) => {
		if (new URL(socket.url()).pathname !== '/ws/workspace') return;
		socket.on('framereceived', ({ payload }) => {
			if (typeof payload !== 'string') return;
			const frame = readWorkspaceMessage(JSON.parse(String(payload)));
			if (frame.type !== 'status.sample') return;
			const sample = readRemoteStatusSample(frame.payload);
			if (sample.cpuPercent !== undefined) sampleTimestamps.add(sample.timestamp);
		});
	});
	await connectTestSshFromConnectionsPage(page, connectionId);

	const monitor = page.locator('.status-monitor:visible').first();
	await expect(monitor).toBeVisible({ timeout: 20_000 });
	await expect(monitor.getByRole('button', { name: /^CPU / })).toBeVisible({ timeout: 20_000 });
	await monitor.getByRole('button', { name: /^CPU / }).hover();
	await page.waitForTimeout(350);
	await expect(page.getByRole('tooltip')).toHaveCount(0);
	await monitor.getByRole('button', { name: /^CPU / }).click();

	const history = monitor.locator('.history-card');
	const chart = history.locator('.status-history-chart');
	await expect(history).toBeVisible();
	await expect(history.locator('.range-tabs button')).toHaveCount(4);
	await expect.poll(async () => Number(await chart.getAttribute('data-visible-start'))).toBeGreaterThan(0);

	for (const range of [1, 5, 10, 30] as const) {
		const rangeButton = history.getByRole('button', { name: `${range}m`, exact: true });
		await expect(rangeButton).toBeVisible();
		await rangeButton.click();
		await expect(chart).toHaveAttribute('data-range-minutes', String(range));

		const sampleWindow = await chart.evaluate((element) => ({
			start: Number(element.getAttribute('data-window-start')),
			end: Number(element.getAttribute('data-window-end')),
			first: Number(element.getAttribute('data-visible-start')),
		}));
		// A fresh connection has seconds of history, so the selected minutes are
		// an upper bound. Keep real timestamps and avoid a mostly empty axis.
		const span = sampleWindow.end - sampleWindow.start;
		for (const timestamp of Object.values(sampleWindow)) expect(Number.isFinite(timestamp)).toBe(true);
		expect(span).toBeGreaterThanOrEqual(2_000);
		expect(span).toBeLessThanOrEqual(range * 60_000);
		expect(sampleTimestamps.has(sampleWindow.first)).toBe(true);
		expect(sampleTimestamps.has(sampleWindow.end)).toBe(true);
		expect(sampleWindow.first).toBeGreaterThanOrEqual(sampleWindow.start);
		expect(sampleWindow.first).toBeLessThanOrEqual(sampleWindow.end);
		expect(sampleWindow.end).toBeLessThanOrEqual(Date.now() + 1_000);
		// Downsampling may retain a later sample in the first bucket. Measure
		// leading empty time against the original CPU samples from the wire.
		const earliestSample = Math.min(...sampleTimestamps);
		expect(earliestSample).toBeGreaterThanOrEqual(sampleWindow.start);
		expect(earliestSample - sampleWindow.start).toBeLessThanOrEqual(Math.max(2_000, span * 0.1));
	}

	// Controls keep a fixed font and the canvas has enough pixels for CSS zoom.
	await monitor.evaluate((element) => {
		Object.assign((element as HTMLElement).style, {
			position: 'fixed',
			top: '40px',
			left: '40px',
			width: '480px',
			height: '600px',
			zIndex: '1000',
		});
	});
	const canvas = chart.locator('canvas');
	const tooltip = page.getByRole('tooltip');
	for (const [scale, deltaY, count] of [
		[1, 0, 0],
		[1.6, -100, 10],
		[0.65, 100, 20],
	] as const) {
		await page.mouse.move(1100, 800);
		for (let index = 0; index < count; index += 1) {
			await monitor.dispatchEvent('wheel', { ctrlKey: true, deltaY, deltaMode: 0 });
		}
		await expect(monitor).toHaveAttribute('data-status-scale', scale.toFixed(2));
		await expect
			.poll(() =>
				canvas.evaluate((element) => {
					const canvas = element as HTMLCanvasElement;
					const rect = canvas.getBoundingClientRect();
					return Math.min(canvas.width / rect.width, canvas.height / rect.height) / window.devicePixelRatio;
				}),
			)
			.toBeGreaterThanOrEqual(0.99);
		for (const range of [1, 5, 10, 30]) {
			const button = history.getByRole('button', { name: `${range}m`, exact: true });
			await button.click();
			await expect(chart).toHaveAttribute('data-range-minutes', String(range));
			const fontSize = await button.evaluate((element) => parseFloat(getComputedStyle(element).fontSize));
			expect(fontSize * scale).toBeCloseTo(10, 1);
		}
		await canvas.hover({ position: { x: 200, y: 30 } });
		await expect(tooltip).toBeVisible();
		await expect(tooltip).toContainText(/\d{2}:\d{2}:\d{2}/);
		await expect(tooltip).toContainText(/\d+\.\d%/);
		await expect(tooltip).toHaveCSS('font-size', '12px');
		expect(await tooltip.evaluate((element) => element.parentElement === document.body)).toBe(true);
		await page.mouse.move(1100, 800);
		await expect(tooltip).toHaveCount(0);
		await monitor.locator('.network-row').click();
		const legend = page.locator('.network-legend');
		await expect(legend).toBeVisible();
		const legendFontSize = await legend.evaluate((element) => parseFloat(getComputedStyle(element).fontSize));
		expect(legendFontSize * scale).toBeCloseTo(11, 1);
		expect(await legend.evaluate((element) => Boolean(element.closest('.history-header')))).toBe(true);
		const legendBox = (await legend.boundingBox())!;
		const chartBox = (await chart.boundingBox())!;
		expect(legendBox.x).toBeGreaterThanOrEqual(chartBox.x);
		expect(legendBox.x + legendBox.width).toBeLessThanOrEqual(chartBox.x + chartBox.width);
		expect(legendBox.y + legendBox.height).toBeLessThanOrEqual(chartBox.y);
		await monitor.getByRole('button', { name: /^CPU / }).click();
	}
	await monitor.locator('.network-row').click();
	await canvas.hover({ position: { x: 200, y: 30 } });
	await expect(tooltip).toBeVisible();
	await expect(tooltip).toContainText(/\d{2}:\d{2}:\d{2}/);
	await expect(tooltip.locator('div')).toHaveCount(2);
	for (const entry of await tooltip.locator('div').all()) {
		await expect(entry).toContainText(/\d+(?:\.\d+)? (?:B|KB|MB|GB)\/s/);
	}
	await history.locator('.history-close').click();
	await expect(tooltip).toHaveCount(0);
});
