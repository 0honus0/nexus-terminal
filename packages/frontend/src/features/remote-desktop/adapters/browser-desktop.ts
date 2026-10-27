import {
	RemoteDesktopFailure,
	type RemoteDesktopPeer,
	type RemoteDesktopPeerFactory,
	type RemoteDesktopDisplay,
} from '../model/remote-desktop-types';

export const createBrowserDesktop: RemoteDesktopPeerFactory = (options) => {
	const element = document.createElement('div');
	element.tabIndex = 0;
	element.style.width = '100%';
	element.style.height = '100%';
	let closed = false;
	let started = false;
	let latestDisplay: RemoteDesktopDisplay | null = null;
	let touchMode = options.touchMode;
	let textInputActive = false;
	let peer: RemoteDesktopPeer | null = null;

	const focus = () => {
		if (!closed) {
			void peer?.syncClipboard();
		}
	};

	element.addEventListener('focus', focus);

	return {
		element,

		connect(session, display) {
			if (closed || started) {
				throw new RemoteDesktopFailure('conflict', 'not_dispatched');
			}
			started = true;
			latestDisplay = display;

			const load = async () => {
				const factory =
					session.protocol === 'RDP'
						? (await import('./rdp-desktop')).createRdpDesktop
						: (await import('./vnc-desktop')).createVncDesktop;
				if (closed) {
					return;
				}
				const current = factory(options);
				peer = current;
				element.replaceChildren(current.element);
				current.connect(session, latestDisplay ?? display);
				current.setTouchMode(touchMode);
				current.setTextInputActive(textInputActive);
			};

			void load().catch((cause: unknown) => {
				if (!closed) {
					options.onFailure(new RemoteDesktopFailure('remote_unavailable', 'unknown', { cause }));
				}
			});
		},

		resize(display) {
			latestDisplay = display;
			peer?.resize(display);
		},

		focus() {
			peer?.focus();
		},

		setTouchMode(mode) {
			touchMode = mode;
			peer?.setTouchMode(mode);
		},

		setTextInputActive(active) {
			textInputActive = active;
			peer?.setTextInputActive(active);
		},

		syncClipboard() {
			return peer?.syncClipboard() ?? Promise.resolve();
		},

		sendText(text) {
			peer?.sendText(text);
		},

		close() {
			if (closed) {
				return;
			}
			closed = true;
			element.removeEventListener('focus', focus);
			const original = peer;
			peer = null;
			try {
				original?.close();
			} finally {
				element.remove();
			}
		},
	};
};
