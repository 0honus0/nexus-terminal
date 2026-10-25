import { useResizeObserver } from '@vueuse/core';
import { onActivated, onBeforeUnmount, onDeactivated, onMounted, ref, watch, type Ref } from 'vue';

interface TerminalBackgroundOptions {
	container: Ref<HTMLElement | null>;
	active: () => boolean;
	html: Readonly<Ref<string>>;
}

/** Owns background loading independently of xterm's font and geometry readiness. */
export function useTerminalBackground(options: TerminalBackgroundOptions) {
	const ready = ref(false);
	const frame = ref<HTMLIFrameElement | null>(null);
	const viewActive = ref(true);
	let disposed = false;
	let settleTimer: number | undefined;

	const canDisplay = (): boolean =>
		!disposed && viewActive.value && options.active() && document.visibilityState === 'visible';

	const sync = (): void => {
		const container = options.container.value;
		const sized = Boolean(container?.isConnected && container.clientWidth > 0 && container.clientHeight > 0);
		const visible = canDisplay() && sized;
		if (visible && options.html.value) ready.value = true;
		const target = frame.value;
		if (!target) return;
		const frameVisible = visible && target.isConnected && target.clientWidth > 0 && target.clientHeight > 0;
		if (frameVisible && options.html.value && target.getAttribute('srcdoc') !== options.html.value) {
			target.srcdoc = options.html.value;
		}
		// active and page lifecycle transitions must reach the sandbox even when
		// ResizeObserver coalesces a hide/show cycle with identical dimensions.
		target.contentWindow?.postMessage({ type: 'nexus-background-geometry', visible: frameVisible }, '*');
	};

	const refresh = (): void => {
		window.clearTimeout(settleTimer);
		settleTimer = undefined;
		sync();
		// One bounded follow-up catches layout settling without depending on RAF.
		if (canDisplay()) {
			settleTimer = window.setTimeout(() => {
				settleTimer = undefined;
				sync();
			}, 100);
		}
	};

	watch(
		[options.container, frame, options.html, options.active, viewActive],
		([container, target], _previous, onCleanup) => {
			const observer = useResizeObserver([container, target], sync);
			onCleanup(observer.stop);
			refresh();
		},
		{ flush: 'post' },
	);

	onMounted(() => {
		document.addEventListener('visibilitychange', refresh);
		window.addEventListener('pageshow', refresh);
		window.addEventListener('focus', refresh);
		refresh();
	});
	onActivated(() => {
		viewActive.value = true;
		refresh();
	});
	onDeactivated(() => {
		viewActive.value = false;
		refresh();
		// KeepAlive detaches the iframe. Browsers can recreate its document
		// while the cached page has a zero viewport; one-shot themes then stay
		// blank. Clear only the document and load it again once visibly sized.
		frame.value?.removeAttribute('srcdoc');
	});
	onBeforeUnmount(() => {
		disposed = true;
		refresh();
		document.removeEventListener('visibilitychange', refresh);
		window.removeEventListener('pageshow', refresh);
		window.removeEventListener('focus', refresh);
	});

	return { ready, frame, refresh };
}
