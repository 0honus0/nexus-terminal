import type {
	RemoteDesktopDisplayRequest,
	RemoteDesktopSessionResponse,
} from '@nexus-terminal/shared/remote/desktop/http';
import type { RemoteDesktopDisplay, RemoteDesktopSession } from './remote-desktop-types';

export function toSession(value: RemoteDesktopSessionResponse): RemoteDesktopSession {
	return { ticket: value.ticket, lastConnectedAt: value.lastConnectedAt * 1000 };
}

export function toDisplayRequest(value: RemoteDesktopDisplay): RemoteDesktopDisplayRequest {
	return { width: value.width, height: value.height, dpi: value.dpi };
}
