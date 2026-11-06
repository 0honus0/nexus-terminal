export function ownsDocumentKeyboardEvent(root: HTMLElement, event: KeyboardEvent): boolean {
	const targetScope = event.target instanceof Element ? event.target.closest('[data-document-keyboard-scope]') : null;
	const scope = targetScope ?? document.activeElement?.closest('[data-document-keyboard-scope]');
	return !scope || scope === root;
}
