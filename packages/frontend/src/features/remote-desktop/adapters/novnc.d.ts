declare module '@novnc/novnc' {
	export default class RFB extends EventTarget {
		constructor(target: HTMLElement, url: string, options: { credentials: { username: string; password: string } });

		scaleViewport: boolean;
		resizeSession: boolean;
		focusOnClick: boolean;
		showDotCursor: boolean;

		disconnect(): void;

		focus(): void;

		blur(): void;

		sendKey(keysym: number, code: string | null, down?: boolean): void;

		sendCredentials(credentials: { username: string; password: string }): void;

		clipboardPasteFrom(text: string): void;
	}
}
