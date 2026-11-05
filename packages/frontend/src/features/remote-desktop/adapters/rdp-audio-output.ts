import { audioPlayback } from '@devolutions/iron-remote-desktop-rdp';
import { logger } from '@/client/logging/logger';

// These are the PCM16 rates/channels advertised by the pinned Web bridge.
const SAMPLE_RATES = new Set([22050, 44100, 48000]);

export function attachRdpAudioOutput(element: HTMLElement, keyboard: HTMLTextAreaElement) {
	let context: AudioContext | null = null;
	let closed = false;
	let failed = false;
	let nextTime = 0;
	let format = '';
	let lastBlockDuration = 0;
	let volumeLeft = 1;
	let volumeRight = 1;
	const sources = new Set<AudioBufferSourceNode>();

	const stop = () => {
		for (const source of sources) {
			source.onended = null;
			try {
				source.stop();
			} catch {
				// A source whose start failed has no playback to stop.
			} finally {
				source.disconnect();
			}
		}
		sources.clear();
		nextTime = 0;
		format = '';
		lastBlockDuration = 0;
	};

	const fail = () => {
		if (failed || closed) return;
		failed = true;
		stop();
		if (context && context.state !== 'closed') void context.close().catch(() => {});
		logger.warn({ code: 'remote_desktop_audio_unavailable' }, 'Remote desktop audio is unavailable');
	};

	try {
		if (typeof AudioContext !== 'undefined') context = new AudioContext({ latencyHint: 'interactive' });
	} catch {
		fail();
	}

	const resume = () => {
		const original = context;
		if (closed || failed || !original || original.state === 'closed' || original.state === 'running') {
			return;
		}
		// A denied automatic resume is expected. A later trusted gesture retries it.
		// resume() can remain pending until activation, so a pending attempt must not gate this gesture.
		void original.resume().catch(() => {});
	};

	const stateChanged = () => {
		if (context?.state !== 'running') stop();
	};

	context?.addEventListener('statechange', stateChanged);
	element.addEventListener('pointerdown', resume, { capture: true });
	element.addEventListener('touchend', resume, { capture: true, passive: true });
	keyboard.addEventListener('keydown', resume, { capture: true });
	resume();

	const extension = () => {
		if (!context || failed || closed) return null;
		return audioPlayback((message: unknown) => {
			const output = context;
			if (closed || failed || !output) return;
			if (typeof message !== 'object' || message === null || !('type' in message)) {
				fail();
				return;
			}
			// RDPSND Close also precedes negotiation. Let already scheduled tail samples finish.
			if (message.type === 'close' && Object.keys(message).length === 1) {
				format = '';
				return;
			}
			if (
				message.type === 'volume' &&
				Object.keys(message).length === 3 &&
				'left' in message &&
				typeof message.left === 'number' &&
				Number.isFinite(message.left) &&
				message.left >= 0 &&
				message.left <= 1 &&
				'right' in message &&
				typeof message.right === 'number' &&
				Number.isFinite(message.right) &&
				message.right >= 0 &&
				message.right <= 1
			) {
				volumeLeft = message.left;
				volumeRight = message.right;
				return;
			}
			if (
				message.type !== 'wave' ||
				Object.keys(message).length !== 4 ||
				!('data' in message) ||
				!('sampleRate' in message) ||
				!('channels' in message)
			) {
				fail();
				return;
			}
			const { data, sampleRate, channels } = message;
			if (output.state !== 'running') return;
			if (
				!(data instanceof Uint8Array) ||
				typeof sampleRate !== 'number' ||
				!SAMPLE_RATES.has(sampleRate) ||
				channels !== 2 ||
				data.byteLength % (channels * 2) !== 0
			) {
				fail();
				return;
			}
			if (!data.byteLength) return;
			try {
				const nextFormat = `${sampleRate}:${channels}`;
				if (format && format !== nextFormat) stop();
				format = nextFormat;
				const buffer = output.createBuffer(channels, data.byteLength / (channels * 2), sampleRate);
				const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
				for (let channel = 0; channel < channels; channel++) {
					const samples = buffer.getChannelData(channel);
					for (let frame = 0; frame < samples.length; frame++) {
						samples[frame] =
							(view.getInt16((frame * channels + channel) * 2, true) / 32768) *
							(channel === 0 ? volumeLeft : volumeRight);
					}
				}
				// Live sound must not replay an ever growing catch-up queue after network/background stalls.
				// Derive the horizon from the device latency and this actual PCM block, not a fixed product limit.
				const deviceLatency = output.baseLatency + (output.outputLatency || 0);
				if (nextTime > output.currentTime + deviceLatency + Math.max(buffer.duration, lastBlockDuration))
					stop();
				lastBlockDuration = buffer.duration;
				format = nextFormat;
				const source = output.createBufferSource();
				source.buffer = buffer;
				source.connect(output.destination);
				sources.add(source);
				source.onended = () => {
					sources.delete(source);
					source.disconnect();
				};
				const start = Math.max(output.currentTime, nextTime);
				source.start(start);
				nextTime = start + buffer.duration;
			} catch {
				fail();
			}
		});
	};

	return {
		extension,

		close() {
			if (closed) return;
			closed = true;
			element.removeEventListener('pointerdown', resume, true);
			element.removeEventListener('touchend', resume, true);
			keyboard.removeEventListener('keydown', resume, true);
			const original = context;
			context = null;
			original?.removeEventListener('statechange', stateChanged);
			try {
				stop();
			} finally {
				if (original && original.state !== 'closed') void original.close().catch(() => {});
			}
		},
	};
}
