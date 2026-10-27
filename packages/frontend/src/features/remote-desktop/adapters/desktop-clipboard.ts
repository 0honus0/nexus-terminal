import { writeClipboardText } from '@/foundation/browser';
import { RemoteDesktopFailure } from '../model/remote-desktop-types';

export const MAX_CLIPBOARD_BYTES = 1024 * 1024;

export function attachDesktopClipboard(
	element: HTMLElement,
	send: (text: string) => Promise<void>,
	onFailure: (failure: RemoteDesktopFailure) => void,
) {
	let closed = false;
	let reading: Promise<void> | null = null;

	const fail = (cause: unknown) => {
		if (
			closed ||
			(cause instanceof DOMException && (cause.name === 'NotAllowedError' || cause.name === 'SecurityError'))
		) {
			return;
		}
		onFailure(new RemoteDesktopFailure('input_failed', 'unknown', { cause }));
	};

	const validate = (text: string) => {
		if (new TextEncoder().encode(text).byteLength > MAX_CLIPBOARD_BYTES) {
			throw new RemoteDesktopFailure('input_failed', 'not_dispatched');
		}
	};

	const sync = (): Promise<void> => {
		if (closed || !navigator.clipboard?.readText) {
			return Promise.resolve();
		}
		if (reading) {
			return reading;
		}
		reading = Promise.resolve()
			.then(async () => {
				const text = await navigator.clipboard.readText();
				if (closed) {
					return;
				}
				validate(text);
				await send(text);
			})
			.catch(fail)
			.finally(() => {
				reading = null;
			});
		return reading;
	};

	const onFocus = () => {
		void sync();
	};

	element.addEventListener('focusin', onFocus);
	return {
		sync,

		receive(text: string): void {
			if (closed) {
				return;
			}
			try {
				validate(text);
				void writeClipboardText(text).catch(fail);
			} catch (cause) {
				fail(cause);
			}
		},

		close(): void {
			closed = true;
			element.removeEventListener('focusin', onFocus);
		},
	};
}
