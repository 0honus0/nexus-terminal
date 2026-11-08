import { test, expect } from '../../support/fixtures';

declare global {
	interface Window {
		__readDesktopTouchLifetime: () => { calls: string[]; afterClose: number; touchAction: string };
	}
}

test('native direct and touchpad gestures retire their pending timers and restore touch action', async ({ page }) => {
	await page.clock.install();
	await page.goto('/login');
	for (const mode of ['direct', 'touchpad'] as const) {
		await page.evaluate(async (mode) => {
			const path = '/__e2e__/browser-clients.js';
			const { attachDesktopTouch }: typeof import('../../support/browser-clients') = await import(path);
			const element = document.createElement('div');
			element.style.cssText = 'position:fixed;left:0;top:0;width:200px;height:200px';
			const canvas = document.createElement('canvas');
			canvas.width = canvas.height = 200;
			element.append(canvas);
			document.body.append(element);
			const calls: string[] = [];
			for (const kind of ['mousedown', 'mouseup', 'mousemove'])
				canvas.addEventListener(kind, (event) => {
					if (!(event instanceof MouseEvent)) throw Error('Expected native mouse event');
					calls.push(event.type + ':' + event.button + ':' + event.buttons);
				});
			const input = attachDesktopTouch(element, canvas, mode);
			try {
				const touch = new Touch({ identifier: 1, target: element, clientX: 50, clientY: 50 });

				const send = (kind: string, touches: Touch[]) =>
					element.dispatchEvent(new TouchEvent(kind, { touches, changedTouches: [touch], cancelable: true }));

				send('touchstart', [touch]);
				send('touchend', []);
				if (calls.join(',') !== 'mousemove:0:0,mousedown:0:1,mouseup:0:0')
					throw Error(mode + ' native tap did not press and release: ' + calls);
				send('touchstart', [touch]);
				send('touchmove', [new Touch({ identifier: 1, target: element, clientX: 80, clientY: 80 })]);
				send('touchcancel', []);
				if (calls.slice(-3).join(',') !== 'mousedown:0:1,mousemove:0:1,mouseup:0:0')
					throw Error(mode + ' drag cancellation did not release: ' + calls);
				input.setMode(mode);
				const second = new Touch({ identifier: 2, target: element, clientX: 90, clientY: 90 });
				send('touchstart', [touch, second]);
				send('touchend', []);
				if (calls.slice(-2).join(',') !== 'mousedown:2:2,mouseup:2:0')
					throw Error(mode + ' native right click used an incorrect button mask: ' + calls);
				send('touchstart', [touch]);
			} finally {
				input.close();
				element.remove();
			}
			const afterClose = calls.length;
			window.__readDesktopTouchLifetime = () => ({
				calls: calls.slice(),
				afterClose,
				touchAction: element.style.touchAction,
			});
		}, mode);
		await page.clock.runFor(550);
		const result = await page.evaluate(() => window.__readDesktopTouchLifetime());
		expect(result.calls).toContain('mousedown:0:1');
		expect(result.calls).toContain('mouseup:0:0');
		expect(result.calls).toHaveLength(result.afterClose);
		expect(result.touchAction).toBe('');
	}
});
