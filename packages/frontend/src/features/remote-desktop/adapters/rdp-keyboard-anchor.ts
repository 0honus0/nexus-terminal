/** The Web SDK exposes no remote text caret. Anchor local IME to the last clicked desktop position. */
export function attachRdpKeyboardAnchor(
	element: HTMLElement,
	canvas: HTMLCanvasElement,
	keyboard: HTMLTextAreaElement,
) {
	const previousStyle = keyboard.getAttribute('style');
	let x = 0;
	let y = 0;
	let closed = false;
	Object.assign(keyboard.style, {
		position: 'absolute',
		left: '0px',
		top: '0px',
		right: 'auto',
		bottom: 'auto',
		padding: '0',
		border: '0',
		margin: '0',
		fontSize: '16px',
		lineHeight: '16px',
		whiteSpace: 'pre',
		overflowWrap: 'normal',
	});

	const update = () => {
		if (closed) return;
		const parent = keyboard.offsetParent;
		if (!(parent instanceof HTMLElement)) return;
		const rect = canvas.getBoundingClientRect();
		const origin = parent.getBoundingClientRect();
		if (rect.width <= 0 || rect.height <= 0 || origin.width <= 0 || origin.height <= 0) return;
		// offsetParent coordinates also cover transformed dialogs, fullscreen, and the shared mobile input.
		keyboard.style.left = `${((rect.left + x * rect.width - origin.left) * parent.offsetWidth) / origin.width - parent.clientLeft + parent.scrollLeft}px`;
		keyboard.style.top = `${((rect.top + y * rect.height - origin.top) * parent.offsetHeight) / origin.height - parent.clientTop + parent.scrollTop}px`;
	};

	const resize = new ResizeObserver(update);
	resize.observe(element);
	resize.observe(canvas);
	window.addEventListener('scroll', update, true);
	window.addEventListener('resize', update);
	document.addEventListener('fullscreenchange', update);
	window.visualViewport?.addEventListener('resize', update);
	window.visualViewport?.addEventListener('scroll', update);

	return {
		move(clientX: number, clientY: number): void {
			const rect = canvas.getBoundingClientRect();
			if (rect.width <= 0 || rect.height <= 0) return;
			x = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
			y = Math.max(0, Math.min(1, (clientY - rect.top) / rect.height));
			update();
		},

		update,

		close(): void {
			closed = true;
			resize.disconnect();
			window.removeEventListener('scroll', update, true);
			window.removeEventListener('resize', update);
			document.removeEventListener('fullscreenchange', update);
			window.visualViewport?.removeEventListener('resize', update);
			window.visualViewport?.removeEventListener('scroll', update);
			if (previousStyle === null) keyboard.removeAttribute('style');
			else keyboard.setAttribute('style', previousStyle);
		},
	};
}
