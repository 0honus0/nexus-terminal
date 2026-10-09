import { expect, test } from '../../support/fixtures';
import { loginAsInitialAdmin } from '../../support/auth';
import { configureSshE2eSettings, connectTestSshFromConnectionsPage, ensureTestSshConnection } from '../../support/ssh';

test('mobile HTML background follows container geometry without native resize or iframe reload', async ({
	page,
	context,
}) => {
	await loginAsInitialAdmin(context.request);
	await configureSshE2eSettings(context.request);
	const originalResponse = await context.request.get('/api/v1/appearance');
	expect(originalResponse.ok()).toBeTruthy();
	const original = await originalResponse.json();
	const html = `<canvas id="scene"></canvas><script>
    // Model a browser that does not deliver native resize to the theme.
    window.addEventListener('resize', event => {
      if (event.isTrusted) event.stopImmediatePropagation();
    });
    const canvas = document.getElementById('scene');
    canvas.dataset.instance = String(Math.random());
    function resize() {
      canvas.dataset.resizes = String(Number(canvas.dataset.resizes || 0) + 1);
      canvas.width = document.documentElement.clientWidth;
      canvas.height = document.documentElement.clientHeight;
      const context = canvas.getContext('2d');
      context.fillStyle = '#ff0000';
      context.fillRect(0, 0, canvas.width, canvas.height);
    }
    window.addEventListener('resize', resize);
    resize();
  </script>`;
	try {
		const response = await context.request.put('/api/v1/appearance', {
			data: { terminalBackgroundEnabled: true, terminalCustomHtml: html },
		});
		expect(response.ok()).toBeTruthy();
		const connectionId = await ensureTestSshConnection(context.request);
		await connectTestSshFromConnectionsPage(page, connectionId);
		const frame = page.locator('.terminal-custom-html');
		const canvas = page.frameLocator('.terminal-custom-html').locator('#scene');
		await expect(canvas).toBeAttached();
		const instance = await canvas.getAttribute('data-instance');

		const expectGeometry = async () => {
			const size = await frame.evaluate((element) => ({
				width: element.clientWidth,
				height: element.clientHeight,
			}));
			expect(size.width).toBeGreaterThan(0);
			expect(size.height).toBeGreaterThan(0);
			await expect
				.poll(() =>
					canvas.evaluate((element) => {
						const canvas = element as HTMLCanvasElement;
						const pixel = canvas
							.getContext('2d')!
							.getImageData(canvas.width - 1, canvas.height - 1, 1, 1).data;
						return { width: canvas.width, height: canvas.height, red: pixel[0], alpha: pixel[3] };
					}),
				)
				.toEqual({ ...size, red: 255, alpha: 255 });
			await expect(canvas).toHaveAttribute('data-instance', instance!);
		};

		await expectGeometry();
		// Change only the iframe container, not the top-level browser viewport.
		await frame.evaluate((element) => {
			element.style.height = '160px';
		});
		await expectGeometry();
		const beforeReveal = Number(await canvas.getAttribute('data-resizes'));
		await frame.evaluate(
			(element) =>
				new Promise<void>((resolve) => {
					const observer = new ResizeObserver(() => {
						if (element.clientWidth !== 0 || element.clientHeight !== 0) return;
						observer.disconnect();
						resolve();
					});
					observer.observe(element);
					element.style.display = 'none';
				}),
		);
		await expect(frame).toBeHidden();
		await frame.evaluate((element) => {
			element.style.display = '';
		});
		await expect.poll(async () => Number(await canvas.getAttribute('data-resizes'))).toBeGreaterThan(beforeReveal);
		await expectGeometry();
		await frame.evaluate((element) => {
			element.style.height = '240px';
		});
		await expectGeometry();
		await frame.evaluate((element) => {
			element.style.height = '';
		});
		await expectGeometry();
	} finally {
		await context.request.put('/api/v1/appearance', {
			data: {
				terminalBackgroundEnabled: original.terminalBackgroundEnabled,
				terminalCustomHtml: original.terminalCustomHtml,
			},
		});
	}
});

