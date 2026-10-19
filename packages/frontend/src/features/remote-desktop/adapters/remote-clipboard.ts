import Guacamole from 'guacamole-common-js';
import type { Client } from 'guacamole-common-js';
import { writeClipboardText } from '@/foundation/browser';
import { RemoteDesktopFailure } from '../model/remote-desktop-types';

// Local browser buffering policy, independent of the opaque Guacamole transport.
const MAX_CLIPBOARD_BYTES = 1024 * 1024;

const isPermissionFailure = (cause: unknown): boolean =>
	cause instanceof DOMException && (cause.name === 'NotAllowedError' || cause.name === 'SecurityError');

export function attachRemoteClipboard(
	element: HTMLElement,
	client: Client,
	onFailure: (failure: RemoteDesktopFailure) => void,
) {
	let destroyed = false;
	let reading: Promise<void> | undefined;
	const readers = new Set<InstanceType<typeof Guacamole.StringReader>>();

	const fail = (cause: unknown): void => {
		if (!destroyed && !isPermissionFailure(cause))
			onFailure(new RemoteDesktopFailure('input_failed', 'unknown', { cause }));
	};

	const readHost = async (): Promise<void> => {
		try {
			if (destroyed || !navigator.clipboard?.readText) return;
			const text = await navigator.clipboard.readText();
			if (destroyed || !text) return;
			if (new TextEncoder().encode(text).byteLength > MAX_CLIPBOARD_BYTES)
				throw new Error('Clipboard limit exceeded');
			const writer = new Guacamole.StringWriter(client.createClipboardStream('text/plain'));
			writer.sendText(text);
			writer.sendEnd();
		} catch (cause) {
			fail(cause);
		}
	};

	const syncHostToRemote = (): Promise<void> => {
		if (destroyed) return Promise.resolve();
		if (!reading) {
			reading = readHost().finally(() => {
				reading = undefined;
			});
		}
		return reading;
	};

	client.onclipboard = (stream, mimetype) => {
		if (destroyed || mimetype.toLowerCase().split(';')[0]?.trim() !== 'text/plain' || readers.size >= 4) {
			stream.sendAck('Clipboard unavailable', 0x0100);
			return;
		}
		const reader = new Guacamole.StringReader(stream);
		readers.add(reader);
		let text = '';
		let bytes = 0;
		reader.ontext = (chunk) => {
			bytes += new TextEncoder().encode(chunk).byteLength;
			if (bytes > MAX_CLIPBOARD_BYTES) {
				reader.ontext = null;
				reader.onend = null;
				readers.delete(reader);
				text = '';
				stream.sendAck('Clipboard limit exceeded', 0x0100);
				fail(new Error('Clipboard limit exceeded'));
				return;
			}
			text += chunk;
		};
		reader.onend = () => {
			reader.ontext = null;
			reader.onend = null;
			readers.delete(reader);
			if (!destroyed) void writeClipboardText(text).catch(fail);
			text = '';
		};
	};

	const focus = (): void => {
		void syncHostToRemote();
	};

	element.addEventListener('focus', focus);

	return {
		syncHostToRemote,

		destroy(): void {
			if (destroyed) return;
			destroyed = true;
			element.removeEventListener('focus', focus);
			client.onclipboard = null;
			for (const reader of readers) {
				reader.ontext = null;
				reader.onend = null;
			}
			readers.clear();
		},
	};
}
