import { expect, test } from '@playwright/test';

test('status chart preserves actual sample timestamps and zero values on a native canvas', async ({ page }) => {
	const errors: string[] = [];
	page.on('pageerror', (cause) => errors.push(cause.stack ?? cause.message));
	await page.route('**/__e2e__/status-fixture', (route) =>
		route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Status chart</title>' }),
	);
	await page.goto('/__e2e__/status-fixture');
	const result = await page.evaluate(async () => {
		const path = '/__e2e__/browser-status.js';
		const {
			createApp,
			h,
			nextTick,
			Chart,
			StatusCharts,
			i18n,
			setLocale,
		}: typeof import('../../../../packages/frontend/build/e2e-browser-status') = await import(path);
		await setLocale('en-US');
		const node = document.createElement('div');
		node.style.cssText = 'width:600px;height:300px';
		document.body.append(node);
		const time = 1700000000000;
		const history = {
			cpu: [
				{ time, value: 0, sequence: 1 },
				{ time: time + 60000, value: 25, sequence: 2 },
			],
			memory: [],
			swap: [],
			disk: [],
			networkRx: [],
			networkTx: [],
		};
		const mounted = createApp({
			render: () =>
				h(StatusCharts, {
					history,
					sampleTimestamp: time + 60000,
					metric: 'cpu',
					rangeMinutes: 5,
				}),
		});
		try {
			mounted.use(i18n).mount(node);
			await nextTick();
			const canvas = node.querySelector('canvas');
			if (!canvas) throw new Error('Native status canvas missing');
			const chart = Chart.getChart(canvas);
			if (!chart) throw new Error('Chart.js did not register its native canvas');
			const samples = chart.data.datasets[0].data;
			return { samples, canvasWidth: canvas.width, canvasHeight: canvas.height };
		} finally {
			mounted.unmount();
			node.remove();
		}
	});
	expect(result.samples).toEqual([
		{ x: 1700000000000, y: 0 },
		{ x: 1700000060000, y: 25 },
	]);
	expect(result.canvasWidth).toBeGreaterThan(0);
	expect(result.canvasHeight).toBeGreaterThan(0);
	expect(errors).toEqual([]);
});