test('mobile background limits continuous frame work and pauses without losing its document', async ({
	page,
	context,
}) => {
	await loginAsInitialAdmin(context.request);
	await configureSshE2eSettings(context.request);
	const originalResponse = await context.request.get('/api/v1/appearance');
	expect(originalResponse.ok()).toBeTruthy();
	const original = await originalResponse.json();
	const html = `<style>
    @keyframes spin { to { transform: rotate(360deg); } }
    #scene { animation: spin 1s linear infinite; }
  </style><canvas id="scene"></canvas><script>
    const canvas = document.getElementById('scene');
    canvas.dataset.instance = String(Math.random());
    const timestamps = [];
    const canceled = requestAnimationFrame(() => { canvas.dataset.canceled = 'called'; });
    cancelAnimationFrame(canceled);
    function draw(timestamp) {
      timestamps.push(timestamp);
      canvas.dataset.timestamps = JSON.stringify(timestamps.slice(-12));
      canvas.dataset.frames = String(Number(canvas.dataset.frames || 0) + 1);
      requestAnimationFrame(draw);
    }
    requestAnimationFrame(draw);
  </script>`;
	try {
		expect(
			(
				await context.request.put('/api/v1/appearance', {
					data: { terminalBackgroundEnabled: true, terminalCustomHtml: html },
				})
			).ok(),
		).toBeTruthy();
		const connectionId = await ensureTestSshConnection(context.request);
		await connectTestSshFromConnectionsPage(page, connectionId);
		const frame = page.locator('.terminal-custom-html');
		const canvas = page.frameLocator('.terminal-custom-html').locator('#scene');
		await expect.poll(async () => Number(await canvas.getAttribute('data-frames'))).toBeGreaterThan(12);
		const instance = await canvas.getAttribute('data-instance');
		const timestamps = JSON.parse((await canvas.getAttribute('data-timestamps'))!) as number[];
		for (let index = 1; index < timestamps.length; index += 1) {
			// Verify actual callback spacing, rather than assuming a configured FPS cap.
			expect(timestamps[index]! - timestamps[index - 1]!).toBeGreaterThanOrEqual(49);
		}
		await expect(canvas).not.toHaveAttribute('data-canceled', 'called');
		await expect(canvas).toHaveCSS('animation-play-state', 'running');

		await frame.evaluate((element) => {
			element.style.display = 'none';
		});
		await expect(canvas).toHaveCSS('animation-play-state', 'paused');

		const samplePausedWork = () =>
			canvas.evaluate(async (element) => {
				const before = element.getAttribute('data-frames');
				// Observe a bounded interval with enough time for several unwanted frames.
				await new Promise((resolve) => setTimeout(resolve, 250));
				return element.getAttribute('data-frames') === before;
			});

		expect(await samplePausedWork()).toBe(true);
		const beforeReveal = Number(await canvas.getAttribute('data-frames'));
		await frame.evaluate((element) => {
			element.style.display = '';
		});
		await expect(canvas).toHaveCSS('animation-play-state', 'running');
		await expect.poll(async () => Number(await canvas.getAttribute('data-frames'))).toBeGreaterThan(beforeReveal);
		await expect(canvas).toHaveAttribute('data-instance', instance!);

		await page.emulateMedia({ reducedMotion: 'reduce' });
		await expect(canvas).toHaveCSS('animation-play-state', 'paused');
		expect(await samplePausedWork()).toBe(true);
		const beforeResume = Number(await canvas.getAttribute('data-frames'));
		await page.emulateMedia({ reducedMotion: 'no-preference' });
		await expect.poll(async () => Number(await canvas.getAttribute('data-frames'))).toBeGreaterThan(beforeResume);
		await expect(canvas).toHaveAttribute('data-instance', instance!);
	} finally {
		await context.request.put('/api/v1/appearance', {
			data: {
				terminalBackgroundEnabled: original.terminalBackgroundEnabled,
				terminalCustomHtml: original.terminalCustomHtml,
			},
		});
	}
});
