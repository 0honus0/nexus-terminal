// Test-only RDPSND delivery boundary. The application adapter still uses real Web Audio nodes.
let receive: ((message: unknown) => void) | undefined;

export function audioPlayback(callback: (message: unknown) => void) {
	receive = callback;
	return { free() {} };
}

export function deliverRdpAudio(message: unknown): void {
	if (!receive) throw new Error('Audio extension has not been registered');
	receive(message);
}
