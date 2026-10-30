import { ConnectionTestHostKeyFailure } from './connection-errors';
import { confirmConnectionHostKey } from './host-key-trust';

/** Each retry follows explicit trust of the actual handshake key, including jump hosts. */
export async function testConnectionWithHostKeyConfirmation(
	test: () => Promise<number>,
	signal: AbortSignal,
): Promise<number | null> {
	const confirmed = new Set<string>();
	while (true) {
		signal.throwIfAborted();
		try {
			return await test();
		} catch (cause) {
			if (!(cause instanceof ConnectionTestHostKeyFailure)) throw cause;
			const key = cause.hostKey;
			const identity = JSON.stringify([key.host, key.port]);
			// A changing key or an additional verifier rejection must not create a confirmation loop.
			if (confirmed.has(identity) || key.fingerprint === key.expectedFingerprint) throw cause;
			const accepted = await confirmConnectionHostKey(key, signal);
			signal.throwIfAborted();
			if (!accepted) return null;
			confirmed.add(identity);
		}
	}
}
