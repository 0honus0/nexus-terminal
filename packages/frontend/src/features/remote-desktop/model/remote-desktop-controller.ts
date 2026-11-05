import {
	RemoteDesktopFailure,
	RemoteDesktopCertificateRequired,
	type RemoteDesktopCertificate,
	type RemoteDesktopCertificateApproval,
	type RemoteDesktopSession,
	type RemoteDesktopApi,
	type RemoteDesktopConnection,
	type RemoteDesktopDisplay,
	type RemoteDesktopPeer,
	type RemoteDesktopPeerFactory,
	type RemoteDesktopPeerOptions,
	type RemoteDesktopState,
} from './remote-desktop-types';

interface ControllerOptions {
	api: RemoteDesktopApi;
	createPeer: RemoteDesktopPeerFactory;
	onState(state: RemoteDesktopState, failure: RemoteDesktopFailure | null): void;
	onConnected(connectionId: number): void;
	confirmCertificate(
		certificate: RemoteDesktopCertificate,
		signal: AbortSignal,
	): Promise<{ remember: boolean } | null>;
}

export function createRemoteDesktopController(options: ControllerOptions) {
	let generation = 0;
	let pending: AbortController | null = null;
	let peer: RemoteDesktopPeer | null = null;
	let cleanupFailure: RemoteDesktopFailure | null = null;

	const close = (): boolean => {
		generation += 1;
		pending?.abort();
		pending = null;
		const original = peer;
		peer = null;
		try {
			original?.close();
		} catch (cause) {
			cleanupFailure = new RemoteDesktopFailure('cleanup_failed', 'unknown', { cause });
		}
		options.onState(cleanupFailure ? 'error' : 'disconnected', cleanupFailure);
		return cleanupFailure === null;
	};

	const fail = (failure: RemoteDesktopFailure): void => {
		close();
		const result = cleanupFailure
			? new RemoteDesktopFailure('cleanup_failed', 'unknown', {
					cause: new AggregateError([failure, cleanupFailure], 'Desktop operation and cleanup failed'),
				})
			: failure;
		options.onState('error', result);
	};

	const createSession = async (
		connection: RemoteDesktopConnection,
		display: RemoteDesktopDisplay,
		signal: AbortSignal,
	): Promise<RemoteDesktopSession> => {
		let approval: RemoteDesktopCertificateApproval | null = null;
		while (!signal.aborted) {
			try {
				return await options.api.create(connection.id, connection.type, display, signal, approval);
			} catch (cause) {
				if (!(cause instanceof RemoteDesktopCertificateRequired) || signal.aborted) throw cause;
				const choice = await options.confirmCertificate(cause.certificate, signal);
				if (choice === null || signal.aborted) throw new RemoteDesktopFailure('cancelled', 'not_dispatched');
				const certificate = cause.certificate;
				approval = {
					host: certificate.host,
					port: certificate.port,
					fingerprint: certificate.fingerprint,
					previousFingerprint: certificate.previousFingerprint,
					remember: choice.remember,
				};
			}
		}
		throw new RemoteDesktopFailure('cancelled', 'not_dispatched');
	};

	return {
		close,

		get peer(): RemoteDesktopPeer | null {
			return peer;
		},

		async connect(
			connection: RemoteDesktopConnection,
			display: RemoteDesktopDisplay,
			input: Pick<RemoteDesktopPeerOptions, 'hasTouch' | 'touchMode' | 'mobileInput'>,
			host: HTMLElement,
		): Promise<void> {
			if (!close()) return;
			const revision = generation;
			const controller = new AbortController();
			pending = controller;
			options.onState('connecting', null);
			try {
				const session = await createSession(connection, display, controller.signal);
				if (revision !== generation || controller.signal.aborted) return;
				const current = options.createPeer({
					hasTouch: input.hasTouch,
					touchMode: input.touchMode,
					mobileInput: input.mobileInput,

					onState(state) {
						if (revision !== generation) return;
						if (state === 'disconnected') {
							close();
							return;
						}
						options.onState(state, null);
						if (state === 'connected') {
							options.onConnected(connection.id);
						}
					},

					onFailure(failure) {
						if (revision !== generation) return;
						if (failure.code === 'input_failed') {
							options.onState('connected', failure);
							return;
						}
						fail(failure);
					},
				});
				peer = current;
				host.replaceChildren(current.element);
				current.connect(session, display);
			} catch (cause) {
				if (revision !== generation) return;
				if (
					cause instanceof RemoteDesktopFailure &&
					cause.code === 'cancelled' &&
					cause.outcome === 'not_dispatched'
				) {
					close();
					return;
				}
				const failure =
					cause instanceof RemoteDesktopFailure
						? cause
						: new RemoteDesktopFailure('remote_unavailable', 'unknown', { cause });
				fail(failure);
			} finally {
				if (revision === generation) pending = null;
			}
		},
	};
}
