import Guacamole from 'guacamole-common-js';
import type { Client } from 'guacamole-common-js';
import { writeClipboardText } from '@/foundation/browser';

export interface RemoteClipboardBridge {
  syncHostToRemote(): Promise<void>;
  destroy(): void;
}

const isPermissionFailure = (cause: unknown): boolean =>
  cause instanceof DOMException && (cause.name === 'NotAllowedError' || cause.name === 'SecurityError');

/**
 * Bridges Guacamole plain-text clipboard streams with the browser clipboard.
 * Clipboard permission failures are intentionally non-fatal: remote input must
 * keep working even when the browser denies clipboard access.
 */
export const attachRemoteClipboard = (element: HTMLElement, client: Client): RemoteClipboardBridge => {
  let destroyed = false;

  const syncHostToRemote = async (): Promise<void> => {
    if (destroyed || !navigator.clipboard?.readText) return;
    try {
      const text = await navigator.clipboard.readText();
      if (destroyed || !text) return;
      const writer = new Guacamole.StringWriter(client.createClipboardStream('text/plain'));
      writer.sendText(text);
      writer.sendEnd();
    } catch (cause) {
      if (!isPermissionFailure(cause)) console.warn('[RemoteClipboard] Failed to read the host clipboard.', cause);
    }
  };

  const handleRemoteClipboard: NonNullable<Client['onclipboard']> = (stream, mimetype) => {
    if (destroyed || !String(mimetype).toLowerCase().startsWith('text/plain')) return;
    const reader = new Guacamole.StringReader(stream);
    let text = '';
    reader.ontext = (chunk) => {
      text += chunk;
    };
    reader.onend = () => {
      if (destroyed) return;
      void writeClipboardText(text).catch((cause: unknown) => {
        if (!isPermissionFailure(cause)) console.warn('[RemoteClipboard] Failed to write the remote clipboard.', cause);
      });
    };
  };

  const handleFocus = () => void syncHostToRemote();
  element.addEventListener('focus', handleFocus);
  client.onclipboard = handleRemoteClipboard;

  return {
    syncHostToRemote,
    destroy() {
      if (destroyed) return;
      destroyed = true;
      element.removeEventListener('focus', handleFocus);
      if (client.onclipboard === handleRemoteClipboard) client.onclipboard = null;
    },
  };
};
