import { expect, test } from '../../support/fixtures';

test('RDP hidden canvases retain current pixels without repeated native submissions', async ({ page }) => {
	await page.goto('/login');
	const result = await page.evaluate(async () => {
		const path = '/__e2e__/browser-rdp.js';
		const { attachRdpFramePresenter }: typeof import('../../../../packages/frontend/build/e2e-browser-rdp') =
			await import(path);
		document.body.replaceChildren();
		const canvas = document.createElement('canvas');
		canvas.width = canvas.height = 16;
		document.body.append(canvas);
		const context = canvas.getContext('2d')!;
		const original = context.putImageData.bind(context);
		let submissions = 0;
		context.putImageData = (
			imageData,
			dx,
			dy,
			dirtyX?: number,
			dirtyY?: number,
			dirtyWidth?: number,
			dirtyHeight?: number,
		) => {
			submissions++;
			if (dirtyX === undefined || dirtyY === undefined || dirtyWidth === undefined || dirtyHeight === undefined) {
				original(imageData, dx, dy);
			} else {
				original(imageData, dx, dy, dirtyX, dirtyY, dirtyWidth, dirtyHeight);
			}
		};
		const failures: string[] = [];
		const close = attachRdpFramePresenter(canvas, (cause) => failures.push(String(cause)));

		const tick = async () => {
			for (let index = 0; index < 4; index++) await new Promise(requestAnimationFrame);
		};

		const image = new ImageData(16, 16);
		image.data.fill(255);
		try {
			context.putImageData(image, 0, 0);
			await tick();
			const visibleSubmissions = submissions;
			canvas.style.display = 'none';
			await tick();
			submissions = 0;
			for (let frame = 0; frame < 12; frame++) {
				image.data.fill(frame + 1);
				for (let offset = 3; offset < image.data.length; offset += 4) image.data[offset] = 255;
				context.putImageData(image, 0, 0);
				await tick();
			}
			const hiddenSubmissions = submissions;
			// The SDK can reuse its memory as soon as putImageData returns.
			image.data.fill(99);
			canvas.style.display = '';
			await tick();
			const restored = Array.from(context.getImageData(0, 0, 1, 1).data);
			const restoredSubmissions = submissions - hiddenSubmissions;
			// A hidden resize invalidates old damage, including a same-value width assignment.
			canvas.style.display = 'none';
			await tick();
			context.putImageData(image, 0, 0);
			canvas.width = canvas.width;
			const pixel = new ImageData(new Uint8ClampedArray([21, 22, 23, 255]), 1, 1);
			context.putImageData(pixel, 3, 4);
			canvas.style.display = '';
			await tick();
			const resized = Array.from(context.getImageData(3, 4, 1, 1).data);
			const cleared = Array.from(context.getImageData(0, 0, 1, 1).data);
			// Background visibility is independent of the element's intersection.
			Object.defineProperty(document, 'hidden', { configurable: true, value: true });
			document.dispatchEvent(new Event('visibilitychange'));
			submissions = 0;
			context.putImageData(pixel, 5, 6);
			await tick();
			const backgroundSubmissions = submissions;
			Reflect.deleteProperty(document, 'hidden');
			document.dispatchEvent(new Event('visibilitychange'));
			await tick();
			const foreground = Array.from(context.getImageData(5, 6, 1, 1).data);
			// Closing with pending pixels must not paint or keep visibility listeners alive.
			canvas.style.display = 'none';
			await tick();
			context.putImageData(pixel, 7, 8);
			close();
			const beforeClose = submissions;
			canvas.style.display = '';
			document.dispatchEvent(new Event('visibilitychange'));
			await tick();
			return {
				visibleSubmissions,
				hiddenSubmissions,
				restoredSubmissions,
				restored,
				resized,
				cleared,
				backgroundSubmissions,
				foreground,
				afterClose: submissions - beforeClose,
				failures,
			};
		} finally {
			Reflect.deleteProperty(document, 'hidden');
			close();
			canvas.remove();
		}
	});
	expect(result).toEqual({
		visibleSubmissions: 1,
		hiddenSubmissions: 0,
		restoredSubmissions: 1,
		restored: [12, 12, 12, 255],
		resized: [21, 22, 23, 255],
		cleared: [0, 0, 0, 0],
		backgroundSubmissions: 0,
		foreground: [21, 22, 23, 255],
		afterClose: 0,
		failures: [],
	});
});

