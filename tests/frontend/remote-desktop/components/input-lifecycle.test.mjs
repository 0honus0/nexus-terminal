import { test, expect, vi, onTestFinished } from 'vitest';
import { createRdpDesktop } from '../../../../packages/frontend/src/features/remote-desktop/adapters/rdp-desktop.ts';
import { createVncDesktop } from '../../../../packages/frontend/src/features/remote-desktop/adapters/vnc-desktop.ts';

// Only subscription lifetime is under test here. Protocol and native rendering have their own browser cases.
test('unconnected real RDP/VNC adapters retire input and blur listeners through repeated mode changes', () => {
	const observers = [];
	vi.stubGlobal(
		'ResizeObserver',
		class {
			disconnected = false;

			constructor() {
				observers.push(this);
			}

			observe() {}

			disconnect() {
				this.disconnected = true;
			}
		},
	);
	// jsdom has no native pixels. Keep the non-rendering branch; Canvas is verified in Playwright.
	vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
	const input = document.createElement('textarea');
	const additions = vi.spyOn(input, 'addEventListener');
	const removals = vi.spyOn(input, 'removeEventListener');
	const windowAdditions = vi.spyOn(window, 'addEventListener');
	const windowRemovals = vi.spyOn(window, 'removeEventListener');
	onTestFinished(() => {
		vi.restoreAllMocks();
		vi.unstubAllGlobals();
	});
	for (const factory of [createRdpDesktop, createVncDesktop]) {
		for (let index = 0; index < 5; index++) {
			const start = additions.mock.calls.length;
			const startWindow = windowAdditions.mock.calls.length;
			const failures = [];
			const peer = factory({
				hasTouch: true,
				touchMode: 'direct',
				mobileInput: input,

				onState() {},

				onFailure: (failure) => failures.push(failure),
			});
			try {
				peer.setTouchMode('direct');
				peer.setTouchMode('touchpad');
			} finally {
				peer.close();
			}
			const added = additions.mock.calls.slice(start);
			expect(added.length).toBeGreaterThan(0);
			for (const [type, listener] of added) {
				expect(
					removals.mock.calls.some(([removedType, removed]) => type === removedType && listener === removed),
				).toBe(true);
			}
			for (const [type, listener] of windowAdditions.mock.calls
				.slice(startWindow)
				.filter(([type]) => type === 'blur')) {
				expect(
					windowRemovals.mock.calls.some(
						([removedType, removed]) => type === removedType && listener === removed,
					),
				).toBe(true);
			}
			expect(failures).toEqual([]);
		}
	}
	expect(observers.length).toBe(5);
	expect(observers.every((observer) => observer.disconnected)).toBe(true);
});