test('RDP PCM scheduling keeps normal jitter and tails but discards a burst backlog independently of device latency', async ({
	page,
}) => {
	await page.goto('/login');
	const result = await page.evaluate(async () => {
		const path = '/__e2e__/browser-rdp.js';
		const {
			attachRdpAudioOutput,
			deliverRdpAudio,
		}: typeof import('../../../../packages/frontend/build/e2e-browser-rdp') = await import(path);
		const NativeAudioContext = window.AudioContext;
		const output = new NativeAudioContext();
		await output.suspend();
		// Real buffers/nodes with a controlled audio clock; these checks do not measure physical sound delay.
		let time = 1;
		let state = 'running';
		Object.defineProperties(output, {
			currentTime: {
				configurable: true,

				get: () => time,
			},
			state: {
				configurable: true,

				get: () => state,
			},
			baseLatency: { configurable: true, value: 0.042667 },
			outputLatency: { configurable: true, value: 0.128 },
		});
		const scheduled: number[] = [];
		let stopped = 0;
		const buffers: AudioBuffer[] = [];
		const createSource = output.createBufferSource.bind(output);
		output.createBufferSource = () => {
			const node = createSource();
			const start = node.start.bind(node);
			const stop = node.stop.bind(node);
			node.start = (when = 0) => {
				scheduled.push(when);
				buffers.push(node.buffer!);
				start(when);
			};
			node.stop = () => {
				stopped++;
				stop();
			};
			return node;
		};
		window.AudioContext = new Proxy(NativeAudioContext, { construct: () => output });
		const host = document.createElement('div');
		const keyboard = document.createElement('textarea');
		const audio = attachRdpAudioOutput(host, keyboard);
		try {
			audio.extension();
			const data = new Uint8Array(8192 * 4);
			const view = new DataView(data.buffer);
			for (let offset = 0; offset < data.length; offset += 4) {
				view.setInt16(offset, 16384, true);
				view.setInt16(offset + 2, -16384, true);
			}

			const wave = () => deliverRdpAudio({ type: 'wave', data, sampleRate: 44100, channels: 2 });

			const duration = 8192 / 44100;
			wave();
			// The actual Windows sample had at most 35.410ms scheduled ahead: retain this normal cadence.
			time = 1 + duration - 0.03541;
			wave();
			const normalStopped = stopped;
			const normalGap = scheduled[1]! - scheduled[0]! - duration;
			deliverRdpAudio({ type: 'close' });
			const tailStopped = stopped;
			// Reset through the real suspend-state handler; stale PCM while paused is ignored.
			state = 'suspended';
			output.dispatchEvent(new Event('statechange'));
			const pausedCount = scheduled.length;
			wave();
			const pausedScheduled = scheduled.length - pausedCount;
			state = 'running';
			output.dispatchEvent(new Event('statechange'));
			time = 2;
			const beforeBurst = stopped;
			wave();
			wave();
			time += 0.021;
			wave();
			const burstAheadMs = (scheduled.at(-1)! - time) * 1000;
			const burstStopped = stopped - beforeBurst;
			const channels = buffers[0]!.numberOfChannels;
			const samples = [buffers[0]!.getChannelData(0)[0], buffers[0]!.getChannelData(1)[0]];
			audio.close();
			const countAtClose = scheduled.length;
			wave();
			return {
				normalStopped,
				normalGap,
				tailStopped,
				pausedScheduled,
				burstAheadMs,
				burstStopped,
				channels,
				samples,
				lateScheduled: scheduled.length - countAtClose,
			};
		} finally {
			audio.close();
			window.AudioContext = NativeAudioContext;
			Reflect.deleteProperty(output, 'state');
			if (output.state !== 'closed') await output.close();
		}
	});
	expect(result.normalStopped).toBe(0);
	expect(result.normalGap).toBeCloseTo(0, 10);
	expect(result.tailStopped).toBe(0);
	expect(result.pausedScheduled).toBe(0);
	expect(result.channels).toBe(2);
	expect(result.samples).toEqual([0.5, -0.5]);
	expect(result.burstAheadMs).toBe(0);
	expect(result.burstStopped).toBe(2);
	expect(result.lateScheduled).toBe(0);
});

test('RDP presentation preserves detached updates and native fallback ordering', async ({ page }) => {
	await page.goto('/login');
	const result = await page.evaluate(async () => {
		const path = '/__e2e__/browser-rdp.js';
		const { attachRdpFramePresenter }: typeof import('../../../../packages/frontend/build/e2e-browser-rdp') =
			await import(path);
		document.body.replaceChildren();
		const canvas = document.createElement('canvas');
		canvas.width = canvas.height = 8;
		const context = canvas.getContext('2d')!;
		const original = context.putImageData;
		const failures: string[] = [];
		const close = attachRdpFramePresenter(canvas, (cause) => failures.push(String(cause)));

		const tick = async () => {
			for (let index = 0; index < 4; index++) await new Promise(requestAnimationFrame);
		};

		const pixel = new ImageData(new Uint8ClampedArray([11, 12, 13, 255]), 1, 1);
		try {
			context.putImageData(pixel, 0, 0);
			await tick();
			const detached = Array.from(context.getImageData(0, 0, 1, 1).data);
			document.body.append(canvas);
			await tick();
			const attached = Array.from(context.getImageData(0, 0, 1, 1).data);
			const viewportRight = await new Promise<number>((resolve, reject) => {
				const observer = new IntersectionObserver(([entry]) => {
					observer.disconnect();
					if (!entry?.rootBounds) reject(new Error('Missing viewport intersection bounds'));
					else resolve(entry.rootBounds.right);
				});
				observer.observe(canvas);
			});
			// threshold=0 can notify at exactly zero visible area without notifying again when moved inside.
			canvas.style.position = 'fixed';
			canvas.style.left = `${viewportRight}px`;
			canvas.style.top = '100px';
			await tick();
			context.putImageData(pixel, 4, 4);
			canvas.style.left = `${viewportRight - 4}px`;
			await tick();
			const edge = Array.from(context.getImageData(4, 4, 1, 1).data);
			canvas.style.display = 'none';
			await tick();
			context.putImageData(pixel, 1, 1);
			// Unsupported fractional coordinates deliberately fall back to native Canvas validation.
			// Previously retained pixels must flush before that native write, even while hidden.
			context.putImageData(pixel, 2.5, 2);
			const retained = Array.from(context.getImageData(1, 1, 1, 1).data);
			const fallback = Array.from(context.getImageData(2, 2, 1, 1).data);
			canvas.width = 8;
			context.createImageData = () => {
				throw new RangeError('controlled allocation failure');
			};
			context.putImageData(pixel, 3, 3);
			const allocationFallback = Array.from(context.getImageData(3, 3, 1, 1).data);
			close();
			return {
				detached,
				attached,
				edge,
				retained,
				fallback,
				allocationFallback,
				restored: context.putImageData === original,
				failures,
			};
		} finally {
			close();
			canvas.remove();
		}
	});
	expect(result).toEqual({
		detached: [0, 0, 0, 0],
		attached: [11, 12, 13, 255],
		edge: [11, 12, 13, 255],
		retained: [11, 12, 13, 255],
		fallback: [11, 12, 13, 255],
		allocationFallback: [11, 12, 13, 255],
		restored: true,
		failures: [],
	});
});
